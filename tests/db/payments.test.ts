/**
 * Batch 5, step 1: catalog orders, payments and the ledger, tested as real
 * database roles. Money functions are for the service role only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: payments and the ledger", () => {
  const h = new DbHarness();
  let admin: TestUser;
  let buyer: TestUser;
  let other: TestUser;
  let vendorOwner: TestUser;
  let vendorId: string;
  let recipient: string;
  let cnNg: string;

  const LINES = [
    { type: "item_price", label: "Item price", amount_minor: 14_000_000 },
    { type: "service_fee", label: "Service fee", amount_minor: 1_000_000 },
  ];
  const TOTAL = 15_000_000;
  const SNAPSHOT = JSON.stringify({ engine_version: "1" });

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser();
    buyer = await h.createUser();
    other = await h.createUser();
    vendorOwner = await h.createUser();
    await h.setRoleAsServer(admin.id, "admin");
    await h.asServer();
    cnNg = (
      await one("select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'")
    ).id;
    vendorId = (
      await one(
        `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
         values ($1, 'Vendor One', 'CN', 'Shenzhen', 'approved', '+8613800000000', array['phones'], 'x/y.pdf') returning id`,
        [vendorOwner.id],
      )
    ).id;
    await h.setRoleAsServer(vendorOwner.id, "vendor");
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

  async function makeProduct(stock = 5, over: Record<string, unknown> = {}): Promise<string> {
    await h.asServer();
    const p = { price: 14_000_000, active: true, ...over };
    return (
      await one(
        `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, stock, weight_grams, active)
         values ($1, 'Test phone', 'A phone with enough description text.', 'phones', $2, 'NGN', $3, $4, 300, $5) returning id`,
        [vendorId, p.price, cnNg, stock, p.active],
      )
    ).id;
  }

  async function catalogOrder(
    productId: string,
    over: { quantity?: number; buyerId?: string; recipientId?: string; lines?: unknown } = {},
  ) {
    await h.asServiceRole();
    return (
      await one(
        "select public.create_catalog_order($1, $2, $3, $4, 'NGN', $5::jsonb, $6::jsonb, 300) as id",
        [
          over.buyerId ?? buyer.id,
          productId,
          over.quantity ?? 1,
          over.recipientId ?? recipient,
          JSON.stringify(over.lines ?? LINES),
          SNAPSHOT,
        ],
      )
    ).id as string;
  }

  async function openPayment(orderId: string, amount = TOTAL): Promise<string> {
    await h.asServiceRole();
    return (
      await one(
        "select public.create_payment($1, $2, $3, 'NGN', $4, '{\"method\":\"same_currency\"}'::jsonb) as id",
        [orderId, buyer.id, amount, TOTAL],
      )
    ).id as string;
  }

  async function pay(paymentId: string, paidAt: string | null = null) {
    await h.asServiceRole();
    return (
      await one("select public.apply_successful_payment($1, $2, '{\"ok\":true}'::jsonb) as r", [
        paymentId,
        paidAt,
      ])
    ).r as string;
  }

  const orderRow = async (id: string) => {
    await h.asServer();
    return one("select status, review_flags from public.orders where id = $1", [id]);
  };
  const stockOf = async (id: string) => {
    await h.asServer();
    return (await one("select stock from public.products where id = $1", [id])).stock as number;
  };
  const ledgerOf = async (orderId: string) => {
    await h.asServer();
    return (
      await h.query(
        "select entry_type::text as t, amount_minor::int as a from public.ledger_entries where order_id = $1 order by created_at, entry_type::text",
        [orderId],
      )
    ).rows;
  };

  describe("create_catalog_order", () => {
    it("creates an order waiting for payment with its item, a 30-minute quote, lines and snapshot", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct();
        const orderId = await catalogOrder(productId, { quantity: 2 });
        await h.asServer();
        const order = await one(
          "select status, order_type, vendor_id, quantity, buyer_currency, recipient_id from public.orders where id = $1",
          [orderId],
        );
        expect(order).toMatchObject({
          status: "awaiting_payment",
          order_type: "catalog",
          vendor_id: vendorId,
          quantity: 2,
          buyer_currency: "NGN",
        });
        const item = await one(
          "select product_id, quantity, unit_price_minor::int as price, description from public.order_items where order_id = $1",
          [orderId],
        );
        expect(item).toMatchObject({
          product_id: productId,
          quantity: 2,
          price: 14_000_000,
          description: "Test phone",
        });
        const quote = await one(
          "select status, total_minor::int as total, version, expires_at - created_at as window, prepared_by from public.quotes where order_id = $1",
          [orderId],
        );
        expect(quote).toMatchObject({ status: "sent", total: TOTAL, version: 1, prepared_by: buyer.id });
        expect(quote.window.minutes).toBe(30);
        expect((await one("select count(*)::int as n from public.quote_lines")).n).toBe(2);
        expect((await one("select count(*)::int as n from public.quote_pricing_snapshots")).n).toBe(1);
        // The stock is not touched until payment.
        expect(await stockOf(productId)).toBe(5);
      });
    });

    it("refuses an unavailable product, too little stock, someone else's recipient, a bad quantity and bad lines", async () => {
      await h.scenario(async () => {
        const ok = await makeProduct(3);
        const inactive = await makeProduct(3, { active: false });
        const expectRefused = async (args: unknown[], pattern: RegExp) => {
          await h.asServiceRole();
          await h.expectError(
            "select public.create_catalog_order($1, $2, $3, $4, 'NGN', $5::jsonb, $6::jsonb, 300)",
            args,
            pattern,
          );
        };
        const base = [buyer.id, ok, 1, recipient, JSON.stringify(LINES), SNAPSHOT];
        await expectRefused(
          [buyer.id, inactive, 1, recipient, JSON.stringify(LINES), SNAPSHOT],
          /not available/,
        );
        await expectRefused([buyer.id, ok, 4, recipient, JSON.stringify(LINES), SNAPSHOT], /Only 3 in stock/);
        await expectRefused(
          [other.id, ok, 1, recipient, JSON.stringify(LINES), SNAPSHOT],
          /Choose one of your recipients/,
        );
        await expectRefused([buyer.id, ok, 0, recipient, JSON.stringify(LINES), SNAPSHOT], /quantity/);
        await expectRefused([buyer.id, ok, 101, recipient, JSON.stringify(LINES), SNAPSHOT], /quantity/);
        await expectRefused(
          [
            buyer.id,
            ok,
            1,
            recipient,
            JSON.stringify([{ type: "service_fee", label: "x", amount_minor: 5 }]),
            SNAPSHOT,
          ],
          /not valid/,
        );
        await expectRefused([buyer.id, ok, 1, recipient, JSON.stringify(LINES), null], /pricing snapshot/);
        await expectRefused(
          [
            buyer.id,
            ok,
            1,
            recipient,
            JSON.stringify([{ type: "item_price", label: "x", amount_minor: -5 }]),
            SNAPSHOT,
          ],
          /invalid amount/,
        );
        expect(base).toHaveLength(6);
      });
    });

    it("is for server code only: browsers cannot call it, so no one can send their own price", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct();
        for (const who of [buyer, admin, "anon" as const]) {
          await h.actAs(who);
          await h.expectError(
            "select public.create_catalog_order($1, $2, 1, $3, 'NGN', $4::jsonb, $5::jsonb)",
            [
              buyer.id,
              productId,
              recipient,
              JSON.stringify([{ type: "item_price", label: "x", amount_minor: 1 }]),
              SNAPSHOT,
            ],
            PERMISSION_DENIED,
          );
        }
      });
    });

    it("caps unpaid checkouts at 20 a day", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct(50);
        for (let i = 0; i < 20; i++) await catalogOrder(productId);
        await h.asServiceRole();
        await h.expectError(
          "select public.create_catalog_order($1, $2, 1, $3, 'NGN', $4::jsonb, $5::jsonb)",
          [buyer.id, productId, recipient, JSON.stringify(LINES), SNAPSHOT],
          /many unpaid orders/,
        );
      });
    });
  });

  describe("create_payment", () => {
    it("opens a pending payment whose reference is its own id, in naira, tied to the quote", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.asServer();
        const payment = await one(
          "select provider, provider_reference, status, currency, amount_minor::int as amount, display_currency, display_amount_minor::int as shown, quote_id from public.payments where id = $1",
          [paymentId],
        );
        expect(payment).toMatchObject({
          provider: "paystack",
          provider_reference: paymentId,
          status: "pending",
          currency: "NGN",
          amount: TOTAL,
          display_currency: "NGN",
          shown: TOTAL,
        });
        expect(payment.quote_id).toBeTruthy();
      });
    });

    it("refuses another buyer, a wrong amount against the quote, a paid order and an expired quote", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        await h.asServiceRole();
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'NGN', $4)",
          [orderId, other.id, TOTAL, TOTAL],
          /Order not found/,
        );
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'NGN', $4)",
          [orderId, buyer.id, TOTAL, TOTAL - 1],
          /does not match the quote/,
        );
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'GBP', $4)",
          [orderId, buyer.id, TOTAL, TOTAL],
          /does not match the quote/,
        );
        await h.expectError(
          "select public.create_payment($1, $2, 0, 'NGN', $3)",
          [orderId, buyer.id, TOTAL],
          /not valid/,
        );

        await pay(await openPayment(orderId));
        await h.asServiceRole();
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'NGN', $4)",
          [orderId, buyer.id, TOTAL, TOTAL],
          /not waiting for payment/,
        );

        const second = await catalogOrder(await makeProduct());
        await h.asServer();
        await h.query("alter table public.quotes disable trigger quotes_guard_update");
        await h.query(
          "update public.quotes set expires_at = now() - interval '1 minute' where order_id = $1",
          [second],
        );
        await h.query("alter table public.quotes enable trigger quotes_guard_update");
        await h.asServiceRole();
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'NGN', $4)",
          [second, buyer.id, TOTAL, TOTAL],
          /quote has expired/,
        );
      });
    });

    it("limits attempts to 10 an hour per order", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        for (let i = 0; i < 10; i++) await openPayment(orderId);
        await h.asServiceRole();
        await h.expectError(
          "select public.create_payment($1, $2, $3, 'NGN', $4)",
          [orderId, buyer.id, TOTAL, TOTAL],
          /Too many payment attempts/,
        );
      });
    });

    it("is for server code only", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        for (const who of [buyer, admin]) {
          await h.actAs(who);
          await h.expectError(
            "select public.create_payment($1, $2, $3, 'NGN', $4)",
            [orderId, buyer.id, TOTAL, TOTAL],
            PERMISSION_DENIED,
          );
        }
      });
    });
  });

  describe("apply_successful_payment", () => {
    it("marks the payment, moves the order to paid, writes payment_received and held, and takes the stock", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct(5);
        const orderId = await catalogOrder(productId, { quantity: 2 });
        const paymentId = await openPayment(orderId);
        expect(await pay(paymentId, new Date().toISOString())).toBe("applied");

        expect(await orderRow(orderId)).toEqual({ status: "paid", review_flags: [] });
        expect(await ledgerOf(orderId)).toEqual([
          { t: "held", a: TOTAL },
          { t: "payment_received", a: TOTAL },
        ]);
        expect(await stockOf(productId)).toBe(3);
        await h.asServer();
        const payment = await one("select status, paid_at from public.payments where id = $1", [paymentId]);
        expect(payment.status).toBe("success");
        expect(payment.paid_at).not.toBeNull();
        const audit = await one(
          "select details from public.audit_log where entity_id = $1 and action = 'order.status_changed'",
          [orderId],
        );
        expect(audit.details).toMatchObject({ from: "awaiting_payment", to: "paid" });
      });
    });

    it("changes nothing the second time: same order, same ledger, same stock", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct(5);
        const orderId = await catalogOrder(productId);
        const paymentId = await openPayment(orderId);
        expect(await pay(paymentId)).toBe("applied");
        expect(await pay(paymentId)).toBe("already_applied");
        expect(await pay(paymentId)).toBe("already_applied");
        expect(await ledgerOf(orderId)).toHaveLength(2);
        expect(await stockOf(productId)).toBe(4);
        expect((await orderRow(orderId)).status).toBe("paid");
      });
    });

    it("keeps a payment that arrives after the quote expired, and flags the order for review", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct();
        const orderId = await catalogOrder(productId);
        const paymentId = await openPayment(orderId);
        await h.asServer();
        await h.query("alter table public.quotes disable trigger quotes_guard_update");
        await h.query(
          "update public.quotes set expires_at = now() - interval '10 minutes' where order_id = $1",
          [orderId],
        );
        await h.query("alter table public.quotes enable trigger quotes_guard_update");

        expect(await pay(paymentId, new Date().toISOString())).toBe("applied_flagged");
        expect(await orderRow(orderId)).toEqual({
          status: "paid",
          review_flags: ["paid_after_quote_expired"],
        });
        expect(await ledgerOf(orderId)).toHaveLength(2);
        await h.asServer();
        expect(
          (
            await one(
              "select count(*)::int as n from public.notifications where template = 'order_needs_review'",
            )
          ).n,
        ).toBe(1);
      });
    });

    it("does not flag a payment made before the quote ran out, even if confirmed later", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.asServer();
        await h.query("alter table public.quotes disable trigger quotes_guard_update");
        await h.query(
          "update public.quotes set expires_at = now() - interval '1 minute' where order_id = $1",
          [orderId],
        );
        await h.query("alter table public.quotes enable trigger quotes_guard_update");
        // Paystack says it was paid 5 minutes ago, before the quote's time ran out.
        expect(await pay(paymentId, new Date(Date.now() - 5 * 60_000).toISOString())).toBe("applied");
        expect((await orderRow(orderId)).review_flags).toEqual([]);
      });
    });

    it("flags the order for a refund when the stock ran out, and does not make stock negative", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct(1);
        const first = await catalogOrder(productId);
        const second = await catalogOrder(productId);
        expect(await pay(await openPayment(first))).toBe("applied");
        expect(await pay(await openPayment(second))).toBe("applied_flagged");
        expect(await stockOf(productId)).toBe(0);
        expect((await orderRow(first)).review_flags).toEqual([]);
        expect(await orderRow(second)).toEqual({ status: "paid", review_flags: ["stock_unavailable"] });
        // Both payments are held: the second buyer's money is waiting for a refund.
        expect(await ledgerOf(second)).toEqual([
          { t: "held", a: TOTAL },
          { t: "payment_received", a: TOTAL },
        ]);
      });
    });

    it("keeps a second payment for an order already paid, and flags it as a duplicate", async () => {
      await h.scenario(async () => {
        const productId = await makeProduct(5);
        const orderId = await catalogOrder(productId);
        const a = await openPayment(orderId);
        const b = await openPayment(orderId);
        expect(await pay(a)).toBe("applied");
        expect(await pay(b)).toBe("applied_flagged");
        expect(await orderRow(orderId)).toEqual({ status: "paid", review_flags: ["duplicate_payment"] });
        expect(await stockOf(productId)).toBe(4); // taken once only
        expect((await ledgerOf(orderId)).filter((e) => e.t === "held")).toHaveLength(2);
      });
    });

    it("keeps a payment for an order that was cancelled, and flags it", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.actAs(buyer);
        await h.query("select public.cancel_unpaid_order($1)", [orderId]);
        expect(await pay(paymentId)).toBe("applied_flagged");
        expect(await orderRow(orderId)).toEqual({
          status: "cancelled",
          review_flags: ["payment_on_closed_order"],
        });
      });
    });

    it("refuses a payment that is on hold after a mismatch", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.asServiceRole();
        await h.query("select public.mark_payment_status($1, 'mismatch', '{}'::jsonb)", [paymentId]);
        await h.expectError("select public.apply_successful_payment($1)", [paymentId], /on hold/);
        expect((await orderRow(orderId)).status).toBe("awaiting_payment");
        await h.asServer();
        expect(
          (
            await one(
              "select count(*)::int as n from public.notifications where template = 'payment_mismatch'",
            )
          ).n,
        ).toBe(1);
      });
    });

    it("is for server code only", async () => {
      await h.scenario(async () => {
        const paymentId = await openPayment(await catalogOrder(await makeProduct()));
        for (const who of [buyer, admin, vendorOwner, "anon" as const]) {
          await h.actAs(who);
          await h.expectError("select public.apply_successful_payment($1)", [paymentId], PERMISSION_DENIED);
          await h.expectError(
            "select public.mark_payment_status($1, 'failed')",
            [paymentId],
            PERMISSION_DENIED,
          );
        }
      });
    });
  });

  describe("payments table", () => {
    it("never changes an amount, order or reference, and never deletes", async () => {
      await h.scenario(async () => {
        const paymentId = await openPayment(await catalogOrder(await makeProduct()));
        await h.asServer();
        await h.expectError(
          "update public.payments set amount_minor = 1 where id = $1",
          [paymentId],
          /amount and order cannot change/,
        );
        await h.expectError(
          "update public.payments set provider_reference = 'x' where id = $1",
          [paymentId],
          /cannot change/,
        );
        await h.expectError(
          "update public.payments set currency = 'USD' where id = $1",
          [paymentId],
          /cannot change/,
        );
        await h.expectError("delete from public.payments where id = $1", [paymentId], /never deleted/);
      });
    });

    it("lets a status move forward only: success is final, and failed can still become success", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.asServiceRole();
        await h.query("select public.mark_payment_status($1, 'failed')", [paymentId]);
        await pay(paymentId); // money arrived after all
        await h.asServer();
        await h.expectError(
          "update public.payments set status = 'pending' where id = $1",
          [paymentId],
          /cannot move/,
        );
        await h.expectError(
          "update public.payments set status = 'failed' where id = $1",
          [paymentId],
          /cannot move/,
        );
      });
    });

    it("is readable by admins only, and no browser can write it", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        await openPayment(orderId);
        await h.actAs(admin);
        expect((await one("select count(*)::int as n from public.payments")).n).toBe(1);
        for (const who of [buyer, other, vendorOwner]) {
          await h.actAs(who);
          expect((await one("select count(*)::int as n from public.payments")).n).toBe(0);
          await h.expectError("update public.payments set status = 'success'", [], PERMISSION_DENIED);
          await h.expectError(
            "insert into public.payments (order_id, provider, provider_reference, amount_minor, currency, status) values ($1, 'paystack', 'x', 1, 'NGN', 'success')",
            [orderId],
            PERMISSION_DENIED,
          );
        }
      });
    });
  });

  describe("ledger", () => {
    async function heldOrder(amount = TOTAL) {
      const orderId = await catalogOrder(await makeProduct());
      await pay(await openPayment(orderId, amount));
      await h.asServer();
      return orderId;
    }
    const entry = (orderId: string, type: string, amount: number) =>
      h.query(
        "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, reference) values ($1, $2, $3, 'NGN', 'ref-1')",
        [orderId, type, amount],
      );

    it("cannot be changed or deleted, by anyone", async () => {
      await h.scenario(async () => {
        const orderId = await heldOrder();
        await h.asServer();
        await h.expectError("update public.ledger_entries set amount_minor = 1", [], /append-only/);
        await h.expectError("delete from public.ledger_entries", [], /append-only/);
        await h.asServiceRole();
        await h.expectError(
          "update public.ledger_entries set note = 'x' where order_id = $1",
          [orderId],
          /append-only/,
        );
        await h.actAs(admin);
        await h.expectError("delete from public.ledger_entries", [], PERMISSION_DENIED);
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'held', 5, 'NGN')",
          [orderId],
          PERMISSION_DENIED,
        );
      });
    });

    it("blocks a release, fee or refund that would take the held balance below zero", async () => {
      await h.scenario(async () => {
        const orderId = await heldOrder();
        await h.asServer();
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'released_to_vendor', $2, 'NGN')",
          [orderId, TOTAL + 1],
          /Not enough is held/,
        );
        await entry(orderId, "released_to_vendor", 14_000_000);
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'platform_fee', $2, 'NGN')",
          [orderId, 1_000_001],
          /Not enough is held/,
        );
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'refunded_to_buyer', $2, 'NGN')",
          [orderId, 1_000_001],
          /Not enough is held/,
        );
        await entry(orderId, "platform_fee", 1_000_000);
        // Fully paid out: nothing more can leave, not even a naira.
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'refunded_to_buyer', 1, 'NGN')",
          [orderId],
          /Not enough is held/,
        );
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'released_to_vendor', 1, 'NGN')",
          [orderId],
          /Not enough is held/,
        );
      });
    });

    it("blocks money leaving an order that never received any", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        await h.asServer();
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'released_to_vendor', 1, 'NGN')",
          [orderId],
          /Not enough is held/,
        );
      });
    });

    it("keeps each order's balance separate", async () => {
      await h.scenario(async () => {
        const a = await heldOrder(TOTAL);
        const b = await heldOrder(TOTAL);
        await h.asServer();
        await entry(a, "released_to_vendor", TOTAL);
        await entry(b, "refunded_to_buyer", 5_000_000);
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'refunded_to_buyer', 10000001, 'NGN')",
          [b],
          /Not enough is held/,
        );
      });
    });

    it("rejects an adjustment, a held amount with no payment, and a second 'held' for the same payment", async () => {
      await h.scenario(async () => {
        const orderId = await heldOrder();
        await h.asServer();
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'adjustment', 5, 'NGN')",
          [orderId],
          /Adjustments are not available/,
        );
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency) values ($1, 'held', 5, 'NGN')",
          [orderId],
          /belongs to a payment/,
        );
        const paymentId = (await one("select id from public.payments where order_id = $1", [orderId])).id;
        await h.expectError(
          "insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, payment_id) values ($1, 'held', 5, 'NGN', $2)",
          [orderId, paymentId],
          /ledger_entries_payment_once_idx/,
        );
      });
    });

    it("gives admins a summary: held, released, refunded, fee and balance", async () => {
      await h.scenario(async () => {
        const orderId = await heldOrder();
        await h.asServer();
        await entry(orderId, "released_to_vendor", 9_000_000);
        await entry(orderId, "platform_fee", 1_000_000);
        await entry(orderId, "refunded_to_buyer", 2_000_000);
        await h.actAs(admin);
        expect(await one("select * from public.order_ledger_summary($1)", [orderId])).toEqual({
          held_minor: String(TOTAL),
          released_minor: "9000000",
          refunded_minor: "2000000",
          platform_fee_minor: "1000000",
          balance_minor: "3000000",
          currency: "NGN",
        });
        for (const who of [buyer, vendorOwner]) {
          await h.actAs(who);
          await h.expectError("select * from public.order_ledger_summary($1)", [orderId], /Only admins/);
        }
      });
    });
  });

  describe("cancelling and review flags", () => {
    it("lets the buyer cancel an unpaid order, which abandons pending payments; not another buyer's, not a paid one", async () => {
      await h.scenario(async () => {
        const orderId = await catalogOrder(await makeProduct());
        const paymentId = await openPayment(orderId);
        await h.actAs(other);
        await h.expectError("select public.cancel_unpaid_order($1)", [orderId], /Order not found/);
        await h.actAs(buyer);
        await h.query("select public.cancel_unpaid_order($1)", [orderId]);
        expect((await orderRow(orderId)).status).toBe("cancelled");
        await h.asServer();
        expect((await one("select status from public.payments where id = $1", [paymentId])).status).toBe(
          "abandoned",
        );

        const paid = await catalogOrder(await makeProduct());
        await pay(await openPayment(paid));
        await h.actAs(buyer);
        await h.expectError("select public.cancel_unpaid_order($1)", [paid], /Only an unpaid order/);
      });
    });

    it("lets an admin clear flags with a note, written to the audit log", async () => {
      await h.scenario(async () => {
        const stocked = await makeProduct(1);
        const first = await catalogOrder(stocked);
        const second = await catalogOrder(stocked);
        await pay(await openPayment(first));
        await pay(await openPayment(second));
        await h.actAs(admin);
        await h.expectError("select public.clear_order_flags($1, 'ok')", [second], /at least 5 characters/);
        await h.query("select public.clear_order_flags($1, 'Refunded in the Paystack dashboard')", [second]);
        expect((await orderRow(second)).review_flags).toEqual([]);
        const audit = await one(
          "select details, actor_id from public.audit_log where entity_id = $1 and action = 'order.flags_cleared'",
          [second],
        );
        expect(audit.actor_id).toBe(admin.id);
        expect(audit.details).toMatchObject({
          flags: ["stock_unavailable"],
          note: "Refunded in the Paystack dashboard",
        });
        await h.actAs(buyer);
        await h.expectError("select public.clear_order_flags($1, 'trying my luck')", [second], /Only admins/);
      });
    });
  });
});
