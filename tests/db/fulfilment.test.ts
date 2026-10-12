/**
 * Batch 5, step 2: purchase, inspection proof, buyer decision, disputes and
 * manual shipments, tested as real database roles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, DbHarness, PERMISSION_DENIED, RLS_DENIED, type TestUser } from "./harness";

describe.skipIf(!DATABASE_URL)("database: fulfilment", () => {
  const h = new DbHarness();
  let admin: TestUser;
  let buyer: TestUser;
  let other: TestUser;
  let vendorOwner: TestUser;
  let otherVendorOwner: TestUser;
  let vendorId: string;
  let recipient: string;
  let cnNg: string;

  const LINES = [{ type: "item_price", label: "Item price", amount_minor: 15_000_000 }];

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

  /** A paid catalog order. */
  async function paidOrder(): Promise<string> {
    await h.asServer();
    const productId = (
      await one(
        `insert into public.products (vendor_id, title, description, category, price_minor, currency, corridor_id, stock, weight_grams, active)
         values ($1, 'Test phone', 'A phone with enough description text.', 'phones', 15000000, 'NGN', $2, 5, 300, true) returning id`,
        [vendorId, cnNg],
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
        "select public.create_payment($1, $2, 15000000, 'NGN', 15000000, '{\"method\":\"same_currency\"}'::jsonb) as id",
        [orderId, buyer.id],
      )
    ).id as string;
    await h.query("select public.apply_successful_payment($1, null, '{\"ok\":true}'::jsonb)", [paymentId]);
    return orderId;
  }

  async function statusOf(orderId: string) {
    await h.asServer();
    return (await one("select status::text as s from public.orders where id = $1", [orderId])).s as string;
  }

  async function putObjects(orderId: string, names: string[], size = 1000) {
    await h.asServer();
    for (const n of names) {
      await h.query(
        "insert into storage.objects (bucket_id, name, metadata) values ('inspection-media', $1, $2::jsonb)",
        [`${orderId}/${n}`, JSON.stringify({ size })],
      );
    }
  }

  const photos = (orderId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `${orderId}/p${i}.jpg`, type: "image" }));

  async function submit(
    orderId: string,
    actor: TestUser,
    media: unknown[],
    over: { serial?: string; seconds?: number | null } = {},
  ) {
    await h.asServiceRole();
    return (
      await one("select public.submit_inspection($1, $2, $3::jsonb, $4, 'Looks fine', $5) as id", [
        orderId,
        actor.id,
        JSON.stringify(media),
        over.serial ?? "IMEI 356938035643809",
        over.seconds ?? null,
      ])
    ).id as string;
  }

  async function inspectedOrder(): Promise<string> {
    const orderId = await paidOrder();
    await h.actAs(vendorOwner);
    await h.query("select public.mark_purchased($1, 'SUP-1')", [orderId]);
    await putObjects(orderId, ["p0.jpg", "p1.jpg"]);
    await submit(orderId, vendorOwner, photos(orderId, 2));
    return orderId;
  }

  async function approvedOrder(): Promise<string> {
    const orderId = await inspectedOrder();
    await h.actAs(buyer);
    await h.query("select public.decide_inspection($1, 'approved')", [orderId]);
    return orderId;
  }

  describe("mark_purchased", () => {
    it("lets the order's vendor and admins mark a paid order, nobody else", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        for (const who of [buyer, other, otherVendorOwner]) {
          await h.actAs(who);
          await h.expectError("select public.mark_purchased($1)", [orderId], /Order not found/);
        }
        await h.actAs("anon");
        await h.expectError("select public.mark_purchased($1)", [orderId], PERMISSION_DENIED);
        await h.actAs(vendorOwner);
        await h.query("select public.mark_purchased($1, '  SUP-9  ')", [orderId]);
        expect(await statusOf(orderId)).toBe("purchased");
        const row = await one("select supplier_reference, purchased_at from public.orders where id = $1", [
          orderId,
        ]);
        expect(row.supplier_reference).toBe("SUP-9");
        expect(row.purchased_at).not.toBeNull();
      });
    });

    it("refuses an order that is not paid, and one flagged for review", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.asServer();
        await h.query("update public.orders set review_flags = array['stock_unavailable'] where id = $1", [
          orderId,
        ]);
        await h.actAs(admin);
        await h.expectError("select public.mark_purchased($1)", [orderId], /needs an admin's review/);
      });
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(admin);
        await h.query("select public.mark_purchased($1)", [orderId]);
        await h.expectError("select public.mark_purchased($1)", [orderId], /Only a paid order/);
      });
    });
  });

  describe("submit_inspection", () => {
    it("is for the server only", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(vendorOwner);
        await h.expectError(
          "select public.submit_inspection($1, $2, '[]'::jsonb, 'x1')",
          [orderId, vendorOwner.id],
          PERMISSION_DENIED,
        );
      });
    });

    it("takes 2 to 6 photos and moves the order to inspection_pending", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(vendorOwner);
        await h.query("select public.mark_purchased($1)", [orderId]);
        await putObjects(orderId, ["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg", "p6.jpg"]);

        await h.asServiceRole();
        await h.expectError(
          "select public.submit_inspection($1, $2, $3::jsonb, 'IMEI 123')",
          [orderId, vendorOwner.id, JSON.stringify(photos(orderId, 1))],
          /2 to 6 photos/,
        );
        await h.expectError(
          "select public.submit_inspection($1, $2, $3::jsonb, 'IMEI 123')",
          [orderId, vendorOwner.id, JSON.stringify(photos(orderId, 7))],
          /2 to 6 photos/,
        );
        await submit(orderId, vendorOwner, photos(orderId, 6));
        expect(await statusOf(orderId)).toBe("inspection_pending");
        const media = await one("select count(*)::int as n from public.inspection_media");
        expect(media.n).toBe(6);
      });
    });

    it("needs the serial number, an uploaded file, and the order's own folder", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(admin);
        await h.query("select public.mark_purchased($1)", [orderId]);
        await putObjects(orderId, ["p0.jpg", "p1.jpg"]);
        await h.asServiceRole();
        const args = (media: unknown, serial = "IMEI 123") => [
          orderId,
          admin.id,
          JSON.stringify(media),
          serial,
        ];
        const sql = "select public.submit_inspection($1, $2, $3::jsonb, $4)";
        await h.expectError(sql, args(photos(orderId, 2), " "), /serial number or IMEI/);
        await h.expectError(
          sql,
          args([...photos(orderId, 1), { path: `${orderId}/missing.jpg`, type: "image" }]),
          /not uploaded/,
        );
        await h.expectError(
          sql,
          args([...photos(orderId, 1), { path: `${other.id}/p1.jpg`, type: "image" }]),
          /not in this order's folder/,
        );
        await h.expectError(
          sql,
          args([...photos(orderId, 1), { path: `${orderId}/../p1.jpg`, type: "image" }]),
          /not in this order's folder/,
        );
      });
    });

    it("limits the video to 30 seconds and 20 MB, one video, MP4 or MOV", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(admin);
        await h.query("select public.mark_purchased($1)", [orderId]);
        await putObjects(orderId, ["p0.jpg", "p1.jpg"]);
        await putObjects(orderId, ["v.mp4"], 5_000_000);
        await putObjects(orderId, ["big.mp4"], 25_000_000);
        await putObjects(orderId, ["v2.mov"], 5_000_000);
        await putObjects(orderId, ["v.avi"], 5_000_000);
        await h.asServiceRole();
        const sql = "select public.submit_inspection($1, $2, $3::jsonb, 'IMEI 123', null, $4)";
        const vid = (name: string) => ({ path: `${orderId}/${name}`, type: "video" });
        await h.expectError(
          sql,
          [orderId, admin.id, JSON.stringify([...photos(orderId, 2), vid("v.mp4")]), 31],
          /30 seconds/,
        );
        await h.expectError(
          sql,
          [orderId, admin.id, JSON.stringify([...photos(orderId, 2), vid("v.mp4")]), null],
          /30 seconds/,
        );
        await h.expectError(
          sql,
          [orderId, admin.id, JSON.stringify([...photos(orderId, 2), vid("big.mp4")]), 10],
          /over 20 MB/,
        );
        await h.expectError(
          sql,
          [orderId, admin.id, JSON.stringify([...photos(orderId, 2), vid("v.avi")]), 10],
          /MP4 or MOV/,
        );
        await h.expectError(
          sql,
          [orderId, admin.id, JSON.stringify([...photos(orderId, 2), vid("v.mp4"), vid("v2.mov")]), 10],
          /at most one video/,
        );
        await h.query(sql, [
          orderId,
          admin.id,
          JSON.stringify([...photos(orderId, 2), vid("v.mov".replace("v.mov", "v2.mov"))]),
          30,
        ]);
        expect(await statusOf(orderId)).toBe("inspection_pending");
      });
    });

    it("refuses other vendors, buyers and orders that are not purchased", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await putObjects(orderId, ["p0.jpg", "p1.jpg"]);
        await h.asServiceRole();
        const sql = "select public.submit_inspection($1, $2, $3::jsonb, 'IMEI 123')";
        await h.expectError(
          sql,
          [orderId, vendorOwner.id, JSON.stringify(photos(orderId, 2))],
          /Proof can be added once/,
        );
        await h.actAs(admin);
        await h.query("select public.mark_purchased($1)", [orderId]);
        await h.asServiceRole();
        for (const who of [otherVendorOwner, buyer]) {
          await h.expectError(sql, [orderId, who.id, JSON.stringify(photos(orderId, 2))], /Order not found/);
        }
      });
    });
  });

  describe("proof files in storage", () => {
    const put = (name: string) =>
      h.query("insert into storage.objects (bucket_id, name) values ('inspection-media', $1)", [name]);

    it("lets the order's vendor upload into the order folder while it is being prepared, and nobody else", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(vendorOwner);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
          [`${orderId}/a.jpg`],
          RLS_DENIED,
        );
        await h.query("select public.mark_purchased($1)", [orderId]);
        await put(`${orderId}/a.jpg`);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
          [`${orderId}/sub/a.jpg`],
          RLS_DENIED,
        );
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
          [`not-a-uuid/a.jpg`],
          RLS_DENIED,
        );
        for (const who of [otherVendorOwner, buyer, other]) {
          await h.actAs(who);
          await h.expectError(
            "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
            [`${orderId}/b.jpg`],
            RLS_DENIED,
          );
        }
        await h.actAs("anon");
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
          [`${orderId}/b.jpg`],
          RLS_DENIED,
        );
      });
    });

    it("caps a folder at 12 files", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await h.actAs(vendorOwner);
        await h.query("select public.mark_purchased($1)", [orderId]);
        for (let i = 0; i < 12; i++) await put(`${orderId}/f${i}.jpg`);
        await h.expectError(
          "insert into storage.objects (bucket_id, name) values ('inspection-media', $1)",
          [`${orderId}/f12.jpg`],
          RLS_DENIED,
        );
      });
    });

    it("lets the buyer, the vendor and admins read the files, and nobody else", async () => {
      await h.scenario(async () => {
        const orderId = await paidOrder();
        await putObjects(orderId, ["a.jpg"]);
        const count = async (who: TestUser | "anon") => {
          await h.actAs(who);
          return (
            await one("select count(*)::int as n from storage.objects where bucket_id = 'inspection-media'")
          ).n;
        };
        expect(await count(buyer)).toBe(1);
        expect(await count(vendorOwner)).toBe(1);
        expect(await count(admin)).toBe(1);
        expect(await count(other)).toBe(0);
        expect(await count(otherVendorOwner)).toBe(0);
        expect(await count("anon")).toBe(0);
      });
    });
  });

  describe("decide_inspection", () => {
    it("lets the buyer approve; others cannot decide", async () => {
      await h.scenario(async () => {
        const orderId = await inspectedOrder();
        for (const who of [other, vendorOwner, admin]) {
          await h.actAs(who);
          await h.expectError(
            "select public.decide_inspection($1, 'approved')",
            [orderId],
            /Order not found/,
          );
        }
        await h.actAs(buyer);
        await h.query("select public.decide_inspection($1, 'approved')", [orderId]);
        expect(await statusOf(orderId)).toBe("inspection_approved");
        await h.actAs(buyer);
        const insp = await one(
          "select buyer_decision, auto_approved from public.inspections where order_id = $1",
          [orderId],
        );
        expect(insp).toEqual({ buyer_decision: "approved", auto_approved: false });
        await h.expectError("select public.decide_inspection($1, 'approved')", [orderId], /no proof waiting/);
      });
    });

    it("needs a reason to dispute, then creates the dispute row", async () => {
      await h.scenario(async () => {
        const orderId = await inspectedOrder();
        await h.actAs(buyer);
        await h.expectError(
          "select public.decide_inspection($1, 'disputed', 'bad')",
          [orderId],
          /at least 10 characters/,
        );
        await h.query(
          "select public.decide_inspection($1, 'disputed', 'The serial number does not match the box.')",
          [orderId],
        );
        expect(await statusOf(orderId)).toBe("disputed");
        const d = await one(
          "select status::text as status, previous_status::text as prev, raised_by from public.disputes where order_id = $1",
          [orderId],
        );
        expect(d).toEqual({ status: "open", prev: "inspection_pending", raised_by: buyer.id });
      });
    });
  });

  describe("auto_approve_inspections", () => {
    it("approves after 48 hours of silence only, and records it", async () => {
      await h.scenario(async () => {
        const fresh = await inspectedOrder();
        const old = await inspectedOrder();
        await h.asServer();
        await h.query(
          "update public.inspections set created_at = now() - interval '49 hours' where order_id = $1",
          [old],
        );
        await h.query(
          "update public.inspections set created_at = now() - interval '47 hours' where order_id = $1",
          [fresh],
        );
        await h.actAs(buyer);
        await h.expectError("select public.auto_approve_inspections()", [], PERMISSION_DENIED);
        await h.asServiceRole();
        expect((await one("select public.auto_approve_inspections() as n")).n).toBe(1);
        expect(await statusOf(old)).toBe("inspection_approved");
        expect(await statusOf(fresh)).toBe("inspection_pending");
        const insp = await one("select auto_approved from public.inspections where order_id = $1", [old]);
        expect(insp.auto_approved).toBe(true);
        expect((await one("select public.auto_approve_inspections() as n")).n).toBe(0);
      });
    });
  });

  describe("resolve_dispute", () => {
    async function disputed() {
      const orderId = await inspectedOrder();
      await h.actAs(buyer);
      await h.query(
        "select public.decide_inspection($1, 'disputed', 'The serial number does not match the box.')",
        [orderId],
      );
      await h.asServer();
      const id = (await one("select id from public.disputes where order_id = $1", [orderId])).id as string;
      return { orderId, id };
    }

    it("is for admins, and needs a note", async () => {
      await h.scenario(async () => {
        const { id } = await disputed();
        for (const who of [buyer, vendorOwner]) {
          await h.actAs(who);
          await h.expectError(
            "select public.resolve_dispute($1, 'buyer', 'Refund them.')",
            [id],
            /Only admins/,
          );
        }
        await h.actAs(admin);
        await h.expectError(
          "select public.resolve_dispute($1, 'buyer', 'no')",
          [id],
          /at least 5 characters/,
        );
        await h.expectError(
          "select public.resolve_dispute($1, 'nobody', 'A fine note')",
          [id],
          /who the dispute/,
        );
      });
    });

    it("keeps the order disputed when decided for the buyer", async () => {
      await h.scenario(async () => {
        const { orderId, id } = await disputed();
        await h.actAs(admin);
        await h.query("select public.resolve_dispute($1, 'buyer', 'Serial mismatch confirmed.')", [id]);
        expect(await statusOf(orderId)).toBe("disputed");
        const d = await one(
          "select status::text as status, resolution_note from public.disputes where id = $1",
          [id],
        );
        expect(d).toEqual({ status: "resolved_buyer", resolution_note: "Serial mismatch confirmed." });
        await h.actAs(admin);
        await h.expectError(
          "select public.resolve_dispute($1, 'seller', 'Changed my mind')",
          [id],
          /already resolved/,
        );
      });
    });

    it("resumes the order after inspection when decided for the seller", async () => {
      await h.scenario(async () => {
        const { orderId, id } = await disputed();
        await h.actAs(admin);
        await h.query("select public.resolve_dispute($1, 'seller', 'The serial matches the box.')", [id]);
        expect(await statusOf(orderId)).toBe("inspection_approved");
        const d = await one("select status::text as status from public.disputes where id = $1", [id]);
        expect(d.status).toBe("resolved_vendor");
      });
    });
  });

  describe("shipments", () => {
    it("is for admins only, including reads of nothing else", async () => {
      await h.scenario(async () => {
        const orderId = await approvedOrder();
        for (const who of [buyer, vendorOwner]) {
          await h.actAs(who);
          await h.expectError(
            "select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[])",
            [[orderId]],
            /Only admins/,
          );
          await h.expectError(
            "insert into public.shipments (logistics_partner, status) values ('x', 'pending')",
            [],
            PERMISSION_DENIED,
          );
        }
      });
    });

    it("attaches only inspected orders, once, before the first event", async () => {
      await h.scenario(async () => {
        const ok = await approvedOrder();
        const early = await inspectedOrder();
        await h.actAs(admin);
        await h.expectError(
          "select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[])",
          [[early]],
          /inspection was approved/,
        );
        const shipmentId = (
          await one("select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[]) as id", [[ok]])
        ).id as string;
        await h.expectError(
          "select public.attach_order_to_shipment($1, $2)",
          [shipmentId, ok],
          /duplicate key|already/,
        );
        const second = await approvedOrder();
        await h.actAs(admin);
        await h.query("select public.add_shipment_event($1, 'shipped')", [shipmentId]);
        await h.expectError(
          "select public.attach_order_to_shipment($1, $2)",
          [shipmentId, second],
          /already started/,
        );
      });
    });

    it("moves attached orders step by step and refuses to go backwards", async () => {
      await h.scenario(async () => {
        const a = await approvedOrder();
        const b = await approvedOrder();
        await h.actAs(admin);
        const id = (
          await one("select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[]) as id", [[a, b]])
        ).id as string;
        const r = (
          await one("select public.add_shipment_event($1, 'shipped', 'Left Shenzhen', 'Shenzhen') as r", [id])
        ).r;
        expect(r.moved).toHaveLength(2);
        expect(await statusOf(a)).toBe("shipped");
        await h.actAs(admin);
        await h.expectError("select public.add_shipment_event($1, 'shipped')", [id], /already at or past/);
        for (const s of ["in_transit", "arrived_destination", "customs_cleared", "out_for_delivery"]) {
          await h.actAs(admin);
          await h.query("select public.add_shipment_event($1, $2)", [id, s]);
          expect(await statusOf(b)).toBe(s);
        }
        await h.actAs(admin);
        await h.expectError("select public.add_shipment_event($1, 'delivered')", [id], /Choose one of/);
        const events = await one(
          "select count(*)::int as n from public.shipment_events where shipment_id = $1",
          [id],
        );
        expect(events.n).toBe(5);
      });
    });

    it("lets a domestic shipment jump straight to out_for_delivery", async () => {
      await h.scenario(async () => {
        const a = await approvedOrder();
        await h.actAs(admin);
        const id = (
          await one("select public.create_shipment('GIG', 'T2', 'NG', 'NG', $1::uuid[]) as id", [[a]])
        ).id as string;
        await h.query("select public.add_shipment_event($1, 'shipped')", [id]);
        await h.query("select public.add_shipment_event($1, 'out_for_delivery')", [id]);
        expect(await statusOf(a)).toBe("out_for_delivery");
      });
    });

    it("skips a disputed order and moves the rest", async () => {
      await h.scenario(async () => {
        const a = await approvedOrder();
        const b = await approvedOrder();
        await h.actAs(admin);
        const id = (
          await one("select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[]) as id", [[a, b]])
        ).id as string;
        await h.query("select public.add_shipment_event($1, 'shipped')", [id]);
        await h.asServer();
        await h.query("select public.transition_order($1, 'disputed', 'test', null)", [a]);
        await h.actAs(admin);
        const r = (await one("select public.add_shipment_event($1, 'in_transit') as r", [id])).r;
        expect(r.moved).toEqual([b]);
        expect(r.skipped).toEqual([{ order_id: a, status: "disputed" }]);
      });
    });

    it("never lets events be changed or deleted", async () => {
      await h.scenario(async () => {
        const a = await approvedOrder();
        await h.actAs(admin);
        const id = (
          await one("select public.create_shipment('DHL', 'T1', 'CN', 'NG', $1::uuid[]) as id", [[a]])
        ).id as string;
        await h.query("select public.add_shipment_event($1, 'shipped')", [id]);
        await h.expectError("update public.shipment_events set note = 'x'", [], PERMISSION_DENIED);
        await h.expectError("delete from public.shipment_events", [], PERMISSION_DENIED);
        await h.asServer();
        await h.expectError("update public.shipment_events set note = 'x'", [], /append-only|cannot be/i);
      });
    });
  });
});
