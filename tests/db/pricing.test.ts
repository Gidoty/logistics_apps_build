/**
 * Batch 4: pricing rules, duty rates, delivery zones, exchange rates, quote
 * snapshots and overrides, the request throttle. Tested as real database roles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileLines } from "@/lib/orders/quote-reconcile";
import { calculateLandedCost } from "@/lib/pricing/engine";
import { replaySnapshot, snapshotReproduces } from "@/lib/pricing/snapshot";
import { chinaInput, fxRows, rules } from "../unit/pricing-fixtures";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: pricing", () => {
  const h = new DbHarness();

  let admin: TestUser;
  let buyer: TestUser;
  let otherBuyer: TestUser;
  let vendorOwner: TestUser;
  let cnNg: string;
  let ngNg: string;
  let zoneA: string;
  let recipient: string;

  const SNAPSHOT = JSON.stringify({ engine_version: "1", note: "test snapshot" });

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser();
    buyer = await h.createUser();
    otherBuyer = await h.createUser();
    vendorOwner = await h.createUser();
    await h.setRoleAsServer(admin.id, "admin");
    await h.asServer();
    const corridors = await h.query(
      "select id, origin_country || '-' || destination_country as route from public.corridors",
    );
    cnNg = corridors.rows.find((r) => r.route === "CN-NG").id;
    ngNg = corridors.rows.find((r) => r.route === "NG-NG").id;
    zoneA = (await h.query("select id from public.delivery_zones where name = 'Zone A'")).rows[0].id;
    recipient = (
      await h.query(
        `insert into public.recipients (created_by, full_name, phone, address_line, city, state, country_code)
         values ($1, 'Ada Obi', '+2348031234567', '12 Aba Road', 'Port Harcourt', 'Rivers', 'NG') returning id`,
        [buyer.id],
      )
    ).rows[0].id;
  });
  afterAll(() => h.stop());

  async function oneRow(sql: string, params: unknown[] = []) {
    const { rows } = await h.query(sql, params);
    return rows[0];
  }

  /** A fee rule in the past, so replacing it in the same transaction still has a positive window. */
  async function insertRule(over: Record<string, unknown> = {}): Promise<string> {
    await h.asServer();
    const r = {
      corridor: cnNg,
      fee_type: "insurance",
      calc_method: "percent",
      value: 2,
      currency: "USD",
      weight_from: null,
      weight_to: null,
      category: null,
      zone: null,
      from: "2026-01-01T00:00:00Z",
      to: null,
      ...over,
    };
    return (
      await oneRow(
        `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency, weight_from_g, weight_to_g,
           category_slug, zone_id, effective_from, effective_to)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [
          r.corridor,
          r.fee_type,
          r.calc_method,
          r.value,
          r.currency,
          r.weight_from,
          r.weight_to,
          r.category,
          r.zone,
          r.from,
          r.to,
        ],
      )
    ).id;
  }

  describe("seed data", () => {
    it("has three zones that hold every state exactly once", async () => {
      await h.asServer();
      const zones = await h.query(
        "select name, cardinality(states) as n from public.delivery_zones order by name",
      );
      expect(zones.rows).toEqual([
        { name: "Zone A", n: 3 },
        { name: "Zone B", n: 15 },
        { name: "Zone C", n: 19 },
      ]);
      const uncovered = await h.query(
        `select r.name from public.regions r where r.country_code = 'NG'
         and not exists (select 1 from public.delivery_zones z where z.states @> array[r.name])`,
      );
      expect(uncovered.rows).toEqual([]);
      const lagos = await oneRow("select name from public.delivery_zones where states @> array['Lagos']");
      expect(lagos.name).toBe("Zone A");
    });

    it("has placeholder duty rates for the China route, labelled as placeholders", async () => {
      await h.asServer();
      const duty = await h.query(
        "select category_slug, import_duty_percent::float as duty, notes from public.duty_rates order by category_slug nulls first",
      );
      expect(duty.rows.map((r) => [r.category_slug, r.duty])).toEqual([
        [null, 20],
        ["electronics", 10],
        ["phones", 5],
      ]);
      for (const row of duty.rows) expect(row.notes).toMatch(/PLACEHOLDER/);
    });

    it("has fee rules in the new shape, with no old-style fee types left", async () => {
      await h.asServer();
      const types = await h.query("select distinct fee_type::text as t from public.fee_rules order by 1");
      expect(types.rows.map((r) => r.t)).toEqual([
        "clearing",
        "insurance",
        "international_freight",
        "last_mile",
        "payment_processing",
        "service_fee",
        "special_handling",
      ]);
      const open = await oneRow("select count(*)::int as n from public.fee_rules where effective_to is null");
      expect(open.n).toBe(31);
    });
  });

  describe("rules are history", () => {
    it("cannot be edited or deleted by anyone, owner and service role included", async () => {
      await h.scenario(async () => {
        const id = await insertRule({ fee_type: "fx_spread" });
        await h.asServer();
        await h.expectError("update public.fee_rules set value = 99 where id = $1", [id], /cannot be edited/);
        await h.expectError(
          "update public.fee_rules set currency = 'NGN' where id = $1",
          [id],
          /cannot be edited/,
        );
        await h.expectError("delete from public.fee_rules where id = $1", [id], /never deleted/);
        await h.asServiceRole();
        await h.expectError("update public.fee_rules set value = 99 where id = $1", [id], /cannot be edited/);
        await h.asServer();
        await h.expectError("update public.duty_rates set vat_percent = 1", [], /cannot be edited/);
        await h.expectError("delete from public.duty_rates", [], /never deleted/);
      });
    });

    it("allows only closing a rule, once", async () => {
      await h.scenario(async () => {
        const id = await insertRule({ fee_type: "fx_spread" });
        await h.asServer();
        await h.query("update public.fee_rules set effective_to = now() where id = $1", [id]);
        await h.expectError(
          "update public.fee_rules set effective_to = null where id = $1",
          [id],
          /cannot be edited/,
        );
        await h.expectError(
          "update public.fee_rules set effective_to = now() + interval '1 day' where id = $1",
          [id],
          /cannot be edited/,
        );
      });
    });

    it("keeps browser sessions away from the tables: no direct writes, and only admins read", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency)
           values ($1, 'fx_spread', 'percent', 1, 'USD')`,
          [cnNg],
          PERMISSION_DENIED,
        );
        await h.expectError("update public.fee_rules set value = 1", [], PERMISSION_DENIED);
        await h.expectError("delete from public.fee_rules", [], PERMISSION_DENIED);
        await h.expectError(
          "insert into public.duty_rates (corridor_id, import_duty_percent, vat_percent, other_levies_percent) values ($1, 1, 1, 1)",
          [cnNg],
          PERMISSION_DENIED,
        );
        await h.expectError(
          "insert into public.delivery_zones (name, states) values ('X', array['Lagos'])",
          [],
          PERMISSION_DENIED,
        );
        expect((await oneRow("select count(*)::int as n from public.fee_rules")).n).toBeGreaterThan(0);

        for (const who of [buyer, vendorOwner, "anon" as const]) {
          await h.actAs(who);
          for (const table of ["fee_rules", "duty_rates", "delivery_zones", "request_throttle"]) {
            if (who === "anon") {
              await h.expectError(`select count(*) from public.${table}`, [], PERMISSION_DENIED);
            } else {
              expect(
                (await oneRow(`select count(*)::int as n from public.${table}`)).n,
                `${who.id} ${table}`,
              ).toBe(0);
            }
          }
        }
      });
    });
  });

  describe("no overlapping rules", () => {
    it("refuses a second rule for the same fee covering the same time and weight", async () => {
      await h.scenario(async () => {
        await insertRule({ fee_type: "fx_spread" });
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency, effective_from)
           values ($1, 'fx_spread', 'percent', 3, 'USD', '2026-06-01T00:00:00Z')`,
          [cnNg],
          /already covers that time and weight/,
        );
      });
    });

    it("allows adjacent weight bands, different zones, different categories and different routes", async () => {
      await h.scenario(async () => {
        await insertRule({
          fee_type: "insurance",
          calc_method: "flat",
          value: 1,
          currency: "NGN",
          corridor: ngNg,
          weight_from: 0,
          weight_to: 1000,
        });
        await insertRule({
          fee_type: "insurance",
          calc_method: "flat",
          value: 2,
          currency: "NGN",
          corridor: ngNg,
          weight_from: 1000,
          weight_to: 2000,
        });
        await insertRule({
          fee_type: "insurance",
          calc_method: "flat",
          value: 3,
          currency: "NGN",
          corridor: ngNg,
          weight_from: 2000,
        });
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency, weight_from_g, weight_to_g)
           values ($1, 'insurance', 'flat', 4, 'NGN', 1500, 2500)`,
          [ngNg],
          /already covers/,
        );
      });
    });

    it("lets a category rule sit beside the general rule", async () => {
      await h.scenario(async () => {
        await insertRule({ fee_type: "fx_spread" });
        await insertRule({ fee_type: "fx_spread", category: "phones", value: 1 });
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency, category_slug)
           values ($1, 'fx_spread', 'percent', 2, 'USD', 'phones')`,
          [cnNg],
          /already covers/,
        );
      });
    });

    it("lets payment processing have one percent rule and one flat rule, not two of a kind", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const existing = await oneRow(
          "select count(*)::int as n from public.fee_rules where fee_type = 'payment_processing' and corridor_id = $1 and effective_to is null",
          [cnNg],
        );
        expect(existing.n).toBe(2); // seeded: one percent, one flat
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency)
           values ($1, 'payment_processing', 'percent', 3, 'NGN')`,
          [cnNg],
          /already covers/,
        );
        await h.expectError(
          `insert into public.fee_rules (corridor_id, fee_type, calc_method, value, currency)
           values ($1, 'payment_processing', 'flat', 300, 'NGN')`,
          [cnNg],
          /already covers/,
        );
      });
    });

    it("lets a closed rule and its successor share a boundary without overlapping", async () => {
      await h.scenario(async () => {
        await insertRule({ fee_type: "fx_spread", from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" });
        await insertRule({ fee_type: "fx_spread", from: "2026-06-01T00:00:00Z", value: 3 });
      });
    });

    it("applies the same rule to duty rates", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.expectError(
          `insert into public.duty_rates (corridor_id, category_slug, import_duty_percent, vat_percent, other_levies_percent)
           values ($1, 'phones', 1, 1, 1)`,
          [cnNg],
          /already covers that time/,
        );
        await h.query(
          `insert into public.duty_rates (corridor_id, category_slug, import_duty_percent, vat_percent, other_levies_percent)
           values ($1, 'laptops', 1, 1, 1)`,
          [cnNg],
        );
      });
    });
  });

  describe("changing a rate closes the old rule and starts a new one", () => {
    it("replace_fee_rule: the old rule ends the moment the new one starts, and the audit log has both", async () => {
      await h.scenario(async () => {
        const id = await insertRule({ fee_type: "fx_spread", from: "2026-01-01T00:00:00Z" });
        await h.actAs(admin);
        const { id: newId } = await oneRow(
          "select public.replace_fee_rule($1, 'percent', 4, 'USD', null, null, null, null, 'Raised for Q4') as id",
          [id],
        );
        await h.asServer();
        const old = await oneRow(
          "select value::float as v, effective_to, effective_from from public.fee_rules where id = $1",
          [id],
        );
        const fresh = await oneRow(
          "select value::float as v, effective_from, effective_to, fee_type::text as t, corridor_id, notes from public.fee_rules where id = $1",
          [newId],
        );
        expect(old.v).toBe(2);
        expect(fresh.v).toBe(4);
        expect(old.effective_to).toEqual(fresh.effective_from);
        expect(fresh.effective_to).toBeNull();
        expect(fresh.t).toBe("fx_spread");
        expect(fresh.corridor_id).toBe(cnNg);
        expect(fresh.notes).toBe("Raised for Q4");

        const audit = await oneRow(
          "select details, actor_id from public.audit_log where entity_id = $1 and action = 'fee_rule.replaced'",
          [newId],
        );
        expect(audit.actor_id).toBe(admin.id);
        expect(Number(audit.details.old.value)).toBe(2);
        expect(Number(audit.details.new.value)).toBe(4);
      });
    });

    it("cannot replace a closed rule, and only admins can use these functions", async () => {
      await h.scenario(async () => {
        const id = await insertRule({ fee_type: "fx_spread" });
        await h.actAs(admin);
        await h.query("select public.close_fee_rule($1)", [id]);
        await h.expectError(
          "select public.replace_fee_rule($1, 'percent', 4, 'USD')",
          [id],
          /already closed/,
        );
        await h.expectError("select public.close_fee_rule($1)", [id], /already closed/);

        const open = await insertRule({ fee_type: "insurance", corridor: ngNg });
        for (const who of [buyer, vendorOwner]) {
          await h.actAs(who);
          await h.expectError(
            "select public.replace_fee_rule($1, 'percent', 4, 'USD')",
            [open],
            /Only admins/,
          );
          await h.expectError("select public.close_fee_rule($1)", [open], /Only admins/);
          await h.expectError(
            "select public.create_fee_rule($1, 'fx_spread', 'percent', 1, 'USD')",
            [ngNg],
            /Only admins/,
          );
        }
        await h.actAs("anon");
        await h.expectError("select public.close_fee_rule($1)", [open], PERMISSION_DENIED);
      });
    });

    it("create_fee_rule checks values and refuses an overlap", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          "select public.create_fee_rule($1, 'fx_spread', 'percent', 150, 'USD')",
          [cnNg],
          /fee_rules_value_valid/,
        );
        await h.expectError(
          "select public.create_fee_rule($1, 'clearing', 'flat', 5.5, 'NGN')",
          [cnNg],
          /already covers|fee_rules_value_valid/,
        );
        await h.query("select public.create_fee_rule($1, 'fx_spread', 'percent', 1.5, 'USD')", [cnNg]);
        await h.expectError(
          "select public.create_fee_rule($1, 'fx_spread', 'percent', 2, 'USD')",
          [cnNg],
          /already covers/,
        );
        await h.expectError(
          "select public.create_fee_rule($1, 'service_fee', 'flat', 1, 'NGN', null, null, null, null, null, $2)",
          [cnNg, zoneA],
          /fee_rules_zone_only_last_mile/,
        );
      });
    });

    it("replace_duty_rate works the same way", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const phones = await oneRow("select id from public.duty_rates where category_slug = 'phones'");
        await h.actAs(admin);
        const { id: newId } = await oneRow(
          "select public.replace_duty_rate($1, 6, 7.5, 4, 'Updated') as id",
          [phones.id],
        );
        await h.asServer();
        const old = await oneRow("select effective_to from public.duty_rates where id = $1", [phones.id]);
        const fresh = await oneRow(
          "select effective_from, import_duty_percent::float as d from public.duty_rates where id = $1",
          [newId],
        );
        expect(old.effective_to).toEqual(fresh.effective_from);
        expect(fresh.d).toBe(6);
        const audit = await oneRow(
          "select details from public.audit_log where entity_id = $1 and action = 'duty_rate.replaced'",
          [newId],
        );
        expect(Number(audit.details.old.import_duty_percent)).toBe(5);
        expect(Number(audit.details.new.import_duty_percent)).toBe(6);
        await h.actAs(buyer);
        await h.expectError("select public.replace_duty_rate($1, 1, 1, 1)", [newId], /Only admins/);
      });
    });
  });

  describe("delivery zones", () => {
    it("keeps each state in one zone and only accepts real Nigerian states", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          "select public.save_delivery_zone(null, 'Zone X', array['Lagos'])",
          [],
          /one zone only/,
        );
        await h.expectError(
          "select public.save_delivery_zone(null, 'Zone X', array['Atlantis'])",
          [],
          /Nigerian states/,
        );
        await h.expectError(
          "select public.save_delivery_zone(null, 'Zone X', array['Kano', 'Kano'])",
          [],
          /twice/,
        );
        await h.expectError(
          "select public.save_delivery_zone(null, 'Zone A', array[]::text[])",
          [],
          /zones_states_check|check constraint/,
        );
      });
    });

    it("saves a zone and writes old and new values to the audit log", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        // Move Rivers out of Zone A into a zone of its own.
        await h.query(
          "select public.save_delivery_zone($1, 'Zone A', array['Lagos', 'Federal Capital Territory'])",
          [zoneA],
        );
        const { id } = await oneRow(
          "select public.save_delivery_zone(null, 'Zone R', array['Rivers']) as id",
        );
        await h.asServer();
        const audit = await oneRow(
          "select details from public.audit_log where entity_id = $1 and action = 'delivery_zone.updated'",
          [zoneA],
        );
        expect(audit.details.old.states).toContain("Rivers");
        expect(audit.details.new.states).not.toContain("Rivers");
        expect((await oneRow("select states from public.delivery_zones where id = $1", [id])).states).toEqual(
          ["Rivers"],
        );
        await h.actAs(buyer);
        await h.expectError(
          "select public.save_delivery_zone(null, 'Zone Q', array['Kano'])",
          [],
          /Only admins/,
        );
      });
    });
  });

  describe("exchange rates", () => {
    async function seedRate(quote: string, rate: number, ageHours = 1) {
      await h.asServer();
      await h.query(
        `insert into public.fx_rates (base_currency, quote_currency, rate, source, fetched_at, spread_percent)
         values ('USD', $1, $2, 'test', now() - make_interval(hours => $3), 1.5)`,
        [quote, rate, ageHours],
      );
    }

    it("sets an override that replaces the fetched rate, one open override per pair", async () => {
      await h.scenario(async () => {
        await seedRate("NGN", 1500);
        await h.actAs(admin);
        await h.query("select public.set_fx_override('USD', 'NGN', 1600)");
        await h.query("select public.set_fx_override('USD', 'NGN', 1650.5)");
        await h.asServer();
        const open = await h.query(
          "select rate::float as r, spread_percent::float as s, source from public.fx_rates where is_override and ended_at is null",
        );
        expect(open.rows).toEqual([{ r: 1650.5, s: 1.5, source: "admin override" }]);
        const ended = await oneRow(
          "select count(*)::int as n from public.fx_rates where is_override and ended_at is not null",
        );
        expect(ended.n).toBe(1);
        const audit = await h.query(
          "select action from public.audit_log where action like 'fx.override%' order by created_at",
        );
        expect(audit.rows.map((r) => r.action)).toEqual(["fx.override_set", "fx.override_set"]);
      });
    });

    it("removes an override and refuses to remove one that is not there", async () => {
      await h.scenario(async () => {
        await seedRate("NGN", 1500);
        await h.actAs(admin);
        await h.query("select public.set_fx_override('USD', 'NGN', 1600)");
        await h.query("select public.remove_fx_override('USD', 'NGN')");
        await h.expectError("select public.remove_fx_override('USD', 'NGN')", [], /no override to remove/);
        await h.asServer();
        expect(
          (
            await oneRow(
              "select count(*)::int as n from public.fx_rates where is_override and ended_at is null",
            )
          ).n,
        ).toBe(0);
      });
    });

    it("sets the conversion fee without touching the rate or its fetch time", async () => {
      await h.scenario(async () => {
        await seedRate("NGN", 1500, 30);
        await h.asServer();
        const before = await oneRow(
          "select id, rate, fetched_at from public.fx_rates where quote_currency = 'NGN' order by fetched_at desc limit 1",
        );
        await h.actAs(admin);
        await h.query("select public.set_fx_spread('USD', 'NGN', 2.25)");
        await h.expectError("select public.set_fx_spread('USD', 'NGN', 25)", [], /between 0 and 20/);
        await h.asServer();
        const after = await oneRow(
          "select rate, fetched_at, spread_percent::float as s from public.fx_rates where id = $1",
          [before.id],
        );
        expect(after.s).toBe(2.25);
        expect(after.rate).toBe(before.rate);
        expect(after.fetched_at).toEqual(before.fetched_at);
      });
    });

    it("never lets a rate be edited or deleted, and keeps writes away from browser sessions", async () => {
      await h.scenario(async () => {
        await seedRate("NGN", 1500);
        await h.asServer();
        await h.expectError("update public.fx_rates set rate = 1", [], /cannot be edited/);
        await h.expectError("update public.fx_rates set fetched_at = now()", [], /cannot be edited/);
        await h.expectError("delete from public.fx_rates", [], /never deleted/);
        await h.actAs(admin);
        await h.expectError("update public.fx_rates set rate = 1", [], PERMISSION_DENIED);
        await h.expectError(
          "insert into public.fx_rates (base_currency, quote_currency, rate, source) values ('USD', 'GBP', 1, 'x')",
          [],
          PERMISSION_DENIED,
        );
        await h.actAs(buyer);
        await h.expectError("select public.set_fx_override('USD', 'NGN', 5)", [], /Only admins/);
        await h.expectError("select public.set_fx_spread('USD', 'NGN', 5)", [], /Only admins/);
        expect((await oneRow("select count(*)::int as n from public.fx_rates")).n).toBe(0);
      });
    });

    it("lets the service role store a fetched rate (the cron job)", async () => {
      await h.scenario(async () => {
        await h.asServiceRole();
        await h.query(
          "insert into public.fx_rates (base_currency, quote_currency, rate, source, spread_percent) values ('USD', 'GBP', 0.76123456, 'open.er-api.com', 2)",
        );
        await h.asServer();
        expect(
          (await oneRow("select rate::text as r from public.fx_rates where quote_currency = 'GBP'")).r,
        ).toBe("0.76123456");
      });
    });
  });

  describe("dimensions and weight", () => {
    it("needs all three sides or none, on products and orders", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const vendorId = (
          await oneRow(
            `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
             values ($1, 'Vendor One', 'CN', 'Shenzhen', 'approved', '+8613800000000', array['phones'], 'x/y.pdf') returning id`,
            [vendorOwner.id],
          )
        ).id;
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, length_cm)
           values ($1, 'Test phone', 'A phone with enough description text.', 'phones', 100, 'USD', $2, 30)`,
          [vendorId, cnNg],
          /products_dimensions_together/,
        );
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, length_cm, width_cm, height_cm)
           values ($1, 'Test phone', 'A phone with enough description text.', 'phones', 100, 'USD', $2, 0, 5, 5)`,
          [vendorId, cnNg],
          /length_cm_check|check constraint/,
        );
        await h.query(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, length_cm, width_cm, height_cm, weight_grams)
           values ($1, 'Test phone', 'A phone with enough description text.', 'phones', 100, 'USD', $2, 30, 20.5, 10, 300)`,
          [vendorId, cnNg],
        );
        await h.actAs(buyer);
        const orderId = (
          await oneRow(
            "select public.create_link_order('https://www.aliexpress.com/item/1.html', 1, '', '', null, $1, 'NGN') as id",
            [recipient],
          )
        ).id;
        await h.asServer();
        await h.expectError(
          "update public.orders set length_cm = 5 where id = $1",
          [orderId],
          /orders_dimensions_together/,
        );
        await h.query("update public.orders set length_cm = 5, width_cm = 5, height_cm = 5 where id = $1", [
          orderId,
        ]);
      });
    });

    it("needs a weight before a vendor can publish", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const vendorId = (
          await oneRow(
            `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
             values ($1, 'Vendor One', 'CN', 'Shenzhen', 'approved', '+8613800000000', array['phones'], 'x/y.pdf') returning id`,
            [vendorOwner.id],
          )
        ).id;
        await h.setRoleAsServer(vendorOwner.id, "vendor");
        const productId = (
          await oneRow(
            `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
             values ($1, 'Phone', 'A phone with enough description text.', 'phones', 100, 'USD', $2) returning id`,
            [vendorId, cnNg],
          )
        ).id;
        await h.query(
          "insert into public.product_images (product_id, storage_path, sort_order) values ($1, $2, 0)",
          [productId, `${vendorId}/${productId}/a.webp`],
        );
        await h.actAs(vendorOwner);
        await h.expectError(
          "update public.products set active = true where id = $1",
          [productId],
          /Add the weight before publishing/,
        );
        await h.query("update public.products set weight_grams = 300 where id = $1", [productId]);
        await h.query("update public.products set active = true where id = $1", [productId]);
        await h.expectError(
          "update public.products set weight_grams = null where id = $1",
          [productId],
          /Add the weight|null value|check/,
        );
      });
    });
  });

  describe("quotes: snapshots and overrides", () => {
    const LINES = [
      { type: "item_price", label: "Item price", amount_minor: 8_333_333 },
      { type: "import_duty", label: "Import duty (Estimated)", amount_minor: 522_117 },
      {
        type: "service_fee",
        label: "Service fee",
        amount_minor: 300_000,
        override: { reason: "Loyal customer, fee reduced", original_amount_minor: 416_667 },
      },
      {
        type: "other",
        label: "Extra packaging",
        amount_minor: 25_000,
        override: { reason: "Customer asked for double boxing", original_amount_minor: null },
      },
    ];

    async function newOrder(): Promise<string> {
      await h.actAs(buyer);
      const { id } = await oneRow(
        "select public.create_link_order('https://www.aliexpress.com/item/1.html', 1, '', '', null, $1, 'NGN') as id",
        [recipient],
      );
      return id;
    }

    async function send(orderId: string, lines: unknown, snapshot: string | null = SNAPSHOT) {
      await h.actAs(admin);
      return oneRow("select public.send_quote($1, $2::jsonb, 48, $3::jsonb) as id", [
        orderId,
        JSON.stringify(lines),
        snapshot,
      ]);
    }

    it("stores the snapshot and the overrides where only admins can read them", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        const { id: quoteId } = await send(orderId, LINES);

        await h.actAs(admin);
        const snap = await oneRow(
          "select engine_version, snapshot from public.quote_pricing_snapshots where quote_id = $1",
          [quoteId],
        );
        expect(snap.engine_version).toBe("1");
        expect(snap.snapshot.note).toBe("test snapshot");
        const overrides = await h.query(
          `select l.line_type, o.reason, o.original_amount_minor::int as original
           from public.quote_line_overrides o join public.quote_lines l on l.id = o.quote_line_id
           where l.quote_id = $1 order by l.sort_order`,
          [quoteId],
        );
        expect(overrides.rows).toEqual([
          { line_type: "service_fee", reason: "Loyal customer, fee reduced", original: 416_667 },
          { line_type: "other", reason: "Customer asked for double boxing", original: null },
        ]);

        // The buyer sees the lines and the total, and nothing about margins.
        await h.actAs(buyer);
        const lines = await h.query(
          "select line_type, amount_minor::int as amount from public.quote_lines where quote_id = $1 order by sort_order",
          [quoteId],
        );
        expect(lines.rows).toHaveLength(4);
        const total = await oneRow("select total_minor::int as t from public.quotes where id = $1", [
          quoteId,
        ]);
        expect(total.t).toBe(8_333_333 + 522_117 + 300_000 + 25_000);
        for (const table of ["quote_pricing_snapshots", "quote_line_overrides"]) {
          expect((await oneRow(`select count(*)::int as n from public.${table}`)).n, table).toBe(0);
        }
        for (const who of [otherBuyer, vendorOwner]) {
          await h.actAs(who);
          expect((await oneRow("select count(*)::int as n from public.quote_pricing_snapshots")).n).toBe(0);
        }
        await h.actAs("anon");
        await h.expectError("select * from public.quote_line_overrides", [], PERMISSION_DENIED);
      });
    });

    it("refuses a quote without a snapshot, and an override without a reason", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, null)",
          [orderId, JSON.stringify(LINES)],
          /needs the pricing snapshot/,
        );
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, '{\"x\": 1}'::jsonb)",
          [orderId, JSON.stringify(LINES)],
          /needs the pricing snapshot/,
        );
        for (const override of [
          { reason: "", original_amount_minor: 1 },
          { reason: "ok", original_amount_minor: 1 },
          { original_amount_minor: 1 },
          { reason: "x".repeat(501), original_amount_minor: 1 },
        ]) {
          const lines = [LINES[0], { ...LINES[2], override }];
          await h.expectError(
            "select public.send_quote($1, $2::jsonb, 48, $3::jsonb)",
            [orderId, JSON.stringify(lines), SNAPSHOT],
            /give a reason of at least 5 characters/,
          );
        }
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, $3::jsonb)",
          [
            orderId,
            JSON.stringify([
              LINES[0],
              { ...LINES[2], override: { reason: "A fine reason", original_amount_minor: -5 } },
            ]),
            SNAPSHOT,
          ],
          /invalid original amount/,
        );
        await h.asServer();
        expect(
          (await oneRow("select count(*)::int as n from public.quotes where order_id = $1", [orderId])).n,
        ).toBe(0);
      });
    });

    it("accepts every line type the engine produces and refuses unknown ones", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        const types = [
          "item_price",
          "international_freight",
          "insurance",
          "import_duty",
          "other_levies",
          "vat",
          "clearing",
          "special_handling",
          "last_mile_delivery",
          "service_fee",
          "payment_processing",
          "fx_spread",
        ];
        await send(
          orderId,
          types.map((type) => ({ type, label: type, amount_minor: 1000 })),
        );
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, $3::jsonb)",
          [
            orderId,
            JSON.stringify([LINES[0], { type: "margin", label: "Margin", amount_minor: 5 }]),
            SNAPSHOT,
          ],
          /unknown type/,
        );
      });
    });

    it("saves the box size on the order, all three sides or none", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        await h.actAs(admin);
        await oneRow(
          "select public.send_quote($1, $2::jsonb, 48, $3::jsonb, 1500, null, null, false, $4::jsonb) as id",
          [
            orderId,
            JSON.stringify([LINES[0]]),
            SNAPSHOT,
            JSON.stringify({ length_cm: 30, width_cm: 20.5, height_cm: 10 }),
          ],
        );
        await h.asServer();
        const order = await oneRow(
          "select length_cm::float as l, width_cm::float as w, height_cm::float as h from public.orders where id = $1",
          [orderId],
        );
        expect(order).toEqual({ l: 30, w: 20.5, h: 10 });
        await h.actAs(admin);
        await h.expectError(
          "select public.send_quote($1, $2::jsonb, 48, $3::jsonb, 1500, null, null, false, $4::jsonb)",
          [orderId, JSON.stringify([LINES[0]]), SNAPSHOT, JSON.stringify({ length_cm: 30 })],
          /length, width and height/,
        );
      });
    });

    it("keeps overrides and snapshots fixed once saved", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        const { id: quoteId } = await send(orderId, LINES);
        await h.asServer();
        await h.expectError(
          "update public.quote_pricing_snapshots set snapshot = '{}'::jsonb",
          [],
          /cannot be changed or deleted/,
        );
        await h.expectError("delete from public.quote_pricing_snapshots", [], /cannot be changed or deleted/);
        await h.expectError(
          "update public.quote_line_overrides set reason = 'changed my mind'",
          [],
          /cannot be changed or deleted/,
        );
        await h.expectError("delete from public.quote_line_overrides", [], /cannot be changed or deleted/);
        await h.actAs(admin);
        await h.expectError(
          "update public.quote_line_overrides set reason = 'changed my mind'",
          [],
          PERMISSION_DENIED,
        );
        expect(quoteId).toBeTruthy();
      });
    });

    it("keeps each revision's own snapshot and overrides", async () => {
      await h.scenario(async () => {
        const orderId = await newOrder();
        const { id: first } = await send(orderId, LINES, JSON.stringify({ engine_version: "1", n: 1 }));
        const { id: second } = await send(
          orderId,
          [LINES[0], LINES[1]],
          JSON.stringify({ engine_version: "1", n: 2 }),
        );
        await h.actAs(admin);
        const snaps = await h.query(
          "select quote_id, snapshot->>'n' as n from public.quote_pricing_snapshots order by snapshot->>'n'",
        );
        expect(snaps.rows).toEqual([
          { quote_id: first, n: "1" },
          { quote_id: second, n: "2" },
        ]);
        const secondOverrides = await oneRow(
          "select count(*)::int as n from public.quote_line_overrides o join public.quote_lines l on l.id = o.quote_line_id where l.quote_id = $1",
          [second],
        );
        expect(secondOverrides.n).toBe(0);
      });
    });
  });

  describe("engine and database agree", () => {
    it("sends engine lines with an override, and the stored snapshot still reproduces after the rules change", async () => {
      await h.scenario(async () => {
        // 1. The engine works out a quote, as the admin's Calculate button does.
        const calculated = calculateLandedCost(chinaInput({ destinationState: "Rivers" }), rules(), fxRows());
        // 2. The admin lowers the service fee and gives a reason; the app turns that into SQL lines.
        const submitted = calculated.lines.map((line) => ({
          calcType: line.type,
          label: line.label,
          amount: (line.amountMinor / 100).toFixed(2),
          reason: "",
        }));
        const fee = submitted.find((line) => line.calcType === "service_fee")!;
        fee.amount = "3000.00";
        fee.reason = "Repeat customer, fee reduced";
        const reconciled = reconcileLines(calculated.snapshot.output.lines, submitted, 2);
        expect(reconciled.ok).toBe(true);
        if (!reconciled.ok) return;

        // 3. The database takes the same lines and snapshot.
        await h.actAs(buyer);
        const orderId = (
          await oneRow(
            "select public.create_link_order('https://www.aliexpress.com/item/1.html', 2, '', '', null, $1, 'NGN') as id",
            [recipient],
          )
        ).id;
        await h.actAs(admin);
        const { id: quoteId } = await oneRow("select public.send_quote($1, $2::jsonb, 48, $3::jsonb) as id", [
          orderId,
          JSON.stringify(reconciled.lines),
          JSON.stringify(calculated.snapshot),
        ]);

        const quote = await oneRow("select total_minor::int as t from public.quotes where id = $1", [
          quoteId,
        ]);
        const expectedTotal = calculated.total - (416_667 - 300_000);
        expect(quote.t).toBe(expectedTotal);
        const lines = await h.query(
          "select amount_minor::int as a from public.quote_lines where quote_id = $1",
          [quoteId],
        );
        expect(lines.rows.reduce((sum, row) => sum + row.a, 0)).toBe(quote.t);
        const override = await oneRow(
          `select o.reason, o.original_amount_minor::int as original from public.quote_line_overrides o
           join public.quote_lines l on l.id = o.quote_line_id where l.quote_id = $1`,
          [quoteId],
        );
        expect(override).toEqual({ reason: "Repeat customer, fee reduced", original: 416_667 });

        // 4. Rates change afterwards: every fee rule is replaced with a dearer one.
        await h.asServer();
        const open = await h.query(
          "select id from public.fee_rules where effective_to is null and fee_type = 'service_fee' and corridor_id = $1",
          [cnNg],
        );
        await h.actAs(admin);
        await h.query("select public.replace_fee_rule($1, 'percent', 9, 'NGN', 200000)", [open.rows[0].id]);

        // 5. The snapshot read back from the database still gives the original total and lines.
        const stored = await oneRow(
          "select snapshot from public.quote_pricing_snapshots where quote_id = $1",
          [quoteId],
        );
        expect(snapshotReproduces(stored.snapshot)).toBe(true);
        const replayed = replaySnapshot(stored.snapshot);
        expect(replayed.total).toBe(calculated.total);
        expect(replayed.lines).toEqual(calculated.lines);
      });
    });
  });

  describe("request throttle", () => {
    it("allows 30 in the hour per bucket and then refuses, each bucket on its own", async () => {
      await h.scenario(async () => {
        await h.asServiceRole();
        const hit = async (bucket: string) =>
          (await oneRow("select public.throttle_hit($1, 30, 3600) as ok", [bucket])).ok;
        const results: boolean[] = [];
        for (let i = 0; i < 32; i++) results.push(await hit("estimate:a"));
        expect(results.slice(0, 30).every(Boolean)).toBe(true);
        expect(results.slice(30)).toEqual([false, false]);
        expect(await hit("estimate:b")).toBe(true);
      });
    });

    it("is for server code only", async () => {
      await h.scenario(async () => {
        for (const who of [buyer, admin, "anon" as const]) {
          await h.actAs(who);
          await h.expectError("select public.throttle_hit('x', 1, 60)", [], PERMISSION_DENIED);
        }
        await h.asServiceRole();
        await h.expectError("select public.throttle_hit('x', 0, 60)", [], /Invalid throttle/);
      });
    });
  });
});
