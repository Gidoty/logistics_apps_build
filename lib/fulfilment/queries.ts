import "server-only";
import { createClient } from "@/lib/supabase/server";
import { INSPECTION_BUCKET } from "./proof";

/** Reads for proof, disputes and shipments. They run as the signed-in user, so row security decides what comes back. */

const SIGNED_URL_SECONDS = 60 * 60;

export type InspectionProof = {
  id: string;
  created_at: string;
  notes: string | null;
  serial_or_imei: string | null;
  buyer_decision: string | null;
  decided_at: string | null;
  auto_approved: boolean;
  media: { id: string; type: string; url: string }[];
};

/** The newest inspection for an order, with one-hour links to its files. */
export async function getInspectionProof(orderId: string): Promise<InspectionProof | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspections")
    .select(
      "id, created_at, notes, serial_or_imei, buyer_decision, decided_at, auto_approved, media:inspection_media(id, storage_path, media_type)",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the inspection: ${error.message}`);
  if (!data) return null;

  const paths = data.media.map((item) => item.storage_path);
  const signed = paths.length
    ? await supabase.storage.from(INSPECTION_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [], error: null };
  if (signed.error) throw new Error(`Could not open the proof files: ${signed.error.message}`);
  const urlByPath = new Map((signed.data ?? []).map((entry) => [entry.path, entry.signedUrl]));

  return {
    id: data.id,
    created_at: data.created_at,
    notes: data.notes,
    serial_or_imei: data.serial_or_imei,
    buyer_decision: data.buyer_decision,
    decided_at: data.decided_at,
    auto_approved: data.auto_approved,
    media: data.media
      .map((item) => ({ id: item.id, type: item.media_type, url: urlByPath.get(item.storage_path) ?? "" }))
      .filter((item) => item.url !== ""),
  };
}

export async function listDisputesForOrder(orderId: string) {
  const { data, error } = await (
    await createClient()
  )
    .from("disputes")
    .select("id, status, reason, resolution_note, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load disputes: ${error.message}`);
  return data;
}

export type ShippableOrder = { id: string; label: string };

/** Orders whose inspection was approved, that are not on a shipment yet and are not flagged. */
export async function listShippableOrders(): Promise<ShippableOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, created_at, items:order_items(description), shipment_orders(shipment_id)")
    .eq("status", "inspection_approved")
    .filter("review_flags", "eq", "{}")
    .order("created_at")
    .limit(200);
  if (error) throw new Error(`Could not load orders: ${error.message}`);
  return data
    .filter((order) => order.shipment_orders.length === 0)
    .map((order) => ({
      id: order.id,
      label: `${order.items[0]?.description ?? "Order"} (${order.id.slice(0, 8)})`,
    }));
}

export async function listShipments() {
  const { data, error } = await (
    await createClient()
  )
    .from("shipments")
    .select(
      `id, logistics_partner, tracking_number, status, origin_country, destination_country, created_at,
       orders:shipment_orders(order:orders(id, status, items:order_items(description))),
       events:shipment_events(id, status, note, location, occurred_at)`,
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load shipments: ${error.message}`);
  return data;
}
