/**
 * Two payments for the last unit, from two real connections at the same time.
 * The other database tests run inside one rolled-back transaction, which cannot
 * show a race, so this one commits its own rows (with unique names) and removes
 * them again at the end. It runs last by name.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL } from "./harness";

describe.skipIf(!DATABASE_URL)("database: two payments for the last unit", () => {
  const admin = new Client({ connectionString: DATABASE_URL });
  const ids = {
    users: [] as string[],
    vendor: "",
    products: [] as string[],
    recipient: "",
    orders: [] as string[],
    payments: [] as string[],
  };
  let buyerId = "";
  let cnNg = "";

  beforeAll(async () => {
    await admin.connect();
    buyerId = await newUser();
    const ownerId = await newUser();
    cnNg = (
      await admin.query(
        "select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'",
      )
    ).rows[0].id;
    ids.vendor = (
      await admin.query(
        `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
         values ($1, 'Race Vendor', 'CN', 'Shenzhen', 'approved', '+8613800000000', array['phones'], 'x/y.pdf') returning id`,
        [ownerId],
      )
    ).rows[0].id;
    ids.recipient = (
      await admin.query(
        `insert into public.recipients (created_by, full_name, phone, address_line, city, state, country_code)
         values ($1, 'Ada Obi', '+2348031234567', '12 Aba Road', 'Port Harcourt', 'Rivers', 'NG') returning id`,
        [buyerId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    // Remove everything this file made, bypassing the append-only and FK triggers (superuser only).
    await admin.query("set session_replication_role = replica");
    const orders = ids.orders;
    await admin.query("delete from public.ledger_entries where order_id = any($1)", [orders]);
    await admin.query("delete from public.payments where order_id = any($1)", [orders]);
    await admin.query(
      "delete from public.quote_pricing_snapshots where quote_id in (select id from public.quotes where order_id = any($1))",
      [orders],
    );
    await admin.query(
      "delete from public.quote_lines where quote_id in (select id from public.quotes where order_id = any($1))",
      [orders],
    );
    await admin.query("delete from public.quotes where order_id = any($1)", [orders]);
    await admin.query("delete from public.order_items where order_id = any($1)", [orders]);
    await admin.query(
      "delete from public.audit_log where entity_id = any($1) or entity_id in (select id from public.payments where order_id = any($1))",
      [orders],
    );
    await admin.query("delete from public.notifications where payload ->> 'order_id' = any($1::text[])", [
      orders,
    ]);
    await admin.query("delete from public.orders where id = any($1)", [orders]);
    await admin.query("delete from public.recipients where id = $1", [ids.recipient]);
    await admin.query("delete from public.products where id = any($1)", [ids.products]);
    await admin.query("delete from public.vendors where id = $1", [ids.vendor]);
    await admin.query("delete from public.audit_log where entity_id = any($1)", [
      [ids.vendor, ...ids.products],
    ]);
    await admin.query("delete from public.profiles where id = any($1)", [ids.users]);
    await admin.query("delete from auth.users where id = any($1)", [ids.users]);
    await admin.query("set session_replication_role = default");
    await admin.end();
  });

  async function newUser(): Promise<string> {
    const id = randomUUID();
    await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, `race-${id}@example.test`]);
    ids.users.push(id);
    return id;
  }

  async function serviceCall(sql: string, params: unknown[], hold = 0, wait = 0): Promise<unknown> {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      await client.query("begin");
      await client.query("set local role service_role");
      const result = await client.query(sql, params);
      if (hold) await client.query("select pg_sleep($1)", [hold / 1000]);
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function checkout(productId: string): Promise<{ orderId: string; paymentId: string }> {
    const lines = JSON.stringify([
      { type: "item_price", label: "Item price", amount_minor: 14_000_000 },
      { type: "service_fee", label: "Service fee", amount_minor: 1_000_000 },
    ]);
    const order = (await serviceCall(
      "select public.create_catalog_order($1, $2, 1, $3, 'NGN', $4::jsonb, '{\"engine_version\":\"1\"}'::jsonb, 300) as id",
      [buyerId, productId, ids.recipient, lines],
    )) as { id: string };
    ids.orders.push(order.id);
    const payment = (await serviceCall(
      "select public.create_payment($1, $2, 15000000, 'NGN', 15000000) as id",
      [order.id, buyerId],
    )) as { id: string };
    ids.payments.push(payment.id);
    return { orderId: order.id, paymentId: payment.id };
  }

  it.each([1, 2, 3])(
    "round %i: stock ends at zero, never negative, and exactly one order is flagged",
    async () => {
      const productId = (
        await admin.query(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, stock, weight_grams, active)
         values ($1, 'Last unit', 'The very last phone in the shop.', 'phones', 14000000, 'NGN', $2, 1, 300, true) returning id`,
          [ids.vendor, cnNg],
        )
      ).rows[0].id as string;
      ids.products.push(productId);

      const a = await checkout(productId);
      const b = await checkout(productId);

      // A holds its transaction open for half a second; B arrives while it is still open.
      const [first, second] = (await Promise.all([
        serviceCall("select public.apply_successful_payment($1) as r", [a.paymentId], 500, 0),
        serviceCall("select public.apply_successful_payment($1) as r", [b.paymentId], 0, 100),
      ])) as { r: string }[];

      expect([first.r, second.r].sort()).toEqual(["applied", "applied_flagged"]);
      const stock = (await admin.query("select stock from public.products where id = $1", [productId]))
        .rows[0].stock;
      expect(stock).toBe(0);
      const orders = (
        await admin.query("select id, status, review_flags from public.orders where id = any($1)", [
          [a.orderId, b.orderId],
        ])
      ).rows;
      expect(orders.every((o) => o.status === "paid")).toBe(true);
      const flagged = orders.filter((o) => (o.review_flags as string[]).includes("stock_unavailable"));
      expect(flagged).toHaveLength(1);
      // Both buyers' money is held, so the flagged one can be refunded in full.
      const held = await admin.query(
        "select count(*)::int as n from public.ledger_entries where order_id = any($1) and entry_type = 'held'",
        [[a.orderId, b.orderId]],
      );
      expect(held.rows[0].n).toBe(2);
    },
  );
});
