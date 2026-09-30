/**
 * Storage rules for the vendor-documents (private) and product-images buckets.
 * The policies are tested as real database roles against storage.objects.
 * Public URLs are not tested here: a private bucket serves no public URL at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/storage/product-images";
import {
  VENDOR_DOCUMENT_BUCKET,
  VENDOR_DOCUMENT_MAX_BYTES,
  VENDOR_DOCUMENT_MIME_TYPES,
} from "@/lib/storage/vendor-documents";
import { DATABASE_URL, DbHarness, RLS_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: storage rules", () => {
  const h = new DbHarness();

  let admin: TestUser;
  let applicant: TestUser;
  let otherApplicant: TestUser;
  let vendorOwner: TestUser;
  let otherVendorOwner: TestUser;
  let vendorId: string;
  let otherVendorId: string;
  let productId: string;
  let otherProductId: string;

  const putDocument = (name: string) =>
    h.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [VENDOR_DOCUMENT_BUCKET, name]);
  const putImage = (name: string) =>
    h.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [PRODUCT_IMAGE_BUCKET, name]);

  beforeAll(async () => {
    await h.start();
    admin = await h.createUser({ full_name: "Admin" });
    applicant = await h.createUser({ full_name: "Applicant" });
    otherApplicant = await h.createUser({ full_name: "Other Applicant" });
    vendorOwner = await h.createUser({ full_name: "Vendor" });
    otherVendorOwner = await h.createUser({ full_name: "Other Vendor" });
    await h.setRoleAsServer(admin.id, "admin");

    const corridor = (
      await h.query(
        "select id from public.corridors where origin_country = 'CN' and destination_country = 'NG'",
      )
    ).rows[0].id;
    const makeVendor = async (owner: TestUser, name: string) => {
      const { rows } = await h.query(
        `insert into public.vendors (owner_id, business_name, country_code, city, status)
         values ($1, $2, 'CN', 'Shenzhen', 'approved') returning id`,
        [owner.id, name],
      );
      await h.setRoleAsServer(owner.id, "vendor");
      const product = await h.query(
        `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id)
         values ($1, 'Phone', 'A description long enough.', 'phones', 100, 'NGN', $2) returning id`,
        [rows[0].id, corridor],
      );
      return { vendorId: rows[0].id as string, productId: product.rows[0].id as string };
    };
    ({ vendorId, productId } = await makeVendor(vendorOwner, "Vendor One"));
    ({ vendorId: otherVendorId, productId: otherProductId } = await makeVendor(
      otherVendorOwner,
      "Vendor Two",
    ));
  });

  afterAll(() => h.stop());

  describe("vendor-documents bucket", () => {
    it("is private, capped at 5 MB and limited to images and PDF, matching the app's rules", async () => {
      await h.asServer();
      const { rows } = await h.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1",
        [VENDOR_DOCUMENT_BUCKET],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].public).toBe(false);
      expect(Number(rows[0].file_size_limit)).toBe(VENDOR_DOCUMENT_MAX_BYTES);
      expect([...rows[0].allowed_mime_types].sort()).toEqual([...VENDOR_DOCUMENT_MIME_TYPES].sort());
    });

    it("lets a signed-in user upload into their own folder only", async () => {
      await h.scenario(async () => {
        await h.actAs(applicant);
        expect((await putDocument(`${applicant.id}/id1.pdf`)).rowCount).toBe(1);
        for (const name of [
          `${otherApplicant.id}/id1.pdf`,
          "loose-file.pdf",
          `${applicant.id}/nested/id1.pdf`,
        ]) {
          await h.expectError(
            "insert into storage.objects (bucket_id, name) values ($1, $2)",
            [VENDOR_DOCUMENT_BUCKET, name],
            RLS_DENIED,
          );
        }
      });
    });

    it("lets the owner and admins read a document, and nobody else, including visitors", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putDocument(`${applicant.id}/id1.pdf`);
        const visibleTo = async (who: TestUser | "anon") => {
          await h.actAs(who);
          return (
            await h.query("select name from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET])
          ).rowCount;
        };
        expect(await visibleTo(applicant)).toBe(1);
        expect(await visibleTo(admin)).toBe(1);
        expect(await visibleTo(otherApplicant)).toBe(0);
        expect(await visibleTo(vendorOwner)).toBe(0);
        expect(await visibleTo("anon")).toBe(0);
      });
    });

    it("blocks visitors from uploading, replacing or deleting documents", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putDocument(`${applicant.id}/id1.pdf`);
        await h.actAs("anon");
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ($1, $2)",
          [VENDOR_DOCUMENT_BUCKET, `${applicant.id}/id2.pdf`],
          RLS_DENIED,
        );
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(0);
        expect(
          (
            await h.query("update storage.objects set name = 'x/y.pdf' where bucket_id = $1", [
              VENDOR_DOCUMENT_BUCKET,
            ])
          ).rowCount,
        ).toBe(0);
      });
    });

    it("lets only the owner delete their document; admins can read but not change it", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putDocument(`${applicant.id}/id1.pdf`);

        await h.actAs(otherApplicant);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(0);
        await h.actAs(admin);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(0);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ($1, $2)",
          [VENDOR_DOCUMENT_BUCKET, `${applicant.id}/from-admin.pdf`],
          RLS_DENIED,
        );

        await h.actAs(applicant);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(1);
      });
    });

    it("keeps vendor documents out of the product-images policies and the other way round", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putDocument(`${vendorOwner.id}/id1.pdf`);
        await h.actAs(vendorOwner);
        // A vendor's product-image folder rule does not open the documents bucket to anyone else's files.
        expect(
          (await h.query("select 1 from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(1);
        await h.actAs(otherVendorOwner);
        expect(
          (await h.query("select 1 from storage.objects where bucket_id = $1", [VENDOR_DOCUMENT_BUCKET]))
            .rowCount,
        ).toBe(0);
      });
    });
  });

  describe("product-images bucket", () => {
    it("lets a vendor upload only into <their vendor id>/<their own product id>/", async () => {
      await h.scenario(async () => {
        await h.actAs(vendorOwner);
        expect((await putImage(`${vendorId}/${productId}/a.webp`)).rowCount).toBe(1);

        const denied = [
          `${otherVendorId}/${otherProductId}/a.webp`, // another vendor's folder
          `${vendorId}/${otherProductId}/a.webp`, // own folder, someone else's product id
          `${vendorId}/00000000-0000-4000-8000-000000000000/a.webp`, // a product that does not exist
          `${vendorId}/a.webp`, // too shallow
          `${vendorId}/${productId}/extra/a.webp`, // too deep
          "a.webp",
        ];
        for (const name of denied) {
          await h.expectError(
            "insert into storage.objects (bucket_id, name) values ($1, $2)",
            [PRODUCT_IMAGE_BUCKET, name],
            RLS_DENIED,
          );
        }
      });
    });

    it("blocks buyers, pending applicants and visitors from uploading", async () => {
      await h.scenario(async () => {
        for (const who of [applicant, "anon"] as const) {
          await h.actAs(who);
          await h.expectError(
            "insert into storage.objects (bucket_id, name) values ($1, $2)",
            [PRODUCT_IMAGE_BUCKET, `${vendorId}/${productId}/a.webp`],
            /row-level security|permission denied/,
          );
        }
      });
    });

    it("lets the owning vendor delete their photos, and an admin remove any photo, but nobody else", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putImage(`${vendorId}/${productId}/a.webp`);
        await putImage(`${otherVendorId}/${otherProductId}/b.webp`);

        await h.actAs(applicant);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [PRODUCT_IMAGE_BUCKET]))
            .rowCount,
        ).toBe(0);

        await h.actAs(vendorOwner);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [PRODUCT_IMAGE_BUCKET]))
            .rowCount,
        ).toBe(1);

        await h.actAs(admin);
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [PRODUCT_IMAGE_BUCKET]))
            .rowCount,
        ).toBe(1);
      });
    });

    it("does not let a suspended vendor upload or delete photos", async () => {
      await h.scenario(async () => {
        await h.asServer();
        await putImage(`${vendorId}/${productId}/a.webp`);
        await h.actAs(admin);
        await h.query("select public.suspend_vendor($1, 'Selling counterfeit goods')", [vendorId]);

        await h.actAs(vendorOwner);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ($1, $2)",
          [PRODUCT_IMAGE_BUCKET, `${vendorId}/${productId}/b.webp`],
          /row-level security|permission denied/,
        );
        expect(
          (await h.query("delete from storage.objects where bucket_id = $1", [PRODUCT_IMAGE_BUCKET]))
            .rowCount,
        ).toBe(0);
      });
    });
  });
});
