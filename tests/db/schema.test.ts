/**
 * Structural checks on the whole public schema. These also cover tables
 * added in later batches, so a new table without RLS fails the build.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness } from "./harness";

describe.skipIf(!DATABASE_URL)("database: schema rules", () => {
  const h = new DbHarness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it("has RLS enabled on every table in the public schema", async () => {
    const { rows } = await h.query(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by 1
    `);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("has at least one explicit policy on every table", async () => {
    const { rows } = await h.query(`
      select t.tablename as table_name
      from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
        )
      order by 1
    `);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("gives every table a uuid id, created_at, updated_at and an updated_at trigger", async () => {
    const { rows } = await h.query(`
      select t.tablename as table_name
      from pg_tables t
      where t.schemaname = 'public'
        and (
          not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = t.tablename
                        and c.column_name = 'id' and c.data_type = 'uuid')
          or not exists (select 1 from information_schema.columns c
                         where c.table_schema = 'public' and c.table_name = t.tablename
                           and c.column_name = 'created_at')
          or not exists (select 1 from information_schema.columns c
                         where c.table_schema = 'public' and c.table_name = t.tablename
                           and c.column_name = 'updated_at')
          or not exists (select 1 from information_schema.triggers tr
                         where tr.event_object_schema = 'public' and tr.event_object_table = t.tablename
                           and tr.trigger_name = t.tablename || '_set_updated_at')
        )
      order by 1
    `);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("stores every *_minor money column as bigint", async () => {
    const { rows } = await h.query(`
      select table_name || '.' || column_name as col, data_type
      from information_schema.columns
      where table_schema = 'public' and column_name like '%\\_minor' and data_type <> 'bigint'
    `);
    expect(rows).toEqual([]);
  });

  it("has no float columns anywhere", async () => {
    const { rows } = await h.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema = 'public' and data_type in ('real', 'double precision', 'money')
    `);
    expect(rows).toEqual([]);
  });

  it("indexes every foreign key column", async () => {
    // A foreign key is covered when some index starts with its column.
    const { rows } = await h.query(`
      select con.conrelid::regclass::text || '.' || a.attname as fk
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      where n.nspname = 'public' and con.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
        )
      order by 1
    `);
    expect(rows.map((r) => r.fk)).toEqual([]);
  });

  it("loads the seed data", async () => {
    const currencies = await h.query("select code from public.currencies where active order by code");
    expect(currencies.rows.map((r) => r.code)).toEqual(["CAD", "CNY", "EUR", "GBP", "NGN", "USD"]);

    const corridors = await h.query(`
      select origin_country || '-' || destination_country as route,
             default_transit_days_min as min, default_transit_days_max as max
      from public.corridors order by 1
    `);
    expect(corridors.rows).toEqual([
      { route: "CN-NG", min: 10, max: 21 },
      { route: "NG-NG", min: 1, max: 3 },
    ]);

    const fees = await h.query("select count(*)::int as n from public.fee_rules");
    expect(fees.rows[0].n).toBe(7);
  });

  it("rejects a fee rule whose value does not match its method", async () => {
    await h.scenario(async () => {
      await h.expectError(
        `insert into public.fee_rules (corridor_id, fee_type, calc_method, percent, currency)
         select id, 'bad_fee', 'flat', 5, 'NGN' from public.corridors limit 1`,
        [],
        /fee_rules_value_matches_method/,
      );
      await h.expectError(
        `insert into public.fee_rules (corridor_id, fee_type, calc_method, amount_minor, currency)
         select id, 'bad_fee', 'percent', 500, 'NGN' from public.corridors limit 1`,
        [],
        /fee_rules_value_matches_method/,
      );
    });
  });
});
