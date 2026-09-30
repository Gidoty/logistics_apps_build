/**
 * supabase/seed-dev.sql loads demo data for local development. These tests run
 * it inside a rolled-back transaction and check that it is safe and complete.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness } from "./harness";

const SEED_DEV = readFileSync(path.join(process.cwd(), "supabase", "seed-dev.sql"), "utf8");

describe.skipIf(!DATABASE_URL)("database: demo seed (seed-dev.sql)", () => {
  const h = new DbHarness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it("refuses to run without the explicit opt-in", async () => {
    await h.scenario(async () => {
      await h.asServer();
      await expect(h.query(SEED_DEV)).rejects.toThrow(/Refusing to load demo data/);
    });
    await h.scenario(async () => {
      await h.query("select set_config('mapk.dev_seed', 'no', true)");
      await expect(h.query(SEED_DEV)).rejects.toThrow(/Refusing to load demo data/);
    });
  });

  it("loads 3 approved vendors (2 in China, 1 in Lagos) and 12 products visible to visitors", async () => {
    await h.scenario(async () => {
      await h.asServer();
      await h.query("select set_config('mapk.dev_seed', 'yes', true)");
      await h.query(SEED_DEV);

      const vendors = await h.query(
        "select country_code, count(*)::int as n from public.vendors where status = 'approved' group by country_code order by country_code",
      );
      expect(vendors.rows).toEqual([
        { country_code: "CN", n: 2 },
        { country_code: "NG", n: 1 },
      ]);

      await h.actAs("anon");
      const products = await h.query(
        "select category, condition, requires_special_handling as special, currency from public.products",
      );
      expect(products.rows).toHaveLength(12);
      expect(products.rows.filter((r) => r.category === "phones")).toHaveLength(5);
      expect(products.rows.filter((r) => r.category === "laptops")).toHaveLength(2);
      expect(products.rows.filter((r) => r.category === "accessories")).toHaveLength(2);
      expect(products.rows.filter((r) => r.special)).toEqual([
        { category: "solar_power", condition: "new", special: true, currency: "CNY" },
      ]);
      expect(new Set(products.rows.map((r) => r.condition))).toEqual(
        new Set(["new", "open_box", "refurbished", "used"]),
      );

      const images = await h.query(
        "select count(*)::int as n, count(distinct product_id)::int as products from public.product_images",
      );
      expect(images.rows[0]).toEqual({ n: 14, products: 12 });
    });
  });

  it("uses local demo picture paths only, and none are flagged", async () => {
    await h.scenario(async () => {
      await h.asServer();
      await h.query("select set_config('mapk.dev_seed', 'yes', true)");
      await h.query(SEED_DEV);
      const paths = await h.query("select storage_path from public.product_images");
      for (const row of paths.rows) expect(row.storage_path).toMatch(/^demo\/[a-z0-9-]+\.webp$/);
      expect((await h.query("select 1 from public.products where flagged_at is not null")).rowCount).toBe(0);
    });
  });

  it("creates demo users that cannot sign in, and can be run twice without duplicates", async () => {
    await h.scenario(async () => {
      await h.asServer();
      await h.query("select set_config('mapk.dev_seed', 'yes', true)");
      await h.query(SEED_DEV);
      await h.query(SEED_DEV);
      expect((await h.query("select 1 from public.products")).rowCount).toBe(12);
      expect((await h.query("select 1 from public.vendors")).rowCount).toBe(3);

      const users = await h.query("select email, encrypted_password from auth.users order by email");
      expect(users.rows).toHaveLength(3);
      for (const user of users.rows) {
        expect(user.email).toMatch(/@demo\.mapk\.test$/);
        // An empty hash can never match a typed password.
        expect(user.encrypted_password).toBe("");
      }
    });
  });

  it("shows the demo shop to a search for a brand", async () => {
    await h.scenario(async () => {
      await h.asServer();
      await h.query("select set_config('mapk.dev_seed', 'yes', true)");
      await h.query(SEED_DEV);
      await h.actAs("anon");
      const { rows } = await h.query(
        "select title from public.products where search_vector @@ to_tsquery('simple', 'samsung:*') order by title",
      );
      expect(rows.map((r) => r.title)).toEqual([
        "Demo Samsung Galaxy A15 128GB",
        "Demo Samsung Galaxy S21 128GB Used",
      ]);
    });
  });
});
