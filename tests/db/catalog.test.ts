/**
 * Batch 2: catalog and vendor application rules, tested as real database roles.
 * Covers categories, product rules (prohibited terms, corridor, condition),
 * visibility, search, vendor review transitions and what visitors can read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findProhibitedTerms, PROHIBITED_TERMS } from "@/lib/catalog/prohibited";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, RLS_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: catalog and vendor applications", () => {
  const h = new DbHarness();

  let admin: TestUser;
  let buyer: TestUser;
  let ownerA: TestUser;
  let ownerB: TestUser;
  let pendingOwner: TestUser;
  let suspendedOwner: TestUser;
  let vendorA: string;
  let vendorB: string;
  let pendingVendor: string;
  let suspendedVendor: string;
  let cnNg: string;
  let ngNg: string;

  async function makeVendor(
    owner: TestUser,
    name: string,
    country: string,
    status: "pending" | "approved",
    withDocument = true,
  ): Promise<string> {
    await h.asServer();
    const { rows } = await h.query(
      `insert into public.vendors (owner_id, business_name, country_code, city, status, phone, categories, id_document_path)
       values ($1, $2, $3, 'City', $4, '+8613800000000', array['phones', 'laptops'], $5) returning id`,
      [owner.id, name, country, status, withDocument ? `${owner.id}/id1.pdf` : null],
    );
    if (status === "approved") await h.setRoleAsServer(owner.id, "vendor");
    return rows[0].id;
  }

  type ProductOverrides = Partial<{
    title: string;
    description: string;
    brand: string | null;
    category: string;
    condition: string;
    condition_notes: string | null;
    price_minor: number;
    currency: string;
    corridor: string;
    active: boolean;
    specs: object;
  }>;

  /** Inserts a product through the vendor's own session, as the app does. */
  async function createProduct(
    owner: TestUser,
    vendorId: string,
    overrides: ProductOverrides = {},
  ): Promise<string> {
    await h.actAs(owner);
    const o = {
      title: "Samsung Galaxy A15",
      description: "Brand new phone with a 6.5 inch screen and 5000 mAh battery.",
      brand: "Samsung",
      category: "phones",
      condition: "new",
      condition_notes: null,
      price_minor: 15_000_000,
      currency: "NGN",
      corridor: cnNg,
      active: false,
      specs: { RAM: "6 GB" },
      ...overrides,
    };
    const { rows } = await h.query(
      `insert into public.products
         (vendor_id, title, description, brand, category, condition, condition_notes, price_minor, currency,
          stock, weight_grams, corridor_id, specs, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5, 300, $10, $11, $12) returning id`,
      [
        vendorId,
        o.title,
        o.description,
        o.brand,
        o.category,
        o.condition,
        o.condition_notes,
        o.price_minor,
        o.currency,
        o.corridor,
        JSON.stringify(o.specs),
        o.active,
      ],
    );
    return rows[0].id;
  }

  let imageCounter = 0;
  async function addImage(owner: TestUser, vendorId: string, productId: string): Promise<void> {
    await h.actAs(owner);
    await h.query("insert into public.product_images (product_id, storage_path) values ($1, $2)", [
      productId,
      `${vendorId}/${productId}/img${imageCounter++}.jpg`,
    ]);
  }

  async function asAdminSuspend(vendorId: string, note = "Fake stock photos found"): Promise<void> {
    await h.actAs(admin);
    await h.query("select public.suspend_vendor($1, $2)", [vendorId, note]);
  }

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser({ full_name: "Admin" });
    buyer = await h.createUser({ full_name: "Buyer" });
    ownerA = await h.createUser({ full_name: "Vendor A" });
    ownerB = await h.createUser({ full_name: "Vendor B" });
    pendingOwner = await h.createUser({ full_name: "Pending" });
    suspendedOwner = await h.createUser({ full_name: "Suspended" });
    await h.setRoleAsServer(admin.id, "admin");

    cnNg = (
      await h.query(
        "select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'",
      )
    ).rows[0].id;
    ngNg = (
      await h.query(
        "select id from public.corridors where origin_country = 'NG' and destination_country = 'NG'",
      )
    ).rows[0].id;

    vendorA = await makeVendor(ownerA, "Shenzhen Phones", "CN", "approved");
    vendorB = await makeVendor(ownerB, "Guangzhou Gadgets", "CN", "approved");
    pendingVendor = await makeVendor(pendingOwner, "Lagos Pending Shop", "NG", "pending");
    suspendedVendor = await makeVendor(suspendedOwner, "Closed Shop", "CN", "approved");
    await asAdminSuspend(suspendedVendor);
  });

  afterAll(() => h.stop());

  describe("categories", () => {
    it("shows visitors the 2 groups and 16 categories, never the prohibited ones", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        const { rows } = await h.query("select slug from public.categories");
        const slugs = rows.map((r) => r.slug);
        expect(slugs).toHaveLength(18);
        expect(slugs).toEqual(
          expect.arrayContaining([
            "electronics",
            "general",
            "phones",
            "solar_power",
            "small_appliances",
            "books",
          ]),
        );
        for (const prohibited of ["weapons", "drugs", "counterfeit", "hazardous"]) {
          expect(slugs).not.toContain(prohibited);
        }
      });
    });

    it("lets admins see the prohibited categories, flagged as prohibited", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        const { rows } = await h.query("select slug from public.categories where prohibited order by slug");
        expect(rows.map((r) => r.slug)).toEqual(["counterfeit", "drugs", "hazardous", "weapons"]);
      });
    });

    it("blocks non-admins from changing categories or the prohibited terms list", async () => {
      await h.scenario(async () => {
        await h.actAs(ownerA);
        expect(
          (await h.query("update public.categories set active = false where slug = 'phones'")).rowCount,
        ).toBe(0);
        await h.expectError(
          "insert into public.categories (slug, name) values ('toys', 'Toys')",
          [],
          RLS_DENIED,
        );
        expect((await h.query("select * from public.prohibited_terms")).rowCount).toBe(0);
        await h.actAs("anon");
        await h.expectError("select * from public.prohibited_terms", [], PERMISSION_DENIED);
      });
    });
  });

  describe("prohibited terms: database and code stay in step", () => {
    it("holds exactly the terms in lib/catalog/prohibited.ts", async () => {
      await h.asServer();
      const { rows } = await h.query("select term from public.prohibited_terms order by term");
      expect(rows.map((r) => r.term)).toEqual([...PROHIBITED_TERMS].sort());
    });

    it.each([
      "Genuine iPhone replica with box",
      "FIREARM cleaning kit",
      "AirPods Pro, first copy, 1 year warranty",
      "super copy and knock-off watches",
      "Fireworks, pepper spray and a stun gun",
      "clone. fake! (replica)",
      "Samsung Galaxy S24 Ultra 256GB, sealed",
      "Methane detector for the kitchen",
      "Heat gun 2000W with two nozzles",
      "methods and methodology",
      "a meth lab",
      "",
    ])("finds the same terms in %j", async (text) => {
      await h.asServer();
      const { rows } = await h.query("select public.matched_prohibited_terms($1) as terms", [text]);
      expect(rows[0].terms).toEqual(findProhibitedTerms(text));
    });
  });

  describe("product rules", () => {
    it("lets an approved vendor save a product as inactive with no flag", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA);
        await h.asServer();
        const { rows } = await h.query(
          "select active, flagged_at, corridor_id from public.products where id = $1",
          [id],
        );
        expect(rows[0]).toEqual({ active: false, flagged_at: null, corridor_id: cnNg });
      });
    });

    it("refuses prohibited, group and unknown categories, however the row is written", async () => {
      await h.scenario(async () => {
        for (const category of ["weapons", "drugs", "counterfeit", "hazardous", "electronics", "toys"]) {
          await h.expectError(
            `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
             values ($1, 'Item', 'A description long enough.', $2, 100, 'NGN', $3)`,
            [vendorA, category, cnNg],
            /category is not available|violates foreign key/,
          );
        }
      });
    });

    it("refuses a category an admin has switched off", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.query("update public.categories set active = false where slug = 'tablets'");
        await h.actAs(ownerA);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'Item', 'A description long enough.', 'tablets', 100, 'NGN', $2)`,
          [vendorA, cnNg],
          /category is not available/,
        );
      });
    });

    it("requires a corridor that is active and starts in the vendor's country", async () => {
      await h.scenario(async () => {
        await h.actAs(ownerA);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2)`,
          [vendorA, ngNg],
          /corridor must be active and start in the vendor/,
        );
        await h.asServer();
        await h.query("update public.corridors set active = false where id = $1", [cnNg]);
        await h.actAs(ownerA);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2)`,
          [vendorA, cnNg],
          /corridor must be active/,
        );
      });
    });

    it("requires condition notes when the condition is not new", async () => {
      await h.scenario(async () => {
        for (const condition of ["used", "open_box", "refurbished"]) {
          await h.expectError(
            `insert into public.products (vendor_id, title, description, category, condition, price_minor, currency, corridor_id)
             values ($1, 'Item', 'A description long enough.', 'phones', $2, 100, 'NGN', $3)`,
            [vendorA, condition, cnNg],
            /products_condition_notes_required/,
          );
        }
        const id = await createProduct(ownerA, vendorA, {
          condition: "used",
          condition_notes: "Scratches on the back, battery health 85%.",
        });
        expect(id).toBeTruthy();
      });
    });

    it("limits price to above zero and the cap, and requires specs to be an object", async () => {
      await h.scenario(async () => {
        for (const price of [0, -5, 1_000_000_000_001]) {
          await h.expectError(
            `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
             values ($1, 'Item', 'A description long enough.', 'phones', $2, 'NGN', $3)`,
            [vendorA, price, cnNg],
            /products_price_(range|minor_check)/,
          );
        }
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, specs)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2, '[]')`,
          [vendorA, cnNg],
          /products_specs_shape/,
        );
      });
    });

    it("needs at least one image before a vendor can publish", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA);
        await h.expectError(
          "update public.products set active = true where id = $1",
          [id],
          /at least one image/,
        );
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, active)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2, true)`,
          [vendorA, cnNg],
          /at least one image/,
        );
        await addImage(ownerA, vendorA, id);
        await h.actAs(ownerA);
        expect((await h.query("update public.products set active = true where id = $1", [id])).rowCount).toBe(
          1,
        );
      });
    });
  });

  describe("prohibited keyword check", () => {
    it("saves a matching product as inactive and flags it, even if the vendor asked for active", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA, { title: "iPhone 15 replica", active: true });
        await h.asServer();
        const { rows } = await h.query(
          "select active, flagged_at, flagged_reason from public.products where id = $1",
          [id],
        );
        expect(rows[0].active).toBe(false);
        expect(rows[0].flagged_at).toBeInstanceOf(Date);
        expect(rows[0].flagged_reason).toBe("Matched prohibited terms: replica");

        const log = await h.query("select action, actor_id from public.audit_log where entity_id = $1", [id]);
        expect(log.rows).toEqual([{ action: "product.flagged", actor_id: ownerA.id }]);
      });
    });

    it("catches words in the description, brand, condition notes and spec values", async () => {
      await h.scenario(async () => {
        const cases: ProductOverrides[] = [
          { description: "Looks just like the original, it is a super copy of the phone." },
          { brand: "Replica Mobile" },
          { condition: "used", condition_notes: "Screen is fake, replaced by the seller." },
          { specs: { Origin: "knockoff" } },
        ];
        for (const overrides of cases) {
          const id = await createProduct(ownerA, vendorA, overrides);
          await h.asServer();
          const { rows } = await h.query("select flagged_at from public.products where id = $1", [id]);
          expect(rows[0].flagged_at, JSON.stringify(overrides)).not.toBeNull();
        }
      });
    });

    it("flags and hides a live product when its wording is edited to include a term", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA);
        await addImage(ownerA, vendorA, id);
        await h.actAs(ownerA);
        await h.query("update public.products set active = true where id = $1", [id]);

        await h.query(
          "update public.products set description = 'Now a fake version of the phone.' where id = $1",
          [id],
        );
        await h.asServer();
        const { rows } = await h.query("select active, flagged_at from public.products where id = $1", [id]);
        expect(rows[0].active).toBe(false);
        expect(rows[0].flagged_at).not.toBeNull();
      });
    });

    it("does not let a vendor clear the flag, publish a flagged product, or reword until it passes", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA, { title: "Phone replica" });
        await addImage(ownerA, vendorA, id);
        await h.actAs(ownerA);
        await h.expectError(
          "update public.products set flagged_at = null, flagged_reason = null where id = $1",
          [id],
          PERMISSION_DENIED,
        );
        await h.expectError("update public.products set active = true where id = $1", [id], /under review/);

        // Rewording does not clear the flag.
        await h.query(
          "update public.products set title = 'Phone', description = 'A plain phone with no issues.' where id = $1",
          [id],
        );
        await h.asServer();
        expect(
          (await h.query("select flagged_at from public.products where id = $1", [id])).rows[0].flagged_at,
        ).not.toBeNull();
      });
    });

    it("lets an admin clear the flag, after which the vendor can publish", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA, { title: "Fake plant pot stand" });
        await addImage(ownerA, vendorA, id);

        await h.actAs(ownerA);
        await h.expectError("select public.clear_product_flag($1)", [id], /Only admins/);

        await h.actAs(admin);
        await h.query("select public.clear_product_flag($1)", [id]);
        await h.expectError("select public.clear_product_flag($1)", [id], /not flagged/);

        await h.actAs(ownerA);
        expect((await h.query("update public.products set active = true where id = $1", [id])).rowCount).toBe(
          1,
        );

        await h.asServer();
        const log = await h.query(
          "select action from public.audit_log where entity_id = $1 order by created_at",
          [id],
        );
        expect(log.rows.map((r) => r.action)).toEqual(["product.flagged", "product.flag_cleared"]);
      });
    });

    it("does not flag a normal listing", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA, {
          title: "EcoFlow River 2 Pro Power Station",
          description: "768Wh portable power station with solar input and fast charging.",
          category: "solar_power",
          brand: "EcoFlow",
        });
        await h.asServer();
        expect(
          (await h.query("select flagged_at from public.products where id = $1", [id])).rows[0].flagged_at,
        ).toBeNull();
      });
    });
  });

  describe("who can write products", () => {
    it("blocks a vendor from editing or deleting another vendor's product", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerB, vendorB);
        await h.actAs(ownerA);
        expect(
          (await h.query("update public.products set title = 'Hijacked title' where id = $1", [id])).rowCount,
        ).toBe(0);
        expect((await h.query("delete from public.products where id = $1", [id])).rowCount).toBe(0);
        await h.asServer();
        expect((await h.query("select title from public.products where id = $1", [id])).rows[0].title).toBe(
          "Samsung Galaxy A15",
        );
      });
    });

    it("blocks a vendor from creating products for another vendor or moving a product", async () => {
      await h.scenario(async () => {
        await h.actAs(ownerA);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2)`,
          [vendorB, cnNg],
          RLS_DENIED,
        );
        const id = await createProduct(ownerA, vendorA);
        await h.actAs(ownerA);
        await h.expectError(
          "update public.products set vendor_id = $2 where id = $1",
          [id, vendorB],
          PERMISSION_DENIED,
        );
      });
    });

    it("blocks a pending vendor from creating products", async () => {
      await h.scenario(async () => {
        await h.actAs(pendingOwner);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'Item', 'A description long enough.', 'phones', 100, 'NGN', $2)`,
          [pendingVendor, ngNg],
          RLS_DENIED,
        );
      });
    });

    it("blocks a suspended vendor from creating or editing products", async () => {
      await h.scenario(async () => {
        await h.asServer();
        const { rows } = await h.query(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, active)
           values ($1, 'Old listing', 'A description long enough.', 'phones', 100, 'NGN', $2, true) returning id`,
          [suspendedVendor, cnNg],
        );
        await h.actAs(suspendedOwner);
        await h.expectError(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
           values ($1, 'New listing', 'A description long enough.', 'phones', 100, 'NGN', $2)`,
          [suspendedVendor, cnNg],
          RLS_DENIED,
        );
        expect(
          (await h.query("update public.products set title = 'Edited title' where id = $1", [rows[0].id]))
            .rowCount,
        ).toBe(0);
        expect((await h.query("select id from public.products")).rowCount).toBe(0);
      });
    });

    it("deletes a product that was never ordered, with its image rows, but keeps one that was", async () => {
      await h.scenario(async () => {
        const free = await createProduct(ownerA, vendorA);
        await addImage(ownerA, vendorA, free);
        await h.actAs(ownerA);
        expect((await h.query("delete from public.products where id = $1", [free])).rowCount).toBe(1);
        await h.asServer();
        expect(
          (await h.query("select 1 from public.product_images where product_id = $1", [free])).rowCount,
        ).toBe(0);

        const ordered = await createProduct(ownerA, vendorA);
        await h.asServer();
        const order = await h.query(
          "insert into public.orders (buyer_id, order_type, source_url, buyer_currency) values ($1, 'link', 'https://example.com/x', 'NGN') returning id",
          [buyer.id],
        );
        await h.query(
          `insert into public.order_items (order_id, product_id, description, quantity, unit_price_minor, currency)
           values ($1, $2, 'Phone', 1, 100, 'NGN')`,
          [order.rows[0].id, ordered],
        );
        await h.actAs(ownerA);
        await h.expectError(
          "delete from public.products where id = $1",
          [ordered],
          /violates foreign key constraint/,
        );
      });
    });
  });

  describe("what visitors see", () => {
    async function visibleTitles(who: TestUser | "anon"): Promise<string[]> {
      await h.actAs(who);
      const { rows } = await h.query("select title from public.products order by title");
      return rows.map((r) => r.title);
    }

    async function publish(
      owner: TestUser,
      vendorId: string,
      title: string,
      overrides: ProductOverrides = {},
    ) {
      const id = await createProduct(owner, vendorId, { title, ...overrides });
      await addImage(owner, vendorId, id);
      await h.actAs(owner);
      await h.query("update public.products set active = true where id = $1", [id]);
      return id;
    }

    it("shows a product only when it is active, not flagged, and its vendor is approved", async () => {
      await h.scenario(async () => {
        await publish(ownerA, vendorA, "Live Phone");
        await createProduct(ownerA, vendorA, { title: "Draft Phone" });
        await createProduct(ownerA, vendorA, { title: "Flagged replica Phone", active: true });
        expect(await visibleTitles("anon")).toEqual(["Live Phone"]);
      });
    });

    it("hides every product when its vendor is suspended, and shows them again when reinstated", async () => {
      await h.scenario(async () => {
        await publish(ownerA, vendorA, "Phone One");
        await publish(ownerA, vendorA, "Phone Two");
        await publish(ownerB, vendorB, "Other Vendor Phone");
        expect(await visibleTitles("anon")).toEqual(["Other Vendor Phone", "Phone One", "Phone Two"]);

        await asAdminSuspend(vendorA);
        expect(await visibleTitles("anon")).toEqual(["Other Vendor Phone"]);
        // An admin looking at the raw table still sees them, which is why the shop reads as a visitor.
        await h.actAs(admin);
        expect(
          (await h.query("select id from public.products where vendor_id = $1", [vendorA])).rowCount,
        ).toBe(2);

        await h.actAs(admin);
        await h.query("select public.approve_vendor($1)", [vendorA]);
        expect(await visibleTitles("anon")).toEqual(["Other Vendor Phone", "Phone One", "Phone Two"]);
      });
    });

    it("never shows products of a pending or suspended vendor to visitors", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await h.query(
          `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, active) values
             ($1, 'Suspended Vendor Phone', 'A description long enough.', 'phones', 100, 'NGN', $3, true),
             ($2, 'Pending Vendor Phone', 'A description long enough.', 'phones', 100, 'NGN', $4, true)`,
          [suspendedVendor, pendingVendor, cnNg, ngNg],
        );
        expect(await visibleTitles("anon")).toEqual([]);
        expect(await visibleTitles(buyer)).toEqual([]);
      });
    });

    it("lets visitors see images only for visible products", async () => {
      await h.scenario(async () => {
        const live = await publish(ownerA, vendorA, "Live Phone");
        const draft = await createProduct(ownerA, vendorA, { title: "Draft Phone" });
        await addImage(ownerA, vendorA, draft);
        await h.actAs("anon");
        const { rows } = await h.query("select product_id from public.product_images");
        expect(new Set(rows.map((r) => r.product_id))).toEqual(new Set([live]));
      });
    });

    it("keeps phone, registration number, ID document and payouts private", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        await h.expectError("select phone from public.vendors", [], PERMISSION_DENIED);
        await h.expectError("select id_document_path from public.vendors", [], PERMISSION_DENIED);
        await h.actAs(buyer);
        expect(
          (await h.query("select phone, id_document_path, payout_details_json from public.vendors")).rowCount,
        ).toBe(0);
        await h.actAs(ownerB);
        const { rows } = await h.query("select id from public.vendors");
        expect(rows.map((r) => r.id)).toEqual([vendorB]);
      });
    });
  });

  describe("search and brands", () => {
    const search = async (query: string) => {
      await h.actAs("anon");
      const { rows } = await h.query(
        "select title from public.products where search_vector @@ to_tsquery('simple', $1) order by title",
        [query],
      );
      return rows.map((r) => r.title);
    };

    it("finds products by brand, title words, category and prefix", async () => {
      await h.scenario(async () => {
        const publishNow = async (owner: TestUser, vendorId: string, overrides: ProductOverrides) => {
          const id = await createProduct(owner, vendorId, overrides);
          await addImage(owner, vendorId, id);
          await h.actAs(owner);
          await h.query("update public.products set active = true where id = $1", [id]);
        };
        await publishNow(ownerA, vendorA, { title: "Galaxy A15 128GB", brand: "Samsung" });
        await publishNow(ownerA, vendorA, {
          title: "Redmi Note 13",
          brand: "Xiaomi",
          description: "Fast charging phone for everyday use.",
        });
        await publishNow(ownerB, vendorB, {
          title: "ThinkPad E14",
          brand: "Lenovo",
          category: "laptops",
          description: "Business laptop with a long battery life.",
        });

        expect(await search("samsung:*")).toEqual(["Galaxy A15 128GB"]);
        expect(await search("sams:*")).toEqual(["Galaxy A15 128GB"]);
        expect(await search("xiao:* & redm:*")).toEqual(["Redmi Note 13"]);
        expect(await search("laptops:*")).toEqual(["ThinkPad E14"]);
        expect(await search("charging:*")).toEqual(["Redmi Note 13"]);
        expect(await search("nokia:*")).toEqual([]);
      });
    });

    it("does not find hidden products", async () => {
      await h.scenario(async () => {
        await createProduct(ownerA, vendorA, { title: "Secret Draft Phone", brand: "Samsung" });
        expect(await search("secret:*")).toEqual([]);
      });
    });

    it("lists brands from visible products only, merging different capitalisation", async () => {
      await h.scenario(async () => {
        for (const [brand, title] of [
          ["Samsung", "Phone 1"],
          ["samsung", "Phone 2"],
          ["Tecno", "Phone 3"],
        ] as const) {
          const id = await createProduct(ownerA, vendorA, { brand, title });
          await addImage(ownerA, vendorA, id);
          await h.actAs(ownerA);
          await h.query("update public.products set active = true where id = $1", [id]);
        }
        await createProduct(ownerA, vendorA, { brand: "HiddenBrand", title: "Draft" });

        await h.actAs("anon");
        const { rows } = await h.query(
          "select brand_key, product_count from public.shop_brands order by brand_key",
        );
        expect(rows).toEqual([
          { brand_key: "samsung", product_count: 2 },
          { brand_key: "tecno", product_count: 1 },
        ]);
      });
    });
  });

  describe("images", () => {
    it("allows at most 6 images per product and needs the file to sit in the product's folder", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA);
        for (let i = 0; i < 6; i++) await addImage(ownerA, vendorA, id);
        await h.actAs(ownerA);
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [id, `${vendorA}/${id}/seventh.jpg`],
          /at most 6 images/,
        );
      });
    });

    it("lets server code, but not vendors, use the demo image paths", async () => {
      await h.scenario(async () => {
        const id = await createProduct(ownerA, vendorA);
        await h.actAs(ownerA);
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, 'demo/phone-1.webp')",
          [id],
          /Image path must be/,
        );
        await h.asServer();
        expect(
          (
            await h.query(
              "insert into public.product_images (product_id, storage_path) values ($1, 'demo/phone-1.webp')",
              [id],
            )
          ).rowCount,
        ).toBe(1);
      });
    });
  });

  describe("vendor applications", () => {
    const apply = (owner: TestUser, extra = "") =>
      h.query(
        `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path ${extra ? "," + extra.split("=")[0] : ""})
         values ($1, 'Ada Gadgets', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/id1.jpg' ${extra ? "," + extra.split("=")[1] : ""}) returning id, status`,
        [owner.id],
      );

    it("creates a pending application with all the details", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        const { rows } = await apply(buyer);
        expect(rows[0].status).toBe("pending");
        await h.asServer();
        const audit = await h.query("select action from public.audit_log where entity_id = $1", [rows[0].id]);
        expect(audit.rows).toEqual([{ action: "vendor.applied" }]);
      });
    });

    it("rejects an incomplete application", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        for (const columns of [
          "(owner_id, business_name, country_code, city, categories, id_document_path) values ($1, 'A Shop', 'NG', 'Lagos', array['phones'], $1::uuid::text || '/id.jpg')",
          "(owner_id, business_name, country_code, city, phone, id_document_path) values ($1, 'A Shop', 'NG', 'Lagos', '+2348031234567', $1::uuid::text || '/id.jpg')",
          "(owner_id, business_name, country_code, city, phone, categories) values ($1, 'A Shop', 'NG', 'Lagos', '+2348031234567', array['phones'])",
        ]) {
          await h.expectError(
            `insert into public.vendors ${columns}`,
            [buyer.id],
            /application needs a phone number/,
          );
        }
      });
    });

    it("rejects an ID document path that is not in the applicant's own folder, or has a bad shape", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        for (const path of [
          `${ownerA.id}/id.jpg`,
          `${buyer.id}/sub/id.jpg`,
          `${buyer.id}/id.exe`,
          `${buyer.id}/../${ownerA.id}/id.jpg`,
        ]) {
          await h.expectError(
            `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
             values ($1, 'A Shop', 'NG', 'Lagos', '+2348031234567', array['phones'], $2)`,
            [buyer.id, path],
            /ID document path is not valid/,
          );
        }
      });
    });

    it("rejects prohibited, group, unknown and repeated categories and a bad phone number", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        for (const categories of [
          "array['weapons']",
          "array['electronics']",
          "array['nope']",
          "array['phones','phones']",
        ]) {
          await h.expectError(
            `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
             values ($1, 'A Shop', 'NG', 'Lagos', '+2348031234567', ${categories}, $1::uuid::text || '/id.jpg')`,
            [buyer.id],
            /not available|duplicates/,
          );
        }
        await h.expectError(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'A Shop', 'NG', 'Lagos', '08031234567', array['phones'], $1::uuid::text || '/id.jpg')`,
          [buyer.id],
          /vendors_phone_check/,
        );
      });
    });

    it("allows only one vendor record per user", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await apply(buyer);
        await h.expectError(
          `insert into public.vendors (owner_id, business_name, country_code, city, phone, categories, id_document_path)
           values ($1, 'Second Shop', 'NG', 'Lagos', '+2348031234567', array['phones'], $1::uuid::text || '/id2.jpg')`,
          [buyer.id],
          /vendors_owner_id_key/,
        );
      });
    });
  });

  describe("vendor review", () => {
    async function newApplication(): Promise<{ id: string; owner: TestUser }> {
      await h.asServer();
      const owner = await h.createUser({ full_name: "Applicant" });
      const id = await makeVendor(owner, "Applicant Shop", "NG", "pending");
      return { id, owner };
    }

    it("rejects a pending application with a reason, shows it to the applicant, and logs it", async () => {
      await h.scenario(async () => {
        const { id, owner } = await newApplication();
        await h.actAs(admin);
        await h.query("select public.reject_vendor($1, 'ID photo is blurry, please upload a clear copy.')", [
          id,
        ]);

        await h.actAs(owner);
        const { rows } = await h.query("select status, verification_notes from public.vendors");
        expect(rows).toEqual([
          { status: "rejected", verification_notes: "ID photo is blurry, please upload a clear copy." },
        ]);

        await h.asServer();
        const audit = await h.query(
          "select details from public.audit_log where entity_id = $1 and action = 'vendor.status_changed'",
          [id],
        );
        expect(audit.rows[0].details).toEqual({
          from: "pending",
          to: "rejected",
          reason: "ID photo is blurry, please upload a clear copy.",
        });
      });
    });

    it("needs a reason, an admin, and a pending application to reject", async () => {
      await h.scenario(async () => {
        const { id, owner } = await newApplication();
        await h.actAs(admin);
        await h.expectError("select public.reject_vendor($1, '')", [id], /reason of 5 to 2000/);
        await h.expectError("select public.reject_vendor($1, 'no')", [id], /reason of 5 to 2000/);
        await h.expectError(
          "select public.reject_vendor($1, 'Approved vendors need suspending instead')",
          [vendorA],
          /Only pending applications/,
        );
        await h.actAs(owner);
        await h.expectError(
          "select public.reject_vendor($1, 'Rejecting myself for fun')",
          [id],
          /Only admins/,
        );
      });
    });

    it("lets a rejected applicant resubmit, which clears the reason, but never approve themselves", async () => {
      await h.scenario(async () => {
        const { id, owner } = await newApplication();
        await h.actAs(admin);
        await h.query("select public.reject_vendor($1, 'Business name does not match the ID.')", [id]);

        await h.actAs(owner);
        await h.expectError(
          "update public.vendors set status = 'approved' where id = $1",
          [id],
          /Only admins can change vendor status/,
        );
        await h.expectError(
          "update public.vendors set verification_notes = 'all good' where id = $1",
          [id],
          /Only admins/,
        );

        await h.query(
          "update public.vendors set business_name = 'Corrected Name Ltd', status = 'pending' where id = $1",
          [id],
        );
        const { rows } = await h.query(
          "select status, verification_notes, business_name from public.vendors",
        );
        expect(rows).toEqual([
          { status: "pending", verification_notes: null, business_name: "Corrected Name Ltd" },
        ]);
      });
    });

    it("does not let an approved vendor go back to pending or rewrite business details", async () => {
      await h.scenario(async () => {
        await h.actAs(ownerA);
        await h.expectError(
          "update public.vendors set status = 'pending' where id = $1",
          [vendorA],
          /Only admins can change vendor status/,
        );
        await h.expectError(
          "update public.vendors set business_name = 'New Name' where id = $1",
          [vendorA],
          /Contact support/,
        );
        await h.expectError(
          "update public.vendors set country_code = 'NG' where id = $1",
          [vendorA],
          /Contact support/,
        );
        expect(
          (
            await h.query(
              "update public.vendors set phone = '+8613900000000', categories = array['phones'] where id = $1",
              [vendorA],
            )
          ).rowCount,
        ).toBe(1);
      });
    });

    it("approves pending and suspended vendors only, and needs the ID document for a pending one", async () => {
      await h.scenario(async () => {
        const noDoc = await h.createUser({ full_name: "No Document" });
        const noDocVendor = await makeVendor(noDoc, "No Doc Shop", "NG", "pending", false);
        await h.actAs(admin);
        await h.expectError("select public.approve_vendor($1)", [noDocVendor], /no ID document/);
        await h.expectError("select public.approve_vendor($1)", [vendorB], /Only pending or suspended/);

        const { id, owner } = await newApplication();
        await h.actAs(admin);
        await h.query("select public.approve_vendor($1)", [id]);
        await h.actAs(owner);
        expect(
          (await h.query("select public.current_user_role() as role, public.current_vendor_id() as vid"))
            .rows[0],
        ).toEqual({
          role: "vendor",
          vid: id,
        });
      });
    });

    it("suspends approved vendors only, needs a reason, and makes the owner a buyer again", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError("select public.suspend_vendor($1)", [vendorB], /reason of 5 to 2000/);
        await h.expectError(
          "select public.suspend_vendor($1, 'Selling counterfeit goods')",
          [pendingVendor],
          /Only approved vendors/,
        );

        await h.query("select public.suspend_vendor($1, 'Selling counterfeit goods')", [vendorB]);
        await h.actAs(ownerB);
        expect(
          (await h.query("select public.current_user_role() as role, public.current_vendor_id() as vid"))
            .rows[0],
        ).toEqual({
          role: "buyer",
          vid: null,
        });
        expect(
          (await h.query("select verification_notes from public.vendors")).rows[0].verification_notes,
        ).toBe("Selling counterfeit goods");
      });
    });

    it("lets only admins record an ID document view, and writes it to the audit log", async () => {
      await h.scenario(async () => {
        await h.actAs(ownerA);
        await h.expectError("select public.log_vendor_document_view($1)", [vendorA], /Only admins/);
        await h.actAs("anon");
        await h.expectError("select public.log_vendor_document_view($1)", [vendorA], PERMISSION_DENIED);
        await h.actAs(admin);
        await h.query("select public.log_vendor_document_view($1)", [vendorA]);
        await h.asServer();
        const log = await h.query(
          "select actor_id from public.audit_log where entity_id = $1 and action = 'vendor.document_viewed'",
          [vendorA],
        );
        expect(log.rows).toEqual([{ actor_id: admin.id }]);
      });
    });
  });
});
