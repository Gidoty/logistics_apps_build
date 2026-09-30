/**
 * Payout detail change review and product image storage rules.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
  PRODUCT_IMAGE_MIME_TYPES,
} from "@/lib/storage/product-images";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, RLS_DENIED, type TestUser } from "./harness";

const LIVE = { bank_name: "GTBank", account_name: "Shenzhen Phones", account_number: "0123456789" };
const NEW_DETAILS = { bank_name: "Access Bank", account_name: "Attacker Ltd", account_number: "9999999999" };

describe.skipIf(!DATABASE_URL)("database: payout review and product images", () => {
  const h = new DbHarness();

  let vendorOwner: TestUser;
  let otherVendorOwner: TestUser;
  let suspendedOwner: TestUser;
  let buyer: TestUser;
  let admin: TestUser;
  let vendorId: string;
  let otherVendorId: string;
  let suspendedVendorId: string;
  let productId: string;
  let otherProductId: string;

  beforeAll(async () => {
    await h.start();
    vendorOwner = await h.createUser({ full_name: "Vendor One" });
    otherVendorOwner = await h.createUser({ full_name: "Vendor Two" });
    suspendedOwner = await h.createUser({ full_name: "Suspended Vendor" });
    buyer = await h.createUser({ full_name: "Buyer" });
    admin = await h.createUser({ full_name: "Admin" });
    await h.setRoleAsServer(admin.id, "admin");

    await h.asServer();
    const insertVendor = async (owner: TestUser, name: string, status: string, details: object) => {
      const { rows } = await h.query(
        `insert into public.vendors (owner_id, business_name, country_code, city, status, payout_details_json)
         values ($1, $2, 'CN', 'Shenzhen', $3, $4) returning id`,
        [owner.id, name, status, JSON.stringify(details)],
      );
      return rows[0].id as string;
    };
    vendorId = await insertVendor(vendorOwner, "Shenzhen Phones", "approved", LIVE);
    otherVendorId = await insertVendor(otherVendorOwner, "Guangzhou Gadgets", "approved", LIVE);
    suspendedVendorId = await insertVendor(suspendedOwner, "Closed Shop", "suspended", LIVE);
    await h.setRoleAsServer(vendorOwner.id, "vendor");
    await h.setRoleAsServer(otherVendorOwner.id, "vendor");

    const products = await h.query(
      `insert into public.products (vendor_id, title, category, price_minor, currency, active)
       values ($1, 'Phone A', 'phones', 15000000, 'NGN', true), ($2, 'Phone B', 'phones', 15000000, 'NGN', true)
       returning id, vendor_id`,
      [vendorId, otherVendorId],
    );
    productId = products.rows.find((r) => r.vendor_id === vendorId).id;
    otherProductId = products.rows.find((r) => r.vendor_id === otherVendorId).id;
  });

  afterAll(() => h.stop());

  async function vendorRow(id: string) {
    await h.asServer();
    const { rows } = await h.query(
      "select payout_details_json as live, pending_payout_details_json as pending, payout_change_requested_at as requested_at, payout_change_token as token from public.vendors where id = $1",
      [id],
    );
    return rows[0];
  }

  async function requestChange(owner: TestUser, details: object = NEW_DETAILS): Promise<string> {
    await h.actAs(owner);
    const { rows } = await h.query("select public.request_payout_change($1) as token", [
      JSON.stringify(details),
    ]);
    return rows[0].token;
  }

  describe("payout details review", () => {
    it("blocks a vendor from editing live payout details directly", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await h.expectError(
          "update public.vendors set payout_details_json = $2 where id = $1",
          [vendorId, JSON.stringify(NEW_DETAILS)],
          PERMISSION_DENIED,
        );
      });
    });

    it("blocks a vendor from writing the pending columns directly", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await h.expectError(
          "update public.vendors set pending_payout_details_json = $2, payout_change_requested_at = now(), payout_change_token = gen_random_uuid() where id = $1",
          [vendorId, JSON.stringify(NEW_DETAILS)],
          PERMISSION_DENIED,
        );
      });
    });

    it("blocks even an admin from editing payout columns through a browser session", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          "update public.vendors set payout_details_json = $2 where id = $1",
          [vendorId, JSON.stringify(NEW_DETAILS)],
          PERMISSION_DENIED,
        );
      });
    });

    it("lets an applicant set payout details once, but not the pending columns", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        const { rows } = await h.query(
          `insert into public.vendors (owner_id, business_name, country_code, city, payout_details_json)
           values ($1, 'Buyer Shop', 'NG', 'Lagos', $2) returning payout_details_json`,
          [buyer.id, JSON.stringify(LIVE)],
        );
        expect(rows[0].payout_details_json).toEqual(LIVE);
      });
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          `insert into public.vendors (owner_id, business_name, country_code, city, pending_payout_details_json, payout_change_requested_at)
           values ($1, 'Buyer Shop', 'NG', 'Lagos', $2, now())`,
          [buyer.id, JSON.stringify(NEW_DETAILS)],
          PERMISSION_DENIED,
        );
      });
    });

    it("stores a request as pending and leaves live details untouched", async () => {
      await h.scenario(async () => {
        const token = await requestChange(vendorOwner);
        const row = await vendorRow(vendorId);
        expect(row.live).toEqual(LIVE);
        expect(row.pending).toEqual(NEW_DETAILS);
        expect(row.token).toBe(token);
        expect(row.requested_at).toBeInstanceOf(Date);
      });
    });

    it("lets the vendor read their own pending request", async () => {
      await h.scenario(async () => {
        await requestChange(vendorOwner);
        await h.actAs(vendorOwner);
        const { rows } = await h.query("select pending_payout_details_json as pending from public.vendors");
        expect(rows).toEqual([{ pending: NEW_DETAILS }]);
      });
    });

    it("replaces an earlier unreviewed request with the newer one", async () => {
      await h.scenario(async () => {
        const first = await requestChange(vendorOwner, {
          bank_name: "First Bank",
          account_number: "1111111111",
        });
        const second = await requestChange(vendorOwner);
        expect(second).not.toBe(first);
        expect((await vendorRow(vendorId)).pending).toEqual(NEW_DETAILS);
      });
    });

    it("rejects requests from accounts without a vendor record and from suspended vendors", async () => {
      await h.scenario(async () => {
        await h.actAs(buyer);
        await h.expectError(
          "select public.request_payout_change($1)",
          [JSON.stringify(NEW_DETAILS)],
          /No vendor record/,
        );
        await h.actAs(suspendedOwner);
        await h.expectError(
          "select public.request_payout_change($1)",
          [JSON.stringify(NEW_DETAILS)],
          /Suspended vendors cannot change payout details/,
        );
      });
    });

    it("rejects empty, non-object and oversized payout details", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        for (const bad of ["{}", "[]", '"text"', "null"]) {
          await h.expectError("select public.request_payout_change($1::jsonb)", [bad], /non-empty object/);
        }
        await h.expectError(
          "select public.request_payout_change($1::jsonb)",
          [JSON.stringify({ note: "x".repeat(5000) })],
          /too large/,
        );
      });
    });

    it("does not let anonymous visitors call the request function", async () => {
      await h.scenario(async () => {
        await h.actAs("anon");
        await h.expectError(
          "select public.request_payout_change($1)",
          [JSON.stringify(NEW_DETAILS)],
          PERMISSION_DENIED,
        );
      });
    });

    it("blocks vendors and buyers from approving or rejecting payout changes", async () => {
      await h.scenario(async () => {
        const token = await requestChange(vendorOwner);
        for (const user of [vendorOwner, otherVendorOwner, buyer]) {
          await h.actAs(user);
          await h.expectError(
            "select public.approve_payout_change($1, $2)",
            [vendorId, token],
            /Only admins can approve/,
          );
          await h.expectError("select public.reject_payout_change($1)", [vendorId], /Only admins can reject/);
        }
        expect((await vendorRow(vendorId)).live).toEqual(LIVE);
      });
    });

    it("makes the new details live only when an admin approves, and logs it without account numbers", async () => {
      await h.scenario(async () => {
        const token = await requestChange(vendorOwner);
        await h.actAs(admin);
        await h.query("select public.approve_payout_change($1, $2)", [vendorId, token]);

        const row = await vendorRow(vendorId);
        expect(row.live).toEqual(NEW_DETAILS);
        expect(row.pending).toBeNull();
        expect(row.requested_at).toBeNull();
        expect(row.token).toBeNull();

        const log = await h.query(
          "select action, actor_id, details::text as details from public.audit_log where entity_id = $1 and action like 'vendor.payout%' order by created_at",
          [vendorId],
        );
        expect(log.rows.map((r) => r.action)).toEqual([
          "vendor.payout_change_requested",
          "vendor.payout_change_approved",
        ]);
        expect(log.rows.map((r) => r.actor_id)).toEqual([vendorOwner.id, admin.id]);
        for (const entry of log.rows) {
          expect(entry.details).not.toContain("9999999999");
          expect(entry.details).not.toContain("Attacker");
        }
      });
    });

    it("refuses to approve a request that changed after the admin opened it", async () => {
      await h.scenario(async () => {
        const reviewed = await requestChange(vendorOwner, {
          bank_name: "Reviewed Bank",
          account_number: "1111111111",
        });
        await requestChange(vendorOwner);
        await h.actAs(admin);
        await h.expectError(
          "select public.approve_payout_change($1, $2)",
          [vendorId, reviewed],
          /request changed since you opened it/,
        );
        expect((await vendorRow(vendorId)).live).toEqual(LIVE);
      });
    });

    it("refuses to approve when nothing is pending", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        await h.expectError(
          "select public.approve_payout_change($1, gen_random_uuid())",
          [vendorId],
          /No payout change is waiting/,
        );
      });
    });

    it("lets an admin reject a request: live details stay and the note is logged", async () => {
      await h.scenario(async () => {
        await requestChange(vendorOwner);
        await h.actAs(admin);
        await h.query("select public.reject_payout_change($1, 'Name does not match business')", [vendorId]);

        const row = await vendorRow(vendorId);
        expect(row.live).toEqual(LIVE);
        expect(row.pending).toBeNull();

        const log = await h.query(
          "select details from public.audit_log where entity_id = $1 and action = 'vendor.payout_change_rejected'",
          [vendorId],
        );
        expect(log.rows[0].details.note).toBe("Name does not match business");
      });
    });

    it("does not let one vendor's request touch another vendor's record", async () => {
      await h.scenario(async () => {
        await requestChange(vendorOwner);
        expect((await vendorRow(otherVendorId)).pending).toBeNull();
        expect((await vendorRow(suspendedVendorId)).pending).toBeNull();
      });
    });
  });

  describe("product image bucket", () => {
    it("is public, capped and limited to image types, matching lib/storage/product-images.ts", async () => {
      await h.asServer();
      const { rows } = await h.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1",
        [PRODUCT_IMAGE_BUCKET],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].public).toBe(true);
      expect(Number(rows[0].file_size_limit)).toBe(PRODUCT_IMAGE_MAX_BYTES);
      expect([...rows[0].allowed_mime_types].sort()).toEqual([...PRODUCT_IMAGE_MIME_TYPES].sort());
    });

    const insertObject = (name: string) =>
      h.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [PRODUCT_IMAGE_BUCKET, name]);

    it("lets an approved vendor upload inside their own folder only", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        expect((await insertObject(`${vendorId}/${productId}/a1.jpg`)).rowCount).toBe(1);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ($1, $2)",
          [PRODUCT_IMAGE_BUCKET, `${otherVendorId}/${otherProductId}/a1.jpg`],
          RLS_DENIED,
        );
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ($1, $2)",
          [PRODUCT_IMAGE_BUCKET, "loose-file.jpg"],
          RLS_DENIED,
        );
      });
    });

    it("blocks buyers, suspended vendors and anonymous visitors from uploading", async () => {
      await h.scenario(async () => {
        for (const who of [buyer, suspendedOwner, "anon"] as const) {
          await h.actAs(who);
          await h.expectError(
            "insert into storage.objects (bucket_id, name) values ($1, $2)",
            [PRODUCT_IMAGE_BUCKET, `${suspendedVendorId}/${productId}/a1.jpg`],
            /row-level security|permission denied/,
          );
        }
      });
    });

    it("lets an admin upload into any folder", async () => {
      await h.scenario(async () => {
        await h.actAs(admin);
        expect((await insertObject(`${otherVendorId}/${otherProductId}/admin.png`)).rowCount).toBe(1);
      });
    });

    it("lets a vendor list and delete only their own files", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await insertObject(`${vendorId}/${productId}/mine.jpg`);
        await insertObject(`${otherVendorId}/${otherProductId}/theirs.jpg`);

        await h.actAs(vendorOwner);
        const listed = await h.query("select name from storage.objects order by name");
        expect(listed.rows.map((r) => r.name)).toEqual([`${vendorId}/${productId}/mine.jpg`]);

        const other = await h.query("delete from storage.objects where name = $1", [
          `${otherVendorId}/${otherProductId}/theirs.jpg`,
        ]);
        expect(other.rowCount).toBe(0);
        const own = await h.query("delete from storage.objects where name = $1", [
          `${vendorId}/${productId}/mine.jpg`,
        ]);
        expect(own.rowCount).toBe(1);
      });
    });

    it("does not let anonymous visitors or buyers list the bucket", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await insertObject(`${vendorId}/${productId}/mine.jpg`);
        for (const who of [buyer, "anon"] as const) {
          await h.actAs(who);
          expect((await h.query("select name from storage.objects")).rowCount).toBe(0);
        }
      });
    });
  });

  describe("product_images rows", () => {
    const insertImage = (product: string, path: string) =>
      h.query("insert into public.product_images (product_id, storage_path) values ($1, $2)", [
        product,
        path,
      ]);

    it("accepts a path inside the product's own folder", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        expect((await insertImage(productId, `${vendorId}/${productId}/front_1.webp`)).rowCount).toBe(1);
      });
    });

    it("rejects a path that points at another vendor's folder or product", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [productId, `${otherVendorId}/${otherProductId}/stolen.jpg`],
          /Image path must be/,
        );
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [productId, `${vendorId}/${otherProductId}/wrong-product.jpg`],
          /Image path must be/,
        );
      });
    });

    it.each([
      ["path traversal", (v: string, p: string) => `${v}/${p}/../x.jpg`],
      ["nested folder", (v: string, p: string) => `${v}/${p}/sub/x.jpg`],
      ["script extension", (v: string, p: string) => `${v}/${p}/x.html`],
      ["no extension", (v: string, p: string) => `${v}/${p}/x`],
      ["prefix only", (v: string, p: string) => `${v}/${p}/`],
    ])("rejects %s", async (_label, build) => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [productId, build(vendorId, productId)],
          /Image path must be/,
        );
      });
    });

    it("rejects re-pointing an existing image at another vendor's file", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await insertImage(productId, `${vendorId}/${productId}/ok.jpg`);
        await h.expectError(
          "update public.product_images set storage_path = $2 where product_id = $1",
          [productId, `${otherVendorId}/${otherProductId}/stolen.jpg`],
          /Image path must be/,
        );
      });
    });

    it(`allows at most ${PRODUCT_IMAGE_MAX_PER_PRODUCT} images per product`, async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        for (let i = 0; i < PRODUCT_IMAGE_MAX_PER_PRODUCT; i++) {
          await insertImage(productId, `${vendorId}/${productId}/img${i}.jpg`);
        }
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [productId, `${vendorId}/${productId}/one-too-many.jpg`],
          /at most 10 images/,
        );
      });
    });

    it("still blocks a vendor from adding images to another vendor's product", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        await h.expectError(
          "insert into public.product_images (product_id, storage_path) values ($1, $2)",
          [otherProductId, `${otherVendorId}/${otherProductId}/x.jpg`],
          RLS_DENIED,
        );
      });
    });
  });
});
