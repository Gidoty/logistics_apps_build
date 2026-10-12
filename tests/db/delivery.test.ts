/**
 * Batch 5, step 3: delivery code, public tracking, vendor order list, payouts
 * and refunds, tested as real database roles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: delivery, tracking and payouts", () => {
  const h = new DbHarness();
  let admin: TestUser;
  let buyer: TestUser;
  let other: TestUser;
  let vendorOwner: TestUser;
  let otherVendorOwner: TestUser;
  let vendorId: string;
  let recipient: string;
  let cnNg: string;

  const TOTAL = 15_000_000;
  const HASH = "a".repeat(64);
  const WRONG = "b".repeat(64);
  const CIPHER = "x".repeat(40);
  const LINES = [{ type: "item_price", label: "Item price", amount_minor: TOTAL }];

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser();
    buyer = await h.createUser();
    other = await h.createUser();
    vendorOwner = await h.createUser();
    otherVendorOwner = await h.createUser();
    await h.setRoleAsServer(admin.id, "admin");
    await h.asServer();
    cnNg = (
      await one("select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'")
    ).id;
    for (const [owner, name] of [
      [vendorOwner, "Vendor One"],
      [otherVendorOwner, "Vendor Two"],
    ] as const) {
      const v = await one(
        `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
         values ($1, $2, 'CN', 'Shenzhen', 'approved', '+8613800000000', array['phones'], 'x/y.pdf') returning id`,
        [owner.id, name],
      );
      if (owner === vendorOwner) vendorId = v.id;
      await h.setRoleAsServer(owner.id, "vendor");
    }
    recipient = (
      await one(
        `insert into public.recipients (created_by, full_name, phone, address_line, city, state, country_code)
         values ($1, 'Ada Obi', '+2348031234567', '12 Aba Road', 'Port Harcourt', 'Rivers', 'NG') returning id`,
        [buyer.id],
      )
    ).id;
  });
  afterAll(() => h.stop());

  async function one(sql: string, params: unknown[] = []) {
    return (await h.query(sql, params)).rows[0];
  }

  async function paidOrder(): Promise<string> {
    await h.asServer();
    const productId = (
      await one(
        `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, stock, weight_grams, active)
         values ($1, 'Test phone', 'A phone with enough description text.', 'phones', $2, 'NGN', $3, 5, 300, true) returning id`,
        [vendorId, TOTAL, cnNg],
      )
    ).id;
    await h.asServiceRole();
    const orderId = (
      await one(
        "select public.create_catalog_order($1, $2, 1, $3, 'NGN', $4::jsonb, '{\"engine_version\":\"1\"}'::jsonb, 300) as id",
        [buyer.id, productId, recipient, JSON.stringify(LINES)],
      )
    ).id as string;
    const paymentId = (
      await one(
        "select public.create_payment($1, $2, $3, 'NGN', $3, '{\"method\":\"same_currency\"}'::jsonb) as id",
        [orderId, buyer.id, TOTAL],
      )
    ).id as string;
    await h.query("select public.apply_successful_payment($1, null, '{\"ok\":true}'::jsonb)", [paymentId]);
    return orderId;
  }

  /** Walks an order through the states with the state machine function, as shipment events and the buyer would. */
  async function moveTo(orderId: string, steps: string[]) {
    await h.asServer();
    for (const step of steps)
      await h.query("select public.transition_order($1, $2::public.order_status)", [orderId, step]);
  }
  const TO_OUT = ["purchased", "inspection_pending", "inspection_approved", "shipped", "out_for_delivery"];

  async function outForDelivery(withCode = true): Promise<{ id: string; token: string }> {
    const id = await paidOrder();
    await moveTo(id, TO_OUT);
    await h.asServiceRole();
    if (withCode) await h.query("select public.issue_delivery_code($1, $2, $3)", [id, HASH, CIPHER]);
    const token = (await one("select public_tracking_token as t from public.orders where id = $1", [id]))
      .t as string;
    return { id, token };
  }
  async function delivered(): Promise<string> {
    const { id, token } = await outForDelivery();
    await h.asServiceRole();
    await h.query("select public.confirm_delivery_with_code($1, $2)", [token, HASH]);
    return id;
  }

  const statusOf = async (id: string) => {
    await h.asServer();
    return (await one("select status::text as s from public.orders where id = $1", [id])).s as string;
  };
  const confirm = async (token: string, hash: string) => {
    await h.asServiceRole();
    return (await one("select public.confirm_delivery_with_code($1, $2) as r", [token, hash])).r as {
      result: string;
      attempts_left?: number;
    };
  };

  describe("delivery_codes", () => {
    it("cannot be read or written by anyone signed in", async () => {
      await h.scenario(async () => {
        const { id } = await outForDelivery();
        for (const who of [buyer, admin, vendorOwner]) {
          await h.actAs(who);
          await h.expectError("select * from public.delivery_codes", [], PERMISSION_DENIED);
          await h.expectError("update public.delivery_codes set attempts = 0", [], PERMISSION_DENIED);
        }
        await h.actAs("anon");
        await h.expectError("select * from public.delivery_codes", [], PERMISSION_DENIED);
        await h.actAs(buyer);
        await h.expectError(
          "select public.issue_delivery_code($1, $2, $3)",
          [id, HASH, CIPHER],
          PERMISSION_DENIED,
        );
        await h.expectError("select public.confirm_delivery_with_code('x', $1)", [HASH], PERMISSION_DENIED);
      });
    });

    it("is issued only once the order is out for delivery, and only once", async () => {
      await h.scenario(async () => {
        const id = await paidOrder();
        await h.asServiceRole();
        await h.expectError(
          "select public.issue_delivery_code($1, $2, $3)",
          [id, HASH, CIPHER],
          /out for delivery/,
        );
        await moveTo(id, TO_OUT);
        await h.asServiceRole();
        expect((await one("select public.issue_delivery_code($1, $2, $3) as r", [id, HASH, CIPHER])).r).toBe(
          true,
        );
        expect((await one("select public.issue_delivery_code($1, $2, $3) as r", [id, WRONG, CIPHER])).r).toBe(
          false,
        );
        const row = await one("select code_hash from public.delivery_codes where order_id = $1", [id]);
        expect(row.code_hash).toBe(HASH);
      });
    });
  });

  describe("confirm_delivery_with_code", () => {
    it("delivers the order on the right code", async () => {
      await h.scenario(async () => {
        const { id, token } = await outForDelivery();
        expect(await confirm(token, HASH)).toEqual({ result: "delivered" });
        expect(await statusOf(id)).toBe("delivered");
        expect(await confirm(token, HASH)).toEqual({ result: "not_ready" });
      });
    });

    it("counts wrong attempts, locks on the 5th, and then refuses even the right code", async () => {
      await h.scenario(async () => {
        const { id, token } = await outForDelivery();
        for (const left of [4, 3, 2, 1]) {
          expect(await confirm(token, WRONG)).toEqual({ result: "wrong", attempts_left: left });
        }
        expect(await confirm(token, WRONG)).toEqual({ result: "locked" });
        expect(await confirm(token, HASH)).toEqual({ result: "locked" });
        expect(await statusOf(id)).toBe("out_for_delivery");
        const row = await one("select attempts, locked_at from public.delivery_codes where order_id = $1", [
          id,
        ]);
        expect(row.attempts).toBe(5);
        expect(row.locked_at).not.toBeNull();
        const note = await one(
          "select count(*)::int as n from public.notifications where template = 'delivery_code_locked'",
        );
        expect(note.n).toBe(1);
      });
    });

    it("keeps the attempt count after a right code comes late, and lets an admin unlock", async () => {
      await h.scenario(async () => {
        const { id, token } = await outForDelivery();
        for (let i = 0; i < 5; i++) await confirm(token, WRONG);
        await h.actAs(buyer);
        await h.expectError("select public.unlock_delivery_code($1)", [id], /Only admins/);
        await h.actAs(admin);
        await h.query("select public.unlock_delivery_code($1)", [id]);
        expect(await confirm(token, WRONG)).toEqual({ result: "wrong", attempts_left: 4 });
        expect(await confirm(token, HASH)).toEqual({ result: "delivered" });
      });
    });

    it("answers not_found and not_ready without changing anything", async () => {
      await h.scenario(async () => {
        expect(await confirm("f".repeat(32), HASH)).toEqual({ result: "not_found" });
        const id = await paidOrder();
        const token = (await one("select public_tracking_token as t from public.orders where id = $1", [id]))
          .t;
        expect(await confirm(token, HASH)).toEqual({ result: "not_ready" });
        const noCode = await outForDelivery(false);
        expect(await confirm(noCode.token, HASH)).toEqual({ result: "not_ready" });
      });
    });

    it("cannot be the same code for two orders by accident: each order has its own row", async () => {
      await h.scenario(async () => {
        const a = await outForDelivery();
        const b = await outForDelivery();
        for (let i = 0; i < 5; i++) await confirm(a.token, WRONG);
        expect(await confirm(b.token, HASH)).toEqual({ result: "delivered" });
      });
    });
  });

  describe("admin_mark_delivered", () => {
    it("needs an admin, a note, and an order that is out for delivery", async () => {
      await h.scenario(async () => {
        const { id } = await outForDelivery();
        await h.actAs(buyer);
        await h.expectError(
          "select public.admin_mark_delivered($1, 'Signed receipt seen')",
          [id],
          /Only admins/,
        );
        await h.actAs(vendorOwner);
        await h.expectError(
          "select public.admin_mark_delivered($1, 'Signed receipt seen')",
          [id],
          /Only admins/,
        );
        await h.actAs(admin);
        await h.expectError("select public.admin_mark_delivered($1, '  ')", [id], /at least 5 characters/);
        const early = await paidOrder();
        await h.actAs(admin);
        await h.expectError(
          "select public.admin_mark_delivered($1, 'Signed receipt seen')",
          [early],
          /out for delivery/,
        );
        await h.query("select public.admin_mark_delivered($1, 'Signed receipt seen')", [id]);
        expect(await statusOf(id)).toBe("delivered");
        await h.asServer();
        const log = await one(
          "select details ->> 'note' as note from public.audit_log where entity_id = $1 and action = 'delivery.marked_by_admin'",
          [id],
        );
        expect(log.note).toBe("Signed receipt seen");
      });
    });
  });

  describe("get_tracking", () => {
    it("is for the server only", async () => {
      await h.scenario(async () => {
        const { token } = await outForDelivery();
        await h.actAs("anon");
        await h.expectError("select public.get_tracking($1)", [token], PERMISSION_DENIED);
        await h.actAs(buyer);
        await h.expectError("select public.get_tracking($1)", [token], PERMISSION_DENIED);
      });
    });

    it("returns only safe fields: no phone, address, price or buyer", async () => {
      await h.scenario(async () => {
        const { token } = await outForDelivery();
        await h.asServiceRole();
        const t = (await one("select public.get_tracking($1) as t", [token])).t;
        expect(Object.keys(t).sort()).toEqual(
          [
            "can_enter_code",
            "code_locked",
            "history",
            "item",
            "recipient_city",
            "recipient_first_name",
            "status",
            "updated_at",
          ].sort(),
        );
        expect(t).toMatchObject({
          status: "out_for_delivery",
          recipient_first_name: "Ada",
          recipient_city: "Port Harcourt",
          can_enter_code: true,
          code_locked: false,
        });
        const text = JSON.stringify(t);
        for (const secret of [
          "2348031234567",
          "Aba Road",
          "Obi",
          "Rivers",
          String(TOTAL),
          "15000000",
          buyer.email,
          buyer.id,
          HASH,
          CIPHER,
        ]) {
          expect(text).not.toContain(secret);
        }
        for (const entry of t.history as { status: string; at: string }[]) {
          expect(Object.keys(entry).sort()).toEqual(["at", "status"]);
        }
      });
    });

    it("answers null for a bad token, a pre-payment order or a cancelled one", async () => {
      await h.scenario(async () => {
        await h.asServiceRole();
        for (const bad of ["", "nope", "A".repeat(32), "f".repeat(32), "' or 1=1 --"]) {
          expect((await one("select public.get_tracking($1) as t", [bad])).t).toBeNull();
        }
        await h.asServer();
        const link = await one(
          `insert into public.orders (buyer_id, recipient_id, corridor_id, order_type, status, source_url, buyer_currency)
           values ($1, $2, $3, 'link', 'quote_requested', 'https://www.jumia.com.ng/x', 'NGN') returning public_tracking_token as t`,
          [buyer.id, recipient, cnNg],
        );
        await h.asServiceRole();
        expect((await one("select public.get_tracking($1) as t", [link.t])).t).toBeNull();
      });
    });

    it("shows the code as locked after 5 wrong tries", async () => {
      await h.scenario(async () => {
        const { token } = await outForDelivery();
        for (let i = 0; i < 5; i++) await confirm(token, WRONG);
        await h.asServiceRole();
        const t = (await one("select public.get_tracking($1) as t", [token])).t;
        expect(t).toMatchObject({ can_enter_code: false, code_locked: true });
      });
    });
  });

  describe("vendor_orders", () => {
    it("lists the vendor's own paid orders with the recipient's city only", async () => {
      await h.scenario(async () => {
        const id = await paidOrder();
        await h.actAs(vendorOwner);
        const { rows, fields } = await h.query("select * from public.vendor_orders()");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          order_id: id,
          status: "paid",
          recipient_city: "Port Harcourt",
          item: "Test phone",
        });
        expect(fields.map((f) => f.name).sort()).toEqual(
          [
            "created_at",
            "item",
            "needs_review",
            "order_id",
            "proof_submitted_at",
            "quantity",
            "recipient_city",
            "status",
            "supplier_reference",
          ].sort(),
        );
        for (const who of [otherVendorOwner, buyer, other]) {
          await h.actAs(who);
          expect((await h.query("select * from public.vendor_orders()")).rowCount).toBe(0);
        }
        await h.actAs("anon");
        await h.expectError("select * from public.vendor_orders()", [], PERMISSION_DENIED);
      });
    });

    it("does not list orders that are still unpaid", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const productId = (
          await one(
            `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, stock, weight_grams, active)
             values ($1, 'Unpaid phone', 'A phone with enough description text.', 'phones', $2, 'NGN', $3, 5, 300, true) returning id`,
            [vendorId, TOTAL, cnNg],
          )
        ).id;
        await h.asServiceRole();
        await one(
          "select public.create_catalog_order($1, $2, 1, $3, 'NGN', $4::jsonb, '{\"engine_version\":\"1\"}'::jsonb, 300)",
          [buyer.id, productId, recipient, JSON.stringify(LINES)],
        );
        await h.actAs(vendorOwner);
        expect((await h.query("select * from public.vendor_orders()")).rowCount).toBe(0);
      });
    });
  });

  describe("release_to_vendor", () => {
    const release = (id: string, amount: number, fee: number, ref = "TRF-001", actor: string = admin.id) =>
      h.query("select public.release_to_vendor($1, $2, $3, $4, $5)", [id, actor, amount, fee, ref]);
    const releaseFails = (id: string, amount: number, fee: number, pattern: RegExp, reference = "TRF-001") =>
      h.expectError(
        "select public.release_to_vendor($1, $2, $3, $4, $5)",
        [id, admin.id, amount, fee, reference],
        pattern,
      );
    const summary = async (id: string) => {
      await h.actAs(admin);
      return (await one("select * from public.order_ledger_summary($1)", [id])) as Record<string, string>;
    };

    it("is for the server only, on behalf of an admin", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.actAs(admin);
        await h.expectError(
          "select public.release_to_vendor($1, $2, 1000, 0, 'TRF-1')",
          [id, admin.id],
          PERMISSION_DENIED,
        );
        await h.asServiceRole();
        await h.expectError(
          "select public.release_to_vendor($1, $2, 1000, 0, 'TRF-1')",
          [id, buyer.id],
          /Only admins/,
        );
        await h.expectError(
          "select public.release_to_vendor($1, $2, 1000, 0, 'TRF-1')",
          [id, vendorOwner.id],
          /Only admins/,
        );
      });
    });

    it("works only after delivery", async () => {
      await h.scenario(async () => {
        const { id } = await outForDelivery();
        await h.asServiceRole();
        await releaseFails(id, 1000, 0, /after delivery/, "TRF-001");
      });
    });

    it("records the release and the fee, and lets the balance reach exactly zero", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.asServiceRole();
        await release(id, 13_500_000, 1_500_000, "BANK-REF-77");
        const s = await summary(id);
        expect(Number(s.held_minor)).toBe(TOTAL);
        expect(Number(s.released_minor)).toBe(13_500_000);
        expect(Number(s.platform_fee_minor)).toBe(1_500_000);
        expect(Number(s.balance_minor)).toBe(0);
        await h.asServer();
        const rows = (
          await h.query(
            "select entry_type::text as t, reference from public.ledger_entries where order_id = $1 and entry_type in ('released_to_vendor','platform_fee') order by entry_type::text",
            [id],
          )
        ).rows;
        expect(rows).toEqual([
          { t: "platform_fee", reference: "BANK-REF-77" },
          { t: "released_to_vendor", reference: "BANK-REF-77" },
        ]);
      });
    });

    it("allows a partial release and a fee of zero", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.asServiceRole();
        await release(id, 5_000_000, 0);
        expect(Number((await summary(id)).balance_minor)).toBe(10_000_000);
        await h.asServer();
        const fees = await one(
          "select count(*)::int as n from public.ledger_entries where order_id = $1 and entry_type = 'platform_fee'",
          [id],
        );
        expect(fees.n).toBe(0);
      });
    });

    it("never takes the balance below zero, even across two calls", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.asServiceRole();
        await releaseFails(id, TOTAL, 1, /Not enough is held/, "TRF-001");
        await release(id, TOTAL - 1000, 0);
        await releaseFails(id, 1001, 0, /Not enough is held/, "TRF-001");
        await releaseFails(id, 900, 101, /Not enough is held/, "TRF-001");
        await release(id, 900, 100);
        expect(Number((await summary(id)).balance_minor)).toBe(0);
        await h.asServiceRole();
        await releaseFails(id, 1, 0, /Not enough is held/, "TRF-001");
      });
    });

    it("needs a positive amount and a transfer reference", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.asServiceRole();
        await releaseFails(id, 0, 0, /above zero/, "TRF-001");
        await releaseFails(id, 100, -1, /above zero/, "TRF-001");
        await releaseFails(id, 100, 0, /transfer reference/, " ");
      });
    });
  });

  describe("record_refund", () => {
    const refund = (id: string, ref = "RF-1", actor: string = admin.id) =>
      h.query("select public.record_refund($1, $2, $3) as amount", [id, actor, ref]);

    const refundFails = (id: string, pattern: RegExp, reference = "RF-1", actor: string = admin.id) =>
      h.expectError("select public.record_refund($1, $2, $3)", [id, actor, reference], pattern);

    it("refunds the full held balance and moves the order to refunded", async () => {
      await h.scenario(async () => {
        const id = await paidOrder();
        await h.asServer();
        await h.query("update public.orders set review_flags = array['stock_unavailable'] where id = $1", [
          id,
        ]);
        await h.actAs(buyer);
        await h.expectError("select public.record_refund($1, $2, 'RF-1')", [id, admin.id], PERMISSION_DENIED);
        await h.asServiceRole();
        await refundFails(id, /Only admins/, "RF-1", buyer.id);
        const r = await refund(id);
        expect(Number(r.rows[0].amount)).toBe(TOTAL);
        expect(await statusOf(id)).toBe("refunded");
        await h.asServer();
        const order = await one("select review_flags from public.orders where id = $1", [id]);
        expect(order.review_flags).toEqual([]);
        await h.actAs(admin);
        const s = await one("select * from public.order_ledger_summary($1)", [id]);
        expect(Number(s.refunded_minor)).toBe(TOTAL);
        expect(Number(s.balance_minor)).toBe(0);
        await h.asServiceRole();
        await refundFails(id, /cannot be refunded/, "RF-1", admin.id);
      });
    });

    it("waits for an open dispute to be resolved, then refunds a disputed order", async () => {
      await h.scenario(async () => {
        const id = await paidOrder();
        await h.asServer();
        await h.query("select public.transition_order($1, 'purchased')", [id]);
        await h.query("select public.transition_order($1, 'inspection_pending')", [id]);
        await h.query(
          "insert into public.disputes (order_id, raised_by, reason, previous_status) values ($1, $2, 'The serial number does not match.', 'inspection_pending')",
          [id, buyer.id],
        );
        await h.query("select public.transition_order($1, 'disputed')", [id]);
        await h.asServiceRole();
        await refundFails(id, /Resolve the dispute first/, "RF-1", admin.id);
        await h.actAs(admin);
        const disputeId = (await one("select id from public.disputes where order_id = $1", [id])).id;
        await h.query("select public.resolve_dispute($1, 'buyer', 'Serial mismatch confirmed.')", [
          disputeId,
        ]);
        await h.asServiceRole();
        await refund(id);
        expect(await statusOf(id)).toBe("refunded");
      });
    });

    it("is not available once the order is delivered, and needs a reference", async () => {
      await h.scenario(async () => {
        const id = await delivered();
        await h.asServiceRole();
        await refundFails(id, /cannot be refunded/, "RF-1", admin.id);
        const other = await paidOrder();
        await h.asServiceRole();
        await refundFails(other, /refund reference/, " ", admin.id);
      });
    });

    it("refunds nothing twice: a released order has nothing left to refund", async () => {
      await h.scenario(async () => {
        const id = await paidOrder();
        await h.asServer();
        await h.query(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, reference) values ($1, 'released_to_vendor', $2, 'NGN', 'x-ref')",
          [id, TOTAL],
        );
        await h.asServiceRole();
        await refundFails(id, /Nothing is held/, "RF-1", admin.id);
      });
    });
  });
});
