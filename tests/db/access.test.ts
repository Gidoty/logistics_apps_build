/**
 * Row Level Security, column grants and guard triggers, tested as real
 * database roles (anon, authenticated buyer, vendor, admin, server).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, RLS_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: access rules", () => {
  const h = new DbHarness();

  let buyer: TestUser;
  let otherBuyer: TestUser;
  let vendorOwner: TestUser;
  let admin: TestUser;
  let vendorId: string;
  let pendingVendorId: string;
  let cnNgCorridorId: string;
  let ngNgCorridorId: string;

  beforeAll(async () => {
    await h.start();
    buyer = await h.createUser({ full_name: "Ada Buyer", country_code: "gb", role: "admin" });
    otherBuyer = await h.createUser({ full_name: "Other Buyer" });
    vendorOwner = await h.createUser({ full_name: "Vendor Owner", country_code: "CN" });
    const pendingOwner = await h.createUser({ full_name: "Pending Owner" });
    admin = await h.createUser({ full_name: "Admin User" });
    await h.setRoleAsServer(admin.id, "admin");

    const corridor = await h.query(
      "select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'",
    );
    cnNgCorridorId = corridor.rows[0].id;
    const localCorridor = await h.query(
      "select id from public.corridors where origin_country = 'NG' and destination_country = 'NG'",
    );
    ngNgCorridorId = localCorridor.rows[0].id;

    await h.asServer();
    const approved = await h.query(
      `insert into public.vendors (owner_id, business_name, country_code, city, status, payout_details_json)
       values ($1, 'Shenzhen Phones', 'CN', 'Shenzhen', 'approved', '{"iban":"secret"}') returning id`,
      [vendorOwner.id],
    );
    vendorId = approved.rows[0].id;
    await h.setRoleAsServer(vendorOwner.id, "vendor");

    const pending = await h.query(
      `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
       values ($1, 'Pending Shop', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/doc.pdf') returning id`,
      [pendingOwner.id],
    );
    pendingVendorId = pending.rows[0].id;

    await h.query(
      `insert into public.products (vendor_id, title, category, price_minor, currency, stock, active, corridor_id) values
         ($1, 'Visible Phone', 'phones', 15000000, 'NGN', 5, true, $3),
         ($1, 'Hidden Draft Phone', 'phones', 15000000, 'NGN', 5, false, $3),
         ($2, 'Pending Vendor Phone', 'phones', 15000000, 'NGN', 5, true, $4)`,
      [vendorId, pendingVendorId, cnNgCorridorId, ngNgCorridorId],
    );
  });

  afterAll(() => h.stop());

  async function createRecipient(owner: TestUser): Promise<string> {
    await h.actAs(owner);
    const { rows } = await h.query(
      `insert into public.recipients (full_name, phone, address_line, city, state)
       values ('Mama Obi', '+2348031234567', '12 Allen Avenue', 'Ikeja', 'Lagos') returning id`,
    );
    return rows[0].id;
  }

  /**
   * Creates an order the way server code does (orders are never inserted by
   * browser sessions), then switches back to acting as the owner.
   */
  async function createOrder(
    owner: TestUser,
    status = "draft",
    vendor: string | null = null,
    type: "link" | "catalog" = "link",
  ): Promise<string> {
    await h.asServer();
    const { rows } = await h.query(
      `insert into public.orders (buyer_id, order_type, status, source_url, buyer_currency, corridor_id, vendor_id)
       values ($1, $2, $3, $4, 'GBP', $5, $6) returning id`,
      [owner.id, type, status, type === "link" ? "https://example.com/phone" : null, cnNgCorridorId, vendor],
    );
    await h.actAs(owner);
    return rows[0].id;
  }

  describe("sign-up", () => {
    it("creates a buyer profile and ignores a role sent in sign-up metadata", async () => {
      const { rows } = await h.query(
        "select role, full_name, country_code, preferred_currency from public.profiles where id = $1",
        [buyer.id],
      );
      expect(rows[0]).toEqual({
        role: "buyer",
        full_name: "Ada Buyer",
        country_code: "GB",
        preferred_currency: "GBP",
      });
    });
  });

  describe("roles", () => {
    it("blocks a buyer from updating their own role", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          "update public.profiles set role = 'admin' where id = $1",
          [buyer.id],
          /cannot change your own role/,
        );
        await h.expectError(
          "update public.profiles set role = 'vendor' where id = $1",
          [buyer.id],
          /cannot change your own role/,
        );
      });
    });

    it("blocks a buyer from changing anyone else's role", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        const result = await h.query("update public.profiles set role = 'admin' where id = $1", [
          otherBuyer.id,
        ]);
        expect(result.rowCount).toBe(0);
        await h.asServer();
        const { rows } = await h.query("select role from public.profiles where id = $1", [otherBuyer.id]);
        expect(rows[0].role).toBe("buyer");
      });
    });

    it("blocks even an admin from changing their own role", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          "update public.profiles set role = 'buyer' where id = $1",
          [admin.id],
          /cannot change your own role/,
        );
      });
    });

    it("lets an admin change another user's role and records it in the audit log", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        const result = await h.query("update public.profiles set role = 'vendor' where id = $1", [
          otherBuyer.id,
        ]);
        expect(result.rowCount).toBe(1);
        const log = await h.query(
          "select actor_id, details from public.audit_log where action = 'profile.role_changed' and entity_id = $1",
          [otherBuyer.id],
        );
        expect(log.rows).toEqual([{ actor_id: admin.id, details: { from: "buyer", to: "vendor" } }]);
      });
    });

    it("never removes the last admin, even from server code", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.query("update public.profiles set role = 'buyer' where role = 'admin' and id <> $1", [
          admin.id,
        ]);
        await h.expectError(
          "update public.profiles set role = 'buyer' where id = $1",
          [admin.id],
          /last admin/,
        );
      });
    });

    it("blocks users from editing their own email", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          "update public.profiles set email = 'x@example.test' where id = $1",
          [buyer.id],
          PERMISSION_DENIED,
        );
      });
    });
  });

  describe("vendors", () => {
    it("creates applications as pending even if the client asks for approved", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          `insert into public.vendors (owner_id, business_name, country_code, city, status)
           values ($1, 'Ada Gadgets', 'NG', 'Lagos', 'approved')`,
          [buyer.id],
          PERMISSION_DENIED,
        );
        const { rows } = await h.query(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'Ada Gadgets', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/doc.pdf') returning status`,
          [buyer.id],
        );
        expect(rows[0].status).toBe("pending");
      });
    });

    it("blocks applying on behalf of someone else", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'Fake Shop', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/doc.pdf')`,
          [otherBuyer.id],
          RLS_DENIED,
        );
      });
    });

    it("blocks a vendor from approving themselves", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        const { rows } = await h.query(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'Ada Gadgets', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/doc.pdf') returning id`,
          [buyer.id],
        );
        await h.expectError(
          "update public.vendors set status = 'approved' where id = $1",
          [rows[0].id],
          /Only admins can change vendor status/,
        );
        await h.expectError("select public.approve_vendor($1)", [rows[0].id], /Only admins can approve/);
      });
    });

    it("approval makes the owner a vendor; suspension makes them a buyer again", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        const { rows } = await h.query(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'Ada Gadgets', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/doc.pdf') returning id`,
          [buyer.id],
        );
        const newVendorId = rows[0].id;

        await h.actAs(admin);
        await h.query("select public.approve_vendor($1)", [newVendorId]);
        await h.actAs(buyer);
        const afterApprove = await h.query(
          "select public.current_user_role() as role, public.current_vendor_id() as vid",
        );
        expect(afterApprove.rows[0]).toEqual({ role: "vendor", vid: newVendorId });

        await h.actAs(admin);
        await h.query("select public.suspend_vendor($1, 'Fake stock photos')", [newVendorId]);
        await h.actAs(buyer);
        const afterSuspend = await h.query(
          "select public.current_user_role() as role, public.current_vendor_id() as vid",
        );
        expect(afterSuspend.rows[0]).toEqual({ role: "buyer", vid: null });

        await h.asServer();
        const log = await h.query(
          "select action from public.audit_log where entity_id = $1 order by created_at, action",
          [newVendorId],
        );
        expect(log.rows.map((r) => r.action)).toEqual([
          "vendor.applied",
          "vendor.status_changed",
          "vendor.status_changed",
        ]);
      });
    });

    it("hides the vendors table from the public but lists approved vendors by name and country", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        await h.expectError("select * from public.vendors", [], PERMISSION_DENIED);
        const { rows, fields } = await h.query("select * from public.vendor_directory");
        expect(fields.map((f) => f.name)).toEqual([
          "id",
          "business_name",
          "country_code",
          "city",
          "categories",
          "created_at",
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: vendorId,
          business_name: "Shenzhen Phones",
          country_code: "CN",
          city: "Shenzhen",
          categories: [],
        });
      });
    });

    it("lets a vendor see only their own vendor record", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        const { rows } = await h.query("select id from public.vendors");
        expect(rows.map((r) => r.id)).toEqual([vendorId]);
      });
    });
  });

  describe("catalog", () => {
    it("shows the public only active products from approved vendors", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        const { rows } = await h.query("select title from public.products order by title");
        expect(rows.map((r) => r.title)).toEqual(["Visible Phone"]);
      });
    });

    it("lets an approved vendor add products for itself only", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        const ok = await h.query(
          `insert into public.products (vendor_id, title, category, price_minor, currency, corridor_id)
           values ($1, 'New Laptop', 'laptops', 45000000, 'NGN', $2)`,
          [vendorId, cnNgCorridorId],
        );
        expect(ok.rowCount).toBe(1);
        await h.expectError(
          `insert into public.products (vendor_id, title, category, price_minor, currency, corridor_id)
           values ($1, 'Sneaky', 'laptops', 1, 'NGN', $2)`,
          [pendingVendorId, ngNgCorridorId],
          RLS_DENIED,
        );
      });
    });

    it("blocks buyers from adding products", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          `insert into public.products (vendor_id, title, category, price_minor, currency, corridor_id)
           values ($1, 'Fake', 'phones', 1, 'NGN', $2)`,
          [vendorId, cnNgCorridorId],
          RLS_DENIED,
        );
      });
    });
  });

  describe("orders", () => {
    it("gives every order an unguessable tracking token", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer, "quote_requested");
        const { rows } = await h.query("select public_tracking_token from public.orders where id = $1", [
          orderId,
        ]);
        expect(rows[0].public_tracking_token).toMatch(/^[0-9a-f]{32}$/);
      });
    });

    it("blocks buyers from inserting orders directly, whatever the status", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        for (const status of ["draft", "quote_requested", "paid"]) {
          await h.expectError(
            `insert into public.orders (order_type, status, source_url, buyer_currency)
             values ('link', $1, 'https://example.com/x', 'NGN')`,
            [status],
            PERMISSION_DENIED,
          );
        }
      });
    });

    it("blocks buyers from changing an order directly: status, tracking token or platform fields", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        for (const change of [
          "status = 'paid'",
          "status = 'delivered'",
          "status = 'quote_requested'",
          "public_tracking_token = 'guessable'",
          "delivery_code_hash = 'x'",
          "source_url = 'https://example.com/y'",
        ]) {
          await h.expectError(
            `update public.orders set ${change} where id = $1`,
            [orderId],
            PERMISSION_DENIED,
          );
        }
        await h.expectError(
          "update public.orders set vendor_id = $2 where id = $1",
          [orderId, vendorId],
          PERMISSION_DENIED,
        );
      });
    });

    it("hides orders and recipients from other buyers", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        const recipientId = await createRecipient(buyer);
        await h.actAs(otherBuyer);
        const orders = await h.query("select id from public.orders where id = $1", [orderId]);
        const recipients = await h.query("select id from public.recipients where id = $1", [recipientId]);
        expect(orders.rowCount).toBe(0);
        expect(recipients.rowCount).toBe(0);
      });
    });

    it("lets the assigned vendor read a catalog order but never a link order, and not change either", async () => {
      await h.scenario(async () => {
        const catalogOrder = await createOrder(buyer, "paid", vendorId, "catalog");
        const linkOrder = await createOrder(buyer, "quote_requested", vendorId, "link");
        await h.actAs(vendorOwner);
        const read = await h.query("select id from public.orders order by created_at");
        expect(read.rows.map((r) => r.id)).toEqual([catalogOrder]);
        await h.expectError(
          "update public.orders set status = 'shipped' where id = $1",
          [catalogOrder],
          PERMISSION_DENIED,
        );
        expect((await h.query("select id from public.orders where id = $1", [linkOrder])).rowCount).toBe(0);
      });
    });

    it("blocks buyers from writing order items (prices come from server code)", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        await h.expectError(
          `insert into public.order_items (order_id, description, quantity, unit_price_minor, currency)
           values ($1, 'Phone', 1, 1, 'NGN')`,
          [orderId],
          RLS_DENIED,
        );
      });
    });
  });

  describe("money and audit", () => {
    it("blocks every client, admins included, from writing ledger or audit rows", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        for (const user of [buyer, admin]) {
          await h.actAs(user);
          await h.expectError(
            `insert into public.ledger_entries (order_id, entry_type, amount_minor, currency)
             values ($1, 'held', 100, 'NGN')`,
            [orderId],
            PERMISSION_DENIED,
          );
          await h.expectError(
            "insert into public.audit_log (action, entity_type) values ('fake.entry', 'orders')",
            [],
            PERMISSION_DENIED,
          );
        }
      });
    });

    it("lets server code append ledger rows but never change or delete them", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        await h.asServer();
        await h.query(
          `insert into public.ledger_entries (order_id, entry_type, amount_minor, currency)
           values ($1, 'held', 15000000, 'NGN')`,
          [orderId],
        );
        await h.expectError("update public.ledger_entries set amount_minor = 1", [], /append-only/);
        await h.expectError("delete from public.ledger_entries", [], /append-only/);
        await h.expectError("update public.audit_log set action = 'x.y'", [], /append-only/);
        await h.expectError("delete from public.audit_log", [], /append-only/);
      });
    });

    it("rejects zero or negative ledger amounts", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        await h.asServer();
        await h.expectError(
          `insert into public.ledger_entries (order_id, entry_type, amount_minor, currency)
           values ($1, 'refunded_to_buyer', -500, 'NGN')`,
          [orderId],
          /ledger_entries_amount_minor_check/,
        );
      });
    });

    it("shows payments and the ledger to admins only", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        await h.asServer();
        await h.query(
          `insert into public.payments (order_id, provider, provider_reference, amount_minor, currency, status)
           values ($1, 'paystack', 'ref_123', 15000000, 'NGN', 'success')`,
          [orderId],
        );
        await h.actAs(buyer);
        expect((await h.query("select id from public.payments")).rowCount).toBe(0);
        await h.actAs(admin);
        expect((await h.query("select id from public.payments")).rowCount).toBe(1);
      });
    });
  });

  describe("disputes", () => {
    it("lets a buyer open a dispute on their own order only, always as open", async () => {
      await h.scenario(async () => {
        const orderId = await createOrder(buyer);
        const otherOrderId = await createOrder(otherBuyer);

        await h.actAs(buyer);
        const { rows } = await h.query(
          "insert into public.disputes (order_id, reason) values ($1, 'The phone arrived with a cracked screen.') returning status, raised_by",
          [orderId],
        );
        expect(rows[0]).toEqual({ status: "open", raised_by: buyer.id });

        await h.expectError(
          "insert into public.disputes (order_id, reason) values ($1, 'Not my order but I want to complain.')",
          [otherOrderId],
          RLS_DENIED,
        );
        // No update policy for buyers: the row is invisible to UPDATE.
        const resolve = await h.query(
          "update public.disputes set status = 'resolved_buyer' where order_id = $1",
          [orderId],
        );
        expect(resolve.rowCount).toBe(0);
        const stillOpen = await h.query("select status from public.disputes where order_id = $1", [orderId]);
        expect(stillOpen.rows[0].status).toBe("open");
      });
    });
  });

  describe("anonymous visitors", () => {
    it.each([
      "profiles",
      "orders",
      "recipients",
      "fee_rules",
      "fx_rates",
      "payments",
      "ledger_entries",
      "audit_log",
    ])("cannot read %s", async (table) => {
      await h.scenario(async () => {
        await h.actAs("anon");
        await h.expectError(`select * from public.${table}`, [], PERMISSION_DENIED);
      });
    });

    it("can read active currencies and corridors", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        const currencies = await h.query("select code from public.currencies");
        const corridors = await h.query("select name from public.corridors");
        expect(currencies.rowCount).toBe(6);
        expect(corridors.rowCount).toBe(2);
      });
    });
  });
});
