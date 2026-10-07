/**
 * Batch 3: link orders, the order state machine, quotes, messages, recipients.
 * Tested as real database roles. Quote times are moved by briefly switching
 * off the "sent quotes cannot change" trigger inside the test's transaction,
 * which is rolled back at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canTransition,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "@/lib/orders/state-machine";
import { matchStoreDomain, type StoreRule } from "@/lib/orders/store-domains";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, RLS_DENIED, type TestUser } from "./harness";

const LINES = [
  { type: "item_price", label: "Phone, 1 unit", amount_minor: 12_000_000 },
  { type: "service_fee", label: "Service fee", amount_minor: 600_000 },
  { type: "international_freight", label: "Freight from China", amount_minor: 2_500_000 },
  { type: "customs_estimate", label: "Customs and clearing", amount_minor: 1_800_000 },
  { type: "last_mile_delivery", label: "Delivery to Port Harcourt", amount_minor: 450_000 },
];
const LINES_TOTAL = 17_350_000;

describe.skipIf(!DATABASE_URL)("database: link orders, quotes and the state machine", () => {
  const h = new DbHarness();

  let admin: TestUser;
  let buyerA: TestUser;
  let buyerB: TestUser;
  let recipientA: string;
  let recipientB: string;
  let cnNg: string;

  async function makeRecipient(
    owner: TestUser,
    overrides: Record<string, string | boolean> = {},
  ): Promise<string> {
    await h.asServer();
    const r = {
      full_name: "Mama Obi",
      phone: "+2348031234567",
      address_line: "12 Aba Road",
      city: "Port Harcourt",
      state: "Rivers",
      country_code: "NG",
      archived: false,
      ...overrides,
    };
    const { rows } = await h.query(
      `insert into public.recipients (created_by, full_name, phone, address_line, city, state, country_code, archived)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [owner.id, r.full_name, r.phone, r.address_line, r.city, r.state, r.country_code, r.archived],
    );
    return rows[0].id;
  }

  type LinkOverrides = Partial<{
    url: string;
    quantity: number;
    variant: string | null;
    notes: string | null;
    budget: number | null;
    recipient: string;
    currency: string;
  }>;

  /** Creates a link order the way the app does: through the database function, as the buyer. */
  async function linkOrder(owner: TestUser, o: LinkOverrides = {}): Promise<string> {
    await h.actAs(owner);
    const { rows } = await h.query("select public.create_link_order($1, $2, $3, $4, $5, $6, $7) as id", [
      o.url ?? "https://www.aliexpress.com/item/1005001.html",
      o.quantity ?? 1,
      o.variant === undefined ? "Black, 256GB" : o.variant,
      o.notes === undefined ? null : o.notes,
      o.budget === undefined ? null : o.budget,
      o.recipient ?? (owner === buyerB ? recipientB : recipientA),
      o.currency ?? "NGN",
    ]);
    return rows[0].id;
  }

  async function sendQuote(
    orderId: string,
    options: {
      lines?: unknown;
      hours?: number;
      weight?: number | null;
      notes?: string | null;
      corridor?: string | null;
      confirm?: boolean;
    } = {},
  ): Promise<string> {
    await h.actAs(admin);
    const { rows } = await h.query("select public.send_quote($1, $2::jsonb, $3, $4, $5, $6, $7) as id", [
      orderId,
      JSON.stringify(options.lines ?? LINES),
      options.hours ?? 48,
      options.weight === undefined ? 1200 : options.weight,
      options.notes === undefined ? null : options.notes,
      options.corridor === undefined ? null : options.corridor,
      options.confirm ?? false,
    ]);
    return rows[0].id;
  }

  async function orderRow(orderId: string) {
    await h.asServer();
    const { rows } = await h.query("select * from public.orders where id = $1", [orderId]);
    return rows[0];
  }

  async function quotesOf(orderId: string) {
    await h.asServer();
    const { rows } = await h.query(
      "select version, status, total_minor from public.quotes where order_id = $1 order by version",
      [orderId],
    );
    return rows;
  }

  /** Moves the waiting quote's expiry into the past. */
  async function backdateQuote(orderId: string, interval = "1 minute"): Promise<void> {
    await h.asServer();
    await h.query("alter table public.quotes disable trigger quotes_guard_update");
    await h.query(
      "update public.quotes set expires_at = now() - $2::interval where order_id = $1 and status = 'sent'",
      [orderId, interval],
    );
    await h.query("alter table public.quotes enable trigger quotes_guard_update");
  }

  async function notificationsFor(templateName: string) {
    await h.asServer();
    const { rows } = await h.query(
      "select user_id, audience, status, payload from public.notifications where template = $1 order by created_at",
      [templateName],
    );
    return rows;
  }

  async function auditActions(entityId: string): Promise<string[]> {
    await h.asServer();
    const { rows } = await h.query(
      "select action from public.audit_log where entity_id = $1 order by created_at, id",
      [entityId],
    );
    return rows.map((r) => r.action);
  }

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser({ full_name: "Admin" });
    buyerA = await h.createUser({ full_name: "Buyer A", country_code: "GB" });
    buyerB = await h.createUser({ full_name: "Buyer B", country_code: "US" });
    await h.setRoleAsServer(admin.id, "admin");
    cnNg = (
      await h.query(
        "select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'",
      )
    ).rows[0].id;
    recipientA = await makeRecipient(buyerA);
    recipientB = await makeRecipient(buyerB, { full_name: "Mr B", city: "Ikeja", state: "Lagos" });
  });

  afterAll(() => h.stop());

  // -------------------------------------------------------------------------
  describe("state machine", () => {
    it("holds exactly the moves in lib/orders/state-machine.ts", async () => {
      await h.asServer();
      const { rows } = await h.query("select from_status, to_status from public.order_status_transitions");
      const inDatabase = rows.map((r) => `${r.from_status}>${r.to_status}`).sort();
      const inCode = ORDER_STATUSES.flatMap((from) =>
        ORDER_TRANSITIONS[from].map((to) => `${from}>${to}`),
      ).sort();
      expect(inDatabase).toEqual(inCode);
      expect(inCode).toHaveLength(42);
    });

    it("allows exactly the mapped moves and refuses the other pairs (all 324 tried)", async () => {
      let allowed = 0;
      let refused = 0;
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          await h.scenario(async () => {
            await h.asServer();
            const { rows } = await h.query(
              `insert into public.orders (buyer_id, order_type, status, source_url, buyer_currency)
               values ($1, 'link', $2, 'https://example.com/x', 'NGN') returning id`,
              [buyerA.id, from],
            );
            if (canTransition(from as OrderStatus, to as OrderStatus)) {
              const result = await h.query(
                "select public.transition_order($1, $2::public.order_status) as status",
                [rows[0].id, to],
              );
              expect(result.rows[0].status, `${from} to ${to}`).toBe(to);
              expect(
                (await h.query("select status from public.orders where id = $1", [rows[0].id])).rows[0]
                  .status,
              ).toBe(to);
              allowed++;
            } else {
              await h.expectError(
                "select public.transition_order($1, $2::public.order_status)",
                [rows[0].id, to],
                /cannot move from/,
              );
              expect(
                (await h.query("select status from public.orders where id = $1", [rows[0].id])).rows[0]
                  .status,
              ).toBe(from);
              refused++;
            }
          });
        }
      }
      expect(allowed).toBe(42);
      expect(refused).toBe(282);
    });

    it("names the forbidden examples: a request cannot jump to delivered, and final states stay final", async () => {
      for (const [from, to] of [
        ["quote_requested", "delivered"],
        ["quote_requested", "awaiting_payment"],
        ["quote_requested", "paid"],
        ["quoted", "paid"],
        ["quoted", "quote_requested"],
        ["awaiting_payment", "shipped"],
        ["paid", "delivered"],
        ["shipped", "paid"],
        ["delivered", "shipped"],
        ["cancelled", "quote_requested"],
        ["refunded", "paid"],
        ["quote_expired", "quoted"],
      ] as const) {
        expect(canTransition(from, to), `${from} to ${to}`).toBe(false);
      }
    });

    it("refuses any status change that does not come from transition_order(), for every role", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.expectError(
          "update public.orders set status = 'cancelled' where id = $1",
          [orderId],
          PERMISSION_DENIED,
        );
        await h.actAs(admin);
        await h.expectError(
          "update public.orders set status = 'cancelled' where id = $1",
          [orderId],
          PERMISSION_DENIED,
        );
        await h.asServiceRole();
        await h.expectError(
          "update public.orders set status = 'quoted' where id = $1",
          [orderId],
          /only change through transition_order/,
        );
        await h.asServer();
        await h.expectError(
          "update public.orders set status = 'quoted' where id = $1",
          [orderId],
          /only change through transition_order/,
        );
        expect((await orderRow(orderId)).status).toBe("quote_requested");
      });
    });

    it("cannot be called by browser sessions", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        for (const who of [buyerA, admin, "anon"] as const) {
          await h.actAs(who);
          await h.expectError(
            "select public.transition_order($1, 'cancelled')",
            [orderId],
            PERMISSION_DENIED,
          );
        }
        await h.asServiceRole();
        await h.query("select public.transition_order($1, 'cancelled', 'Test', $2)", [orderId, admin.id]);
        expect((await orderRow(orderId)).status).toBe("cancelled");
      });
    });

    it("writes the move to the audit log with who, from, to and the note", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.asServiceRole();
        await h.query("select public.transition_order($1, 'cancelled', 'Out of stock at the store', $2)", [
          orderId,
          admin.id,
        ]);
        await h.asServer();
        const { rows } = await h.query(
          "select actor_id, details from public.audit_log where entity_id = $1 and action = 'order.status_changed'",
          [orderId],
        );
        expect(rows).toEqual([
          {
            actor_id: admin.id,
            details: { from: "quote_requested", to: "cancelled", note: "Out of stock at the store" },
          },
        ]);
      });
    });

    it("reports an unknown order", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.expectError(
          "select public.transition_order('00000000-0000-4000-8000-000000000000', 'cancelled')",
          [],
          /Order not found/,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("stores", () => {
    it("seeds the stores from the brief", async () => {
      await h.asServer();
      const { rows } = await h.query(
        `select s.domain, s.supported, s.preview_allowed, c.origin_country || '-' || c.destination_country as route
           from public.store_domains s left join public.corridors c on c.id = s.corridor_id order by s.domain`,
      );
      expect(rows).toEqual([
        { domain: "1688.com", supported: true, preview_allowed: false, route: "CN-NG" },
        { domain: "aliexpress.com", supported: true, preview_allowed: true, route: "CN-NG" },
        { domain: "amazon.co.uk", supported: false, preview_allowed: false, route: null },
        { domain: "amazon.com", supported: false, preview_allowed: false, route: null },
        { domain: "jumia.com.ng", supported: true, preview_allowed: true, route: "NG-NG" },
        { domain: "konga.com", supported: true, preview_allowed: true, route: "NG-NG" },
        { domain: "taobao.com", supported: true, preview_allowed: false, route: "CN-NG" },
        { domain: "temu.com", supported: true, preview_allowed: true, route: "CN-NG" },
      ]);
    });

    it("matches hosts in SQL exactly as lib/orders/store-domains.ts does", async () => {
      await h.asServer();
      const stores = (
        await h.query(
          "select id, domain, display_name, corridor_id, preview_allowed, supported from public.store_domains",
        )
      ).rows as StoreRule[];
      for (const host of [
        "aliexpress.com",
        "www.aliexpress.com",
        "m.aliexpress.com",
        "ALIEXPRESS.COM",
        "aliexpress.com.",
        "a.b.c.aliexpress.com",
        "evilaliexpress.com",
        "aliexpress.com.evil.com",
        "notamazon.com",
        "amazon.com",
        "smile.amazon.co.uk",
        "amazon.co.in",
        "jumia.com.ng",
        "www.jumia.com.ng",
        "jumia.com",
        "konga.com",
        "example.com",
        "com",
        "",
      ]) {
        const sql =
          (await h.query("select domain from public.match_store_domain($1)", [host])).rows[0]?.domain ?? null;
        expect(sql, host).toBe(matchStoreDomain(host, stores)?.domain ?? null);
      }
    });

    it("hides admin notes from buyers, who read the store directory instead", async () => {
      await h.scenario(async () => {
        await h.actAs(buyerA);
        expect((await h.query("select * from public.store_domains")).rowCount).toBe(0);
        const directory = await h.query("select * from public.store_directory order by domain");
        expect(directory.rowCount).toBe(8);
        expect(directory.fields.map((f) => f.name)).toEqual([
          "id",
          "domain",
          "display_name",
          "corridor_id",
          "preview_allowed",
          "supported",
        ]);
        await h.actAs("anon");
        await h.expectError("select * from public.store_directory", [], PERMISSION_DENIED);
      });
    });

    it("lets only admins edit stores", async () => {
      await h.scenario(async () => {
        await h.actAs(buyerA);
        await h.expectError(
          "insert into public.store_domains (domain, display_name, supported) values ('shein.com', 'Shein', false)",
          [],
          RLS_DENIED,
        );
        expect(
          (await h.query("update public.store_domains set supported = false where domain = 'konga.com'"))
            .rowCount,
        ).toBe(0);
        await h.actAs(admin);
        expect(
          (await h.query("update public.store_domains set supported = false where domain = 'konga.com'"))
            .rowCount,
        ).toBe(1);
        await h.expectError(
          "insert into public.store_domains (domain, display_name, supported) values ('shein.com', 'Shein', true)",
          [],
          /store_domains_supported_needs_corridor/,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("creating a link order", () => {
    it("creates the order, its item, an audit row and an admin notification together", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA, {
          quantity: 2,
          variant: "Black, 256GB",
          notes: "Please check the seller rating",
          budget: 20_000_000,
          currency: "ngn",
        });
        const order = await orderRow(orderId);
        expect(order).toMatchObject({
          buyer_id: buyerA.id,
          recipient_id: recipientA,
          corridor_id: cnNg,
          order_type: "link",
          status: "quote_requested",
          source_url: "https://www.aliexpress.com/item/1005001.html",
          source_host: "www.aliexpress.com",
          buyer_currency: "NGN",
          quantity: 2,
          variant_notes: "Black, 256GB",
          buyer_notes: "Please check the seller rating",
          max_budget_minor: "20000000",
          decline_reason: null,
        });
        expect(order.store_domain_id).not.toBeNull();
        expect(order.public_tracking_token).toMatch(/^[0-9a-f]{32}$/);

        await h.asServer();
        const items = await h.query(
          "select description, quantity, unit_price_minor, currency from public.order_items where order_id = $1",
          [orderId],
        );
        expect(items.rows).toEqual([
          { description: "Item from AliExpress", quantity: 2, unit_price_minor: "0", currency: "NGN" },
        ]);

        const notes = await notificationsFor("quote_requested");
        expect(notes).toEqual([
          {
            user_id: null,
            audience: "admins",
            status: "pending",
            payload: { order_id: orderId, unknown_store: false },
          },
        ]);
        expect(await auditActions(orderId)).toEqual(["order.created"]);
      });
    });

    it("maps subdomains and each supported store to its corridor", async () => {
      await h.scenario(async () => {
        const cases: [string, string][] = [
          ["https://m.aliexpress.com/item/1.html", "CN-NG"],
          ["https://a.aliexpress.com/_Abc123", "CN-NG"],
          ["https://detail.1688.com/offer/1.html", "CN-NG"],
          ["https://item.taobao.com/item.htm?id=1", "CN-NG"],
          ["https://www.temu.com/goods.html?goods_id=1", "CN-NG"],
          ["https://www.jumia.com.ng/product-1.html", "NG-NG"],
          ["https://www.konga.com/product/1", "NG-NG"],
        ];
        for (const [url, route] of cases) {
          const id = await linkOrder(buyerA, { url });
          await h.asServer();
          const { rows } = await h.query(
            "select c.origin_country || '-' || c.destination_country as route from public.orders o join public.corridors c on c.id = o.corridor_id where o.id = $1",
            [id],
          );
          expect(rows[0].route, url).toBe(route);
        }
      });
    });

    it("lets an unknown store through with no corridor, and tells admins", async () => {
      await h.scenario(async () => {
        const id = await linkOrder(buyerA, { url: "https://www.evilaliexpress.com/item/1" });
        const order = await orderRow(id);
        expect(order).toMatchObject({
          corridor_id: null,
          store_domain_id: null,
          source_host: "www.evilaliexpress.com",
          status: "quote_requested",
        });
        expect((await notificationsFor("quote_requested"))[0].payload).toEqual({
          order_id: id,
          unknown_store: true,
        });
      });
    });

    it("blocks unsupported stores with a clear message and creates nothing", async () => {
      await h.scenario(async () => {
        for (const url of [
          "https://www.amazon.com/dp/B0123",
          "https://smile.amazon.co.uk/dp/B0123",
          "https://AMAZON.COM/x",
        ]) {
          await h.actAs(buyerA);
          await h.expectError(
            "select public.create_link_order($1, 1, null, null, null, $2, 'NGN')",
            [url, recipientA],
            /We cannot buy from Amazon( UK)? yet\. Please send a link from a store we support\./,
          );
        }
        await h.asServer();
        expect((await h.query("select 1 from public.orders where buyer_id = $1", [buyerA.id])).rowCount).toBe(
          0,
        );
      });
    });

    it("rejects links that are not plain https product links", async () => {
      await h.scenario(async () => {
        for (const url of [
          "http://www.aliexpress.com/item/1",
          "www.aliexpress.com/item/1",
          "https://user:secret@www.aliexpress.com/item/1",
          "https://www.aliexpress.com:8443/item/1",
          "https://127.0.0.1/item/1",
          "https://2130706433/item/1",
          "https://localhost/item/1",
          "ftp://www.aliexpress.com/item/1",
          `https://www.aliexpress.com/${"a".repeat(2100)}`,
          "",
        ]) {
          await h.actAs(buyerA);
          await h.expectError(
            "select public.create_link_order($1, 1, null, null, null, $2, 'NGN')",
            [url, recipientA],
            /link|Use the link/,
          );
        }
      });
    });

    it("only accepts the buyer's own, active recipients and an available currency", async () => {
      await h.scenario(async () => {
        const archived = await makeRecipient(buyerA, { archived: true });
        await h.actAs(buyerA);
        for (const recipient of [recipientB, archived, "00000000-0000-4000-8000-000000000000"]) {
          await h.expectError(
            "select public.create_link_order('https://www.aliexpress.com/item/1', 1, null, null, null, $1, 'NGN')",
            [recipient],
            /Choose one of your recipients/,
          );
        }
        for (const currency of ["AED", "XXX", "NG"]) {
          await h.expectError(
            "select public.create_link_order('https://www.aliexpress.com/item/1', 1, null, null, null, $1, $2)",
            [recipientA, currency],
            /available currency/,
          );
        }
      });
    });

    it("limits quantity, budget and notes", async () => {
      await h.scenario(async () => {
        await h.actAs(buyerA);
        for (const [quantity, budget] of [
          [0, null],
          [101, null],
          [1, 0],
          [1, 1_000_000_000_001],
        ] as const) {
          await h.expectError(
            "select public.create_link_order('https://www.aliexpress.com/item/1', $1, null, null, $2, $3, 'NGN')",
            [quantity, budget, recipientA],
            /orders_quantity_check|orders_max_budget_minor_check/,
          );
        }
        await h.expectError(
          "select public.create_link_order('https://www.aliexpress.com/item/1', 1, null, $1, null, $2, 'NGN')",
          ["x".repeat(1001), recipientA],
          /orders_buyer_notes_check/,
        );
      });
    });

    it("needs a signed-in buyer", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        await h.expectError(
          "select public.create_link_order('https://www.aliexpress.com/item/1', 1, null, null, null, $1, 'NGN')",
          [recipientA],
          PERMISSION_DENIED,
        );
      });
    });

    it("allows 10 requests in 24 hours and refuses the 11th, per buyer", async () => {
      await h.scenario(async () => {
        for (let i = 0; i < 10; i++)
          await linkOrder(buyerA, { url: `https://www.aliexpress.com/item/${i}.html` });
        await h.actAs(buyerA);
        await h.expectError(
          "select public.create_link_order('https://www.aliexpress.com/item/11.html', 1, null, null, null, $1, 'NGN')",
          [recipientA],
          /up to 10 link requests in 24 hours/,
        );
        // Another buyer is not affected.
        await linkOrder(buyerB);
      });
    });

    it("counts cancelled requests, and forgets requests older than 24 hours", async () => {
      await h.scenario(async () => {
        const ids: string[] = [];
        for (let i = 0; i < 10; i++)
          ids.push(await linkOrder(buyerA, { url: `https://www.aliexpress.com/item/${i}.html` }));
        await h.asServiceRole();
        await h.query("select public.transition_order($1, 'cancelled')", [ids[0]]);
        await h.actAs(buyerA);
        await h.expectError(
          "select public.create_link_order('https://www.aliexpress.com/item/x.html', 1, null, null, null, $1, 'NGN')",
          [recipientA],
          /up to 10 link requests/,
        );
        await h.asServer();
        await h.query("update public.orders set created_at = now() - interval '25 hours' where id = $1", [
          ids[1],
        ]);
        await linkOrder(buyerA, { url: "https://www.aliexpress.com/item/again.html" });
      });
    });

    it("applies the limit however the order is inserted", async () => {
      await h.scenario(async () => {
        await h.asServer();
        for (let i = 0; i < 10; i++) {
          await h.query(
            "insert into public.orders (buyer_id, order_type, source_url, buyer_currency) values ($1, 'link', 'https://example.com/x', 'NGN')",
            [buyerA.id],
          );
        }
        await h.expectError(
          "insert into public.orders (buyer_id, order_type, source_url, buyer_currency) values ($1, 'link', 'https://example.com/x', 'NGN')",
          [buyerA.id],
          /up to 10 link requests/,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("sending and revising quotes", () => {
    it("sends a quote with 5 lines: the total is the sum, the order becomes quoted, the buyer is told", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        const quoteId = await sendQuote(orderId, { notes: "Seller has 98% rating, ships in 3 days" });

        await h.asServer();
        const quote = (
          await h.query(
            `select version, status, total_minor, currency, weight_estimate_grams, prepared_by,
                    extract(epoch from (expires_at - now())) / 3600 as hours_left
               from public.quotes where id = $1`,
            [quoteId],
          )
        ).rows[0];
        expect(quote).toMatchObject({
          version: 1,
          status: "sent",
          total_minor: String(LINES_TOTAL),
          currency: "NGN",
          weight_estimate_grams: 1200,
          prepared_by: admin.id,
        });
        expect(Number(quote.hours_left)).toBeGreaterThan(47.9);
        expect(Number(quote.hours_left)).toBeLessThanOrEqual(48);

        const lines = await h.query(
          "select line_type, label, amount_minor, currency, sort_order from public.quote_lines where quote_id = $1 order by sort_order",
          [quoteId],
        );
        expect(lines.rows.map((l) => [l.line_type, l.amount_minor, l.sort_order, l.currency])).toEqual([
          ["item_price", "12000000", 0, "NGN"],
          ["service_fee", "600000", 1, "NGN"],
          ["international_freight", "2500000", 2, "NGN"],
          ["customs_estimate", "1800000", 3, "NGN"],
          ["last_mile_delivery", "450000", 4, "NGN"],
        ]);
        expect(
          (
            await h.query("select sum(amount_minor)::text as s from public.quote_lines where quote_id = $1", [
              quoteId,
            ])
          ).rows[0].s,
        ).toBe(String(LINES_TOTAL));

        expect((await orderRow(orderId)).status).toBe("quoted");
        expect(await auditActions(orderId)).toEqual(["order.created", "order.status_changed"]);
        expect(await auditActions(quoteId)).toEqual(["quote.sent"]);
        expect(await notificationsFor("quote_ready")).toEqual([
          {
            user_id: buyerA.id,
            audience: null,
            status: "pending",
            payload: expect.objectContaining({ order_id: orderId, quote_id: quoteId, version: 1 }),
          },
        ]);
      });
    });

    it("has no way to pass a total: a total sent from the browser is ignored or refused", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(admin);
        // The function takes lines only. A named total is not an argument.
        await h.expectError(
          "select public.send_quote(_order_id := $1, _lines := $2::jsonb, _expires_in_hours := 48, _total_minor := 1)",
          [orderId, JSON.stringify(LINES)],
          /does not exist/,
        );
        // Extra keys on the lines, including a total, are ignored.
        const tampered = LINES.map((line) => ({ ...line, total_minor: 1, total: 1 }));
        const quoteId = await sendQuote(orderId, { lines: tampered });
        await h.asServer();
        expect(
          (await h.query("select total_minor::text as t from public.quotes where id = $1", [quoteId])).rows[0]
            .t,
        ).toBe(String(LINES_TOTAL));
      });
    });

    it("refuses invalid lines, expiry and weight", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        const item = { type: "item_price", label: "Phone", amount_minor: 1000 };
        const bad: [string, unknown, RegExp][] = [
          ["no lines", [], /between 1 and 20/],
          ["not a list", { type: "item_price" }, /needs line items/],
          ["21 lines", Array.from({ length: 21 }, () => item), /between 1 and 20/],
          ["unknown type", [item, { type: "discount", label: "x", amount_minor: 1 }], /unknown type/],
          ["negative amount", [item, { type: "other", label: "x", amount_minor: -5 }], /invalid amount/],
          ["fractional amount", [item, { type: "other", label: "x", amount_minor: 1.5 }], /invalid amount/],
          ["text amount", [item, { type: "other", label: "x", amount_minor: "10" }], /is not valid/],
          ["huge amount", [item, { type: "other", label: "x", amount_minor: 1e30 }], /invalid amount/],
          ["blank label", [item, { type: "other", label: "  ", amount_minor: 1 }], /needs a label/],
          ["long label", [item, { type: "other", label: "x".repeat(201), amount_minor: 1 }], /needs a label/],
          [
            "no item price",
            [{ type: "service_fee", label: "Fee", amount_minor: 100 }],
            /item price line above zero/,
          ],
          [
            "zero item price",
            [{ type: "item_price", label: "Phone", amount_minor: 0 }],
            /item price line above zero/,
          ],
        ];
        for (const [name, lines, pattern] of bad) {
          await h.actAs(admin);
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
            [orderId, JSON.stringify(lines)],
            pattern,
          );
          expect(name).toBeTruthy();
        }
        for (const hours of [0, 12, 47, 49, 96]) {
          await h.actAs(admin);
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, $3, null, null, null, false)",
            [orderId, JSON.stringify([item]), hours],
            /24, 48 or 72/,
          );
        }
        for (const weight of [0, -1, 500001]) {
          await h.actAs(admin);
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, 48, $3, null, null, false)",
            [orderId, JSON.stringify([item]), weight],
            /weight estimate/,
          );
        }
        expect((await orderRow(orderId)).status).toBe("quote_requested");
        expect(await quotesOf(orderId)).toEqual([]);
      });
    });

    it("accepts 24, 48 and 72 hour expiries", async () => {
      await h.scenario(async () => {
        for (const hours of [24, 48, 72]) {
          const orderId = await linkOrder(buyerA, { url: `https://www.aliexpress.com/item/${hours}.html` });
          const quoteId = await sendQuote(orderId, { hours });
          await h.asServer();
          const { rows } = await h.query(
            "select round(extract(epoch from (expires_at - now())) / 3600) as h from public.quotes where id = $1",
            [quoteId],
          );
          expect(Number(rows[0].h)).toBe(hours);
        }
      });
    });

    it("warns when the total is over the buyer's budget, and sends only when admin confirms", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA, { budget: 15_000_000 });
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
          [orderId, JSON.stringify(LINES)],
          /over the buyer's budget/,
        );
        expect(await quotesOf(orderId)).toEqual([]);

        const quoteId = await sendQuote(orderId, { confirm: true });
        await h.asServer();
        const log = await h.query(
          "select details from public.audit_log where entity_id = $1 and action = 'quote.sent'",
          [quoteId],
        );
        expect(log.rows[0].details.over_budget_confirmed).toBe(true);
      });
    });

    it("revising creates version 2, supersedes version 1, keeps one 'sent' quote, and the buyer sees only the latest", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await sendQuote(orderId, { notes: "First attempt" });
        const revised = [LINES[0], { type: "service_fee", label: "Service fee", amount_minor: 500_000 }];
        const v2 = await sendQuote(orderId, { lines: revised, notes: "Cheaper freight found" });

        expect(await quotesOf(orderId)).toEqual([
          { version: 1, status: "superseded", total_minor: String(LINES_TOTAL) },
          { version: 2, status: "sent", total_minor: "12500000" },
        ]);
        expect((await orderRow(orderId)).status).toBe("quoted");
        expect(await auditActions(v2)).toEqual(["quote.revised"]);
        expect((await notificationsFor("quote_revised")).length).toBe(1);

        await h.actAs(buyerA);
        const seen = await h.query("select version, status from public.quotes");
        expect(seen.rows).toEqual([{ version: 2, status: "sent" }]);
        const seenLines = await h.query("select count(*)::int as n from public.quote_lines");
        expect(seenLines.rows[0].n).toBe(2);

        await h.actAs(admin);
        expect(
          (
            await h.query("select version from public.quotes where order_id = $1 order by version", [orderId])
          ).rows.map((r) => r.version),
        ).toEqual([1, 2]);
      });
    });

    it("never allows two 'sent' quotes on one order, even by direct insert", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await sendQuote(orderId);
        await h.asServer();
        await h.expectError(
          `insert into public.quotes (order_id, prepared_by, total_minor, currency, expires_at, version, status)
           values ($1, $2, 100, 'NGN', now() + interval '1 day', 2, 'sent')`,
          [orderId, admin.id],
          /quotes_one_sent_per_order/,
        );
        await h.expectError(
          `insert into public.quotes (order_id, prepared_by, total_minor, currency, expires_at, version, status)
           values ($1, $2, 100, 'NGN', now() + interval '1 day', 1, 'superseded')`,
          [orderId, admin.id],
          /quotes_order_version_key/,
        );
      });
    });

    it("keeps a sent quote's total, expiry and lines fixed, for every role", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        const quoteId = await sendQuote(orderId);
        for (const asRole of [h.asServer.bind(h), h.asServiceRole.bind(h)]) {
          await asRole();
          for (const change of [
            "total_minor = 1",
            "expires_at = now() + interval '30 days'",
            "version = 9",
            "currency = 'USD'",
            "weight_estimate_grams = 5",
            "fx_rate_used = 2",
          ]) {
            await h.expectError(
              `update public.quotes set ${change} where id = $1`,
              [quoteId],
              /cannot be changed/,
            );
          }
          await h.expectError(
            "update public.quote_lines set amount_minor = 1 where quote_id = $1",
            [quoteId],
            /cannot be changed or deleted/,
          );
          await h.expectError(
            "delete from public.quote_lines where quote_id = $1",
            [quoteId],
            /cannot be changed or deleted/,
          );
          await h.expectError(
            "delete from public.quotes where id = $1",
            [quoteId],
            /cannot be changed or deleted/,
          );
        }
        await h.asServer();
        await h.expectError(
          "update public.quotes set accepted_at = now() where id = $1",
          [quoteId],
          /cannot be changed/,
        );
        // A finished quote stays finished.
        await h.query("update public.quotes set status = 'superseded' where id = $1", [quoteId]);
        await h.expectError(
          "update public.quotes set status = 'sent' where id = $1",
          [quoteId],
          /cannot move from superseded to sent/,
        );
        await h.expectError(
          "update public.quotes set status = 'accepted' where id = $1",
          [quoteId],
          /cannot move from superseded to accepted/,
        );
      });
    });

    it("lets only admins send quotes, and only for link orders waiting for one", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        for (const who of [buyerA, buyerB]) {
          await h.actAs(who);
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
            [orderId, JSON.stringify(LINES)],
            /Only admins/,
          );
        }
        await h.actAs("anon");
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
          [orderId, JSON.stringify(LINES)],
          PERMISSION_DENIED,
        );

        await h.asServer();
        const catalog = await h.query(
          "insert into public.orders (buyer_id, order_type, status, buyer_currency) values ($1, 'catalog', 'quote_requested', 'NGN') returning id",
          [buyerA.id],
        );
        const cancelled = await h.query(
          "insert into public.orders (buyer_id, order_type, status, source_url, buyer_currency) values ($1, 'link', 'cancelled', 'https://example.com/x', 'NGN') returning id",
          [buyerA.id],
        );
        for (const id of [catalog.rows[0].id, cancelled.rows[0].id]) {
          await h.actAs(admin);
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
            [id, JSON.stringify(LINES)],
            /not waiting for a quote/,
          );
        }
      });
    });

    it("blocks buyers from writing quotes or lines directly", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        const quoteId = await sendQuote(orderId);
        await h.actAs(buyerA);
        await h.expectError(
          "insert into public.quotes (order_id, prepared_by, total_minor, currency, expires_at, version) values ($1, $2, 1, 'NGN', now() + interval '1 day', 5)",
          [orderId, buyerA.id],
          PERMISSION_DENIED,
        );
        await h.expectError(
          "insert into public.quote_lines (quote_id, line_type, label, amount_minor, currency) values ($1, 'other', 'x', 1, 'NGN')",
          [quoteId],
          PERMISSION_DENIED,
        );
        await h.expectError(
          "update public.quotes set total_minor = 1 where id = $1",
          [quoteId],
          PERMISSION_DENIED,
        );
        await h.expectError(
          "update public.quotes set status = 'accepted' where id = $1",
          [quoteId],
          PERMISSION_DENIED,
        );
        await h.actAs(admin);
        await h.expectError(
          "update public.quotes set total_minor = 1 where id = $1",
          [quoteId],
          PERMISSION_DENIED,
        );
      });
    });

    it("keeps internal notes away from buyers", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        const quoteId = await sendQuote(orderId, { notes: "Margin is thin, push back if they haggle" });
        await h.actAs(buyerA);
        expect((await h.query("select * from public.quote_internal_notes")).rowCount).toBe(0);
        const quote = await h.query("select * from public.quotes where id = $1", [quoteId]);
        expect(Object.keys(quote.rows[0])).not.toContain("internal_notes");
        expect(JSON.stringify(quote.rows)).not.toContain("Margin is thin");
        await h.actAs(admin);
        expect(
          (await h.query("select notes from public.quote_internal_notes where quote_id = $1", [quoteId]))
            .rows,
        ).toEqual([{ notes: "Margin is thin, push back if they haggle" }]);
        await h.actAs(buyerA);
        await h.expectError(
          "insert into public.quote_internal_notes (quote_id, notes) values ($1, 'x')",
          [quoteId],
          PERMISSION_DENIED,
        );
      });
    });

    it("isolates buyers: buyer A cannot read buyer B's orders, items, quotes, lines or messages", async () => {
      await h.scenario(async () => {
        const orderB = await linkOrder(buyerB);
        const quoteB = await sendQuote(orderB);
        await h.actAs(buyerB);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'Hello from B')", [
          orderB,
        ]);

        await h.actAs(buyerA);
        for (const sql of [
          "select id from public.orders where id = $1",
          "select id from public.order_items where order_id = $1",
          "select id from public.quotes where order_id = $1",
          "select id from public.order_messages where order_id = $1",
          "select quote_id from public.quote_lines where quote_id = (select id from public.quotes where order_id = $1)",
        ]) {
          expect((await h.query(sql, [orderB])).rowCount, sql).toBe(0);
        }
        expect(
          (await h.query("select 1 from public.quote_lines where quote_id = $1", [quoteB])).rowCount,
        ).toBe(0);
        await h.expectError(
          "insert into public.order_messages (order_id, body) values ($1, 'I can read your order')",
          [orderB],
          RLS_DENIED,
        );
      });
    });

    it("asks for a route first when the store was unknown", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA, { url: "https://www.some-new-store.com/item/1" });
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, null, null, null, false)",
          [orderId, JSON.stringify(LINES)],
          /Choose the shipping route/,
        );
        await h.asServer();
        await h.query("update public.corridors set active = false where id = $1", [cnNg]);
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, null, null, $3, false)",
          [orderId, JSON.stringify(LINES), cnNg],
          /Choose the shipping route/,
        );
        await h.asServer();
        await h.query("update public.corridors set active = true where id = $1", [cnNg]);

        await sendQuote(orderId, { corridor: cnNg });
        expect((await orderRow(orderId)).corridor_id).toBe(cnNg);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("accepting, declining and expiry", () => {
    async function quotedOrder(buyer = buyerA): Promise<string> {
      const orderId = await linkOrder(buyer);
      await sendQuote(orderId);
      return orderId;
    }

    it("accepting moves the order to awaiting_payment, records it, and tells admins", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await h.actAs(buyerA);
        expect((await h.query("select public.accept_quote($1) as result", [orderId])).rows[0].result).toBe(
          "accepted",
        );

        expect((await orderRow(orderId)).status).toBe("awaiting_payment");
        await h.asServer();
        const quote = (
          await h.query("select status, accepted_at from public.quotes where order_id = $1", [orderId])
        ).rows[0];
        expect(quote.status).toBe("accepted");
        expect(quote.accepted_at).toBeInstanceOf(Date);
        expect((await notificationsFor("quote_accepted")).length).toBe(1);
        const log = await h.query(
          "select actor_id from public.audit_log where entity_id = $1 and action = 'order.status_changed' order by created_at, id",
          [orderId],
        );
        expect(log.rows.map((r) => r.actor_id)).toEqual([admin.id, buyerA.id]);

        // The accepted quote stays visible to the buyer.
        await h.actAs(buyerA);
        expect((await h.query("select status from public.quotes")).rows).toEqual([{ status: "accepted" }]);
      });
    });

    it("cannot be accepted twice, by another buyer, or when there is no quote", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await h.actAs(buyerB);
        await h.expectError("select public.accept_quote($1)", [orderId], /Order not found/);
        await h.actAs("anon");
        await h.expectError("select public.accept_quote($1)", [orderId], PERMISSION_DENIED);
        await h.actAs(buyerA);
        await h.query("select public.accept_quote($1)", [orderId]);
        await h.expectError("select public.accept_quote($1)", [orderId], /can no longer be accepted/);
        const waiting = await linkOrder(buyerA, { url: "https://www.aliexpress.com/item/2.html" });
        await h.actAs(buyerA);
        await h.expectError("select public.accept_quote($1)", [waiting], /can no longer be accepted/);
      });
    });

    it("refuses an expired quote, and still saves the new statuses", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await backdateQuote(orderId);
        await h.actAs(buyerA);
        // Returns a result instead of raising, so the status changes are kept.
        expect((await h.query("select public.accept_quote($1) as result", [orderId])).rows[0].result).toBe(
          "expired",
        );

        expect((await orderRow(orderId)).status).toBe("quote_expired");
        expect(await quotesOf(orderId)).toEqual([
          { version: 1, status: "expired", total_minor: String(LINES_TOTAL) },
        ]);
        expect((await notificationsFor("quote_expired")).length).toBe(1);
        expect(await auditActions(orderId)).toContain("order.status_changed");

        await h.actAs(buyerA);
        expect((await h.query("select public.accept_quote($1) as result", [orderId])).rows[0].result).toBe(
          "expired",
        );
        expect((await h.query("select public.decline_quote($1) as result", [orderId])).rows[0].result).toBe(
          "expired",
        );
      });
    });

    it("accepts a quote that is still inside its time", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await backdateQuote(orderId, "-1 hour");
        await h.actAs(buyerA);
        expect((await h.query("select public.accept_quote($1) as result", [orderId])).rows[0].result).toBe(
          "accepted",
        );
      });
    });

    it("lets the buyer decline: the quote is declined, the order cancelled, admins told", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await h.actAs(buyerB);
        await h.expectError("select public.decline_quote($1)", [orderId], /Order not found/);
        await h.actAs(buyerA);
        expect((await h.query("select public.decline_quote($1) as result", [orderId])).rows[0].result).toBe(
          "declined",
        );
        expect((await orderRow(orderId)).status).toBe("cancelled");
        expect((await orderRow(orderId)).decline_reason).toBeNull();
        expect(await quotesOf(orderId)).toEqual([
          { version: 1, status: "declined_by_buyer", total_minor: String(LINES_TOTAL) },
        ]);
        expect((await notificationsFor("quote_declined_by_buyer")).length).toBe(1);
      });
    });

    it("lets a buyer ask for a new quote after expiry, and admin quotes again as version 2", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await backdateQuote(orderId);
        await h.actAs(buyerA);
        await h.query("select public.expire_quote_if_due($1)", [orderId]);
        await h.asServiceRole();
        await h.query(
          "select public.transition_order($1, 'quote_requested', 'The buyer asked for a new quote', $2)",
          [orderId, buyerA.id],
        );

        const second = await sendQuote(orderId, { lines: [LINES[0]] });
        expect(second).toBeTruthy();
        expect(await quotesOf(orderId)).toEqual([
          { version: 1, status: "expired", total_minor: String(LINES_TOTAL) },
          { version: 2, status: "sent", total_minor: "12000000" },
        ]);
        expect((await orderRow(orderId)).status).toBe("quoted");
      });
    });

    it("expires every due quote when the cron function runs, and only those", async () => {
      await h.scenario(async () => {
        const due1 = await quotedOrder();
        const due2 = await quotedOrder(buyerB);
        const later = await linkOrder(buyerA, { url: "https://www.aliexpress.com/item/9.html" });
        await sendQuote(later);
        await backdateQuote(due1);
        await backdateQuote(due2, "3 hours");

        await h.asServiceRole();
        expect((await h.query("select public.expire_due_quotes() as n")).rows[0].n).toBe(2);
        expect((await orderRow(due1)).status).toBe("quote_expired");
        expect((await orderRow(due2)).status).toBe("quote_expired");
        expect((await orderRow(later)).status).toBe("quoted");
        expect((await h.query("select public.expire_due_quotes() as n")).rows[0].n).toBe(0);
        expect((await notificationsFor("quote_expired")).length).toBe(2);
        expect(await auditActions(due1)).toEqual(expect.arrayContaining(["order.status_changed"]));
      });
    });

    it("keeps the cron function away from browser sessions", async () => {
      await h.scenario(async () => {
        for (const who of [buyerA, admin, "anon"] as const) {
          await h.actAs(who);
          await h.expectError("select public.expire_due_quotes()", [], PERMISSION_DENIED);
        }
      });
    });

    it("applies expiry when someone opens the order, for the buyer and admins only", async () => {
      await h.scenario(async () => {
        const orderId = await quotedOrder();
        await h.actAs(buyerA);
        expect(
          (await h.query("select public.expire_quote_if_due($1) as expired", [orderId])).rows[0].expired,
        ).toBe(false);
        await backdateQuote(orderId);
        await h.actAs(buyerB);
        await h.expectError("select public.expire_quote_if_due($1)", [orderId], /Order not found/);
        await h.actAs(buyerA);
        expect(
          (await h.query("select public.expire_quote_if_due($1) as expired", [orderId])).rows[0].expired,
        ).toBe(true);
        expect(
          (await h.query("select public.expire_quote_if_due($1) as expired", [orderId])).rows[0].expired,
        ).toBe(false);
        expect((await orderRow(orderId)).status).toBe("quote_expired");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("declining a request (admin)", () => {
    it.each(["prohibited_item", "out_of_stock", "unsupported_store", "cannot_verify_seller"])(
      "declines with %s: the order is cancelled and the buyer is told",
      async (reason) => {
        await h.scenario(async () => {
          const orderId = await linkOrder(buyerA);
          await h.actAs(admin);
          await h.query("select public.decline_order($1, $2)", [orderId, reason]);
          expect(await orderRow(orderId)).toMatchObject({
            status: "cancelled",
            decline_reason: reason,
            decline_note: null,
          });
          expect(await notificationsFor("quote_declined")).toEqual([
            { user_id: buyerA.id, audience: null, status: "pending", payload: { order_id: orderId, reason } },
          ]);
        });
      },
    );

    it("needs a note for 'other', rejects unknown reasons, and works only before a quote is out", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(admin);
        await h.expectError("select public.decline_order($1, 'other')", [orderId], /at least 5 characters/);
        await h.expectError(
          "select public.decline_order($1, 'other', 'no')",
          [orderId],
          /at least 5 characters/,
        );
        await h.expectError("select public.decline_order($1, 'because')", [orderId], /Choose a reason/);
        await h.query("select public.decline_order($1, 'other', 'The seller shut down their shop')", [
          orderId,
        ]);
        expect(await orderRow(orderId)).toMatchObject({
          status: "cancelled",
          decline_reason: "other",
          decline_note: "The seller shut down their shop",
        });

        const quoted = await linkOrder(buyerA, { url: "https://www.aliexpress.com/item/7.html" });
        await sendQuote(quoted);
        await h.actAs(admin);
        await h.expectError(
          "select public.decline_order($1, 'out_of_stock')",
          [quoted],
          /waiting for a quote/,
        );
      });
    });

    it("is for admins only", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.expectError("select public.decline_order($1, 'out_of_stock')", [orderId], /Only admins/);
        await h.actAs("anon");
        await h.expectError("select public.decline_order($1, 'out_of_stock')", [orderId], PERMISSION_DENIED);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("order messages", () => {
    it("lets a buyer message about their own order, with the sender and admin flag set by the database", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.query(
          "insert into public.order_messages (order_id, body) values ($1, '  Can you check the colour?  ')",
          [orderId],
        );
        const { rows } = await h.query(
          "select sender_id, is_admin, body, read_at from public.order_messages",
        );
        expect(rows).toEqual([
          { sender_id: buyerA.id, is_admin: false, body: "Can you check the colour?", read_at: null },
        ]);

        // The sender and admin flag cannot be supplied by a client.
        await h.expectError(
          "insert into public.order_messages (order_id, body, is_admin) values ($1, 'hi', true)",
          [orderId],
          PERMISSION_DENIED,
        );
        await h.expectError(
          "insert into public.order_messages (order_id, body, sender_id) values ($1, 'hi', $2)",
          [orderId, admin.id],
          PERMISSION_DENIED,
        );
      });
    });

    it("marks admin messages as admin and lets admins write on any order", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(admin);
        await h.query(
          "insert into public.order_messages (order_id, body) values ($1, 'Which colour do you want?')",
          [orderId],
        );
        await h.actAs(buyerA);
        expect((await h.query("select is_admin, sender_id from public.order_messages")).rows).toEqual([
          { is_admin: true, sender_id: admin.id },
        ]);
      });
    });

    it("queues a notification for the other side", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'Hello')", [orderId]);
        await h.actAs(admin);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'Hi there')", [
          orderId,
        ]);
        expect((await notificationsFor("order_message_from_buyer"))[0]).toMatchObject({
          user_id: null,
          audience: "admins",
          status: "pending",
        });
        expect((await notificationsFor("order_message_from_admin"))[0]).toMatchObject({
          user_id: buyerA.id,
          audience: null,
          status: "pending",
        });
      });
    });

    it("accepts 1 to 1000 characters of text only", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.query("insert into public.order_messages (order_id, body) values ($1, $2)", [
          orderId,
          "x".repeat(1000),
        ]);
        for (const body of ["", "   ", "x".repeat(1001)]) {
          await h.expectError(
            "insert into public.order_messages (order_id, body) values ($1, $2)",
            [orderId, body],
            /order_messages_body_check/,
          );
        }
      });
    });

    it("allows 20 messages an hour per order for a buyer, not for admins", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        for (let i = 0; i < 20; i++)
          await h.query("insert into public.order_messages (order_id, body) values ($1, $2)", [
            orderId,
            `Message ${i}`,
          ]);
        await h.expectError(
          "insert into public.order_messages (order_id, body) values ($1, 'one too many')",
          [orderId],
          /too quickly/,
        );
        await h.actAs(admin);
        for (let i = 0; i < 21; i++)
          await h.query("insert into public.order_messages (order_id, body) values ($1, $2)", [
            orderId,
            `Reply ${i}`,
          ]);
      });
    });

    it("never lets a message be edited or deleted, by anyone", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'Original')", [
          orderId,
        ]);
        await h.expectError("update public.order_messages set body = 'Changed'", [], PERMISSION_DENIED);
        await h.expectError("delete from public.order_messages", [], PERMISSION_DENIED);
        await h.asServer();
        await h.expectError(
          "update public.order_messages set body = 'Changed'",
          [],
          /cannot be edited or deleted/,
        );
        await h.expectError(
          "update public.order_messages set is_admin = true",
          [],
          /cannot be edited or deleted/,
        );
        await h.expectError("delete from public.order_messages", [], /cannot be edited or deleted/);
      });
    });

    it("marks only the other side's messages as read, for the buyer of the order or an admin", async () => {
      await h.scenario(async () => {
        const orderId = await linkOrder(buyerA);
        await h.actAs(buyerA);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'From buyer')", [
          orderId,
        ]);
        await h.actAs(admin);
        await h.query("insert into public.order_messages (order_id, body) values ($1, 'From admin')", [
          orderId,
        ]);

        await h.actAs(buyerB);
        await h.expectError("select public.mark_order_messages_read($1)", [orderId], /Order not found/);

        await h.actAs(buyerA);
        expect((await h.query("select public.mark_order_messages_read($1) as n", [orderId])).rows[0].n).toBe(
          1,
        );
        expect(
          (await h.query("select body, read_at is not null as read from public.order_messages order by body"))
            .rows,
        ).toEqual([
          { body: "From admin", read: true },
          { body: "From buyer", read: false },
        ]);
        await h.actAs(admin);
        expect((await h.query("select public.mark_order_messages_read($1) as n", [orderId])).rows[0].n).toBe(
          1,
        );
        expect((await h.query("select public.mark_order_messages_read($1) as n", [orderId])).rows[0].n).toBe(
          0,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("recipients", () => {
    it("seeds the 36 states and the Federal Capital Territory", async () => {
      await h.asServer();
      const { rows } = await h.query(
        "select name from public.regions where country_code = 'NG' order by name",
      );
      expect(rows).toHaveLength(37);
      expect(rows.map((r) => r.name)).toEqual(
        expect.arrayContaining(["Rivers", "Lagos", "Federal Capital Territory", "Akwa Ibom", "Cross River"]),
      );
      await h.actAs("anon");
      expect((await h.query("select 1 from public.regions")).rowCount).toBe(37);
    });

    it("stores Nigerian mobile numbers in +234 form only", async () => {
      await h.scenario(async () => {
        await h.actAs(buyerA);
        const insert =
          "insert into public.recipients (full_name, phone, address_line, city, state) values ('A Person', $1, '1 Some Street', 'Ikeja', 'Lagos')";
        for (const phone of ["+2348031234567", "+2347031234567", "+2349011234567", "+2348131234567"]) {
          expect((await h.query(insert, [phone])).rowCount).toBe(1);
        }
        for (const phone of [
          "08031234567",
          "+23412345678",
          "+2342031234567",
          "+234803123456",
          "+23480312345678",
          "+2348231234567",
          "+447700900123",
        ]) {
          await h.expectError(insert, [phone], /recipients_ng_phone/);
        }
      });
    });

    it("needs a state from the list", async () => {
      await h.scenario(async () => {
        await h.actAs(buyerA);
        const insert =
          "insert into public.recipients (full_name, phone, address_line, city, state) values ('A Person', '+2348031234567', '1 Some Street', 'Abuja', $1)";
        for (const state of ["Federal Capital Territory", "Rivers", "Akwa Ibom"])
          expect((await h.query(insert, [state])).rowCount).toBe(1);
        for (const state of ["FCT", "Narnia", "rivers", ""])
          await h.expectError(insert, [state], /Choose a state from the list/);
      });
    });

    it("lets the owner edit an unused recipient freely, and others not touch it", async () => {
      await h.scenario(async () => {
        const id = await makeRecipient(buyerA);
        await h.actAs(buyerA);
        expect(
          (
            await h.query(
              "update public.recipients set city = 'Obio-Akpor', address_line = '5 New Road', landmark = 'Near the church' where id = $1",
              [id],
            )
          ).rowCount,
        ).toBe(1);
        await h.actAs(buyerB);
        expect(
          (await h.query("update public.recipients set city = 'Hijacked' where id = $1", [id])).rowCount,
        ).toBe(0);
        expect((await h.query("select 1 from public.recipients where id = $1", [id])).rowCount).toBe(0);
      });
    });

    it("locks where a used recipient delivers, but not its name, phone, landmark or archive flag", async () => {
      await h.scenario(async () => {
        await linkOrder(buyerA);
        await h.actAs(buyerA);
        for (const change of [
          "state = 'Lagos'",
          "city = 'Somewhere else'",
          "address_line = '99 Different Street'",
        ]) {
          await h.expectError(
            `update public.recipients set ${change} where id = $1`,
            [recipientA],
            /address cannot change/,
          );
        }
        expect(
          (
            await h.query(
              "update public.recipients set full_name = 'Mrs Obi', phone = '+2348039999999', landmark = 'Blue gate', archived = true where id = $1",
              [recipientA],
            )
          ).rowCount,
        ).toBe(1);
      });
    });

    it("cannot delete a recipient an order uses, only an unused one", async () => {
      await h.scenario(async () => {
        await linkOrder(buyerA);
        const unused = await makeRecipient(buyerA);
        await h.actAs(buyerA);
        await h.expectError(
          "delete from public.recipients where id = $1",
          [recipientA],
          /violates foreign key constraint/,
        );
        expect((await h.query("delete from public.recipients where id = $1", [unused])).rowCount).toBe(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("notifications", () => {
    it("uses 'pending' as the waiting status and rejects the old name", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const { rows } = await h.query(
          "insert into public.notifications (user_id, channel, template, payload) values ($1, 'email', 'test_template', '{}') returning status",
          [buyerA.id],
        );
        expect(rows[0].status).toBe("pending");
        await h.expectError(
          "update public.notifications set status = 'queued'",
          [],
          /notifications_status_check/,
        );
      });
    });

    it("needs a target: a user, a recipient or the admins", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.expectError(
          "insert into public.notifications (channel, template) values ('email', 'test_template')",
          [],
          /notifications_has_target/,
        );
        await h.expectError(
          "insert into public.notifications (channel, template, audience) values ('email', 'test_template', 'everyone')",
          [],
          /notifications_audience_check/,
        );
        await h.query(
          "insert into public.notifications (channel, template, audience) values ('email', 'test_template', 'admins')",
        );
      });
    });

    it("lets admins read admin notifications, buyers only their own, and nobody write", async () => {
      await h.scenario(async () => {
        await linkOrder(buyerA);
        await h.actAs(admin);
        expect((await h.query("select 1 from public.notifications where audience = 'admins'")).rowCount).toBe(
          1,
        );
        await h.actAs(buyerA);
        expect((await h.query("select 1 from public.notifications")).rowCount).toBe(0);
        await h.expectError(
          "insert into public.notifications (user_id, channel, template) values ($1, 'email', 'x')",
          [buyerA.id],
          PERMISSION_DENIED,
        );
      });
    });
  });
});
