"use server";

import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { orderIdSchema } from "@/lib/orders/schemas";
import { refreshOrderPages } from "@/lib/orders/refresh";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  INSPECTION_BUCKET,
  INSPECTION_VIDEO_MAX_BYTES,
  INSPECTION_VIDEO_MAX_SECONDS,
  parseVideoDurationSeconds,
  validateProofCounts,
} from "./proof";
import { ensureDeliveryCode } from "@/lib/delivery/issue";
import { refreshShipmentPages } from "./refresh";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const FAILED = "That did not work. Please try again.";

function failed(error: { code?: string; message: string }, fallback = FAILED): ActionResult {
  return { ok: false, message: userFacingDbError(error, fallback) };
}

const textSchema = (max: number) => z.string().trim().max(max);

/** Admin (any paid order) or the order's own vendor (catalog orders) marks the item as bought. */
export async function markPurchased(orderId: string, supplierReference: string): Promise<ActionResult> {
  await requireUser("/vendor/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const reference = textSchema(200).safeParse(supplierReference);
  if (!reference.success) return { ok: false, message: "The reference is too long." };
  const { error } = await (
    await createClient()
  ).rpc("mark_purchased", { _order_id: orderId, _supplier_reference: reference.data || undefined });
  if (error) return failed(error, "We could not mark the order as purchased.");
  refreshOrderPages(orderId);
  return { ok: true, message: "Marked as purchased. Next, upload the inspection proof." };
}

const proofSchema = z.object({
  orderId: orderIdSchema,
  media: z.array(z.object({ path: z.string().max(200), type: z.enum(["image", "video"]) })).max(7),
  serial: textSchema(100),
  notes: textSchema(5000),
});

/**
 * Saves the proof the browser already uploaded. The video length is read here
 * from the file in storage, because a browser can claim any length. The
 * database checks who is acting, the files, and the counts.
 */
export async function submitInspectionProof(input: unknown): Promise<ActionResult> {
  const user = await requireUser("/vendor/orders");
  const parsed = proofSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the proof details and try again." };
  const { orderId, media, serial, notes } = parsed.data;

  const photos = media.filter((item) => item.type === "image").length;
  const videos = media.length - photos;
  const countProblem = validateProofCounts(photos, videos);
  if (countProblem) return { ok: false, message: countProblem };
  if (serial.length < 2) return { ok: false, message: "Enter the serial number or IMEI (or N/A)." };

  // Only the order's vendor or an admin may reach this far; the database decides.
  const supabase = await createClient();
  const { data: visible } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!visible) return { ok: false, message: "Order not found." };

  const service = createServiceClient();
  let videoSeconds: number | null = null;
  const video = media.find((item) => item.type === "video");
  if (video) {
    if (!video.path.startsWith(`${orderId}/`))
      return { ok: false, message: "A file is not in this order's folder." };
    const file = await service.storage.from(INSPECTION_BUCKET).download(video.path);
    if (file.error || !file.data)
      return { ok: false, message: "The video was not uploaded. Please try again." };
    if (file.data.size > INSPECTION_VIDEO_MAX_BYTES)
      return { ok: false, message: "The video must be 20 MB or smaller." };
    videoSeconds = parseVideoDurationSeconds(new Uint8Array(await file.data.arrayBuffer()));
    if (videoSeconds === null)
      return { ok: false, message: "We could not read that video. Use an MP4 or MOV file." };
    if (videoSeconds > INSPECTION_VIDEO_MAX_SECONDS)
      return {
        ok: false,
        message: `The video is ${videoSeconds} seconds. The limit is ${INSPECTION_VIDEO_MAX_SECONDS}.`,
      };
  }

  const { error } = await service.rpc("submit_inspection", {
    _order_id: orderId,
    _actor: user.id,
    _media: media,
    _serial: serial,
    _notes: notes || undefined,
    _video_seconds: videoSeconds ?? undefined,
  });
  if (error) return failed(error, "We could not save the proof. Please try again.");
  refreshOrderPages(orderId);
  return { ok: true, message: "Proof sent. The buyer can now review it." };
}

/** The buyer approves the proof, or disputes it with a reason. */
export async function decideInspection(
  orderId: string,
  decision: "approved" | "disputed",
  reason: string,
): Promise<ActionResult> {
  await requireUser("/account/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  if (decision !== "approved" && decision !== "disputed") return { ok: false, message: FAILED };
  const text = textSchema(5000).safeParse(reason);
  if (!text.success) return { ok: false, message: "That reason is too long." };
  const { error } = await (
    await createClient()
  ).rpc("decide_inspection", { _order_id: orderId, _decision: decision, _reason: text.data || undefined });
  if (error) return failed(error);
  refreshOrderPages(orderId);
  return {
    ok: true,
    message:
      decision === "approved"
        ? "Thank you. The order will be shipped."
        : "We opened a dispute. Our team will review it and contact you.",
  };
}

/** Admin decides a dispute for the buyer or the seller, with a note. */
export async function resolveDispute(
  orderId: string,
  disputeId: string,
  outcome: "buyer" | "seller",
  note: string,
): Promise<ActionResult> {
  await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success || !z.uuid().safeParse(disputeId).success)
    return { ok: false, message: "Dispute not found." };
  if (outcome !== "buyer" && outcome !== "seller") return { ok: false, message: FAILED };
  const text = textSchema(5000).safeParse(note);
  if (!text.success) return { ok: false, message: "That note is too long." };
  const { error } = await (
    await createClient()
  ).rpc("resolve_dispute", { _dispute_id: disputeId, _outcome: outcome, _note: text.data });
  if (error) return failed(error);
  refreshOrderPages(orderId);
  return {
    ok: true,
    message:
      outcome === "buyer"
        ? "Decided for the buyer. Record the refund to close the order."
        : "Decided for the seller. The order continues.",
  };
}

const COUNTRY = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code.");

const shipmentSchema = z.object({
  partner: textSchema(80).min(1, "Enter the shipping partner."),
  trackingNumber: textSchema(100),
  origin: COUNTRY,
  destination: COUNTRY,
  orderIds: z.array(orderIdSchema).max(100),
});

export async function createShipment(input: unknown): Promise<ActionResult & { shipmentId?: string }> {
  await requireAdmin("/admin/shipments");
  const parsed = shipmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? FAILED };
  const { data, error } = await (
    await createClient()
  ).rpc("create_shipment", {
    _partner: parsed.data.partner,
    _tracking_number: parsed.data.trackingNumber,
    _origin: parsed.data.origin,
    _destination: parsed.data.destination,
    _order_ids: parsed.data.orderIds,
  });
  if (error) return failed(error);
  refreshShipmentPages(parsed.data.orderIds);
  return { ok: true, message: "Shipment created.", shipmentId: data };
}

export async function attachOrderToShipment(shipmentId: string, orderId: string): Promise<ActionResult> {
  await requireAdmin("/admin/shipments");
  if (!z.uuid().safeParse(shipmentId).success || !orderIdSchema.safeParse(orderId).success)
    return { ok: false, message: "Shipment or order not found." };
  const { error } = await (
    await createClient()
  ).rpc("attach_order_to_shipment", { _shipment_id: shipmentId, _order_id: orderId });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That order is already on a shipment." };
    return failed(error);
  }
  refreshShipmentPages([orderId]);
  return { ok: true, message: "Order added to the shipment." };
}

const eventSchema = z.object({
  shipmentId: z.uuid(),
  status: z.enum(["shipped", "in_transit", "arrived_destination", "customs_cleared", "out_for_delivery"]),
  note: textSchema(500),
  location: textSchema(120),
});

/** One event moves every attached order that can take that step. Orders that cannot are reported back. */
export async function addShipmentEvent(input: unknown): Promise<ActionResult> {
  await requireAdmin("/admin/shipments");
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a shipment step." };
  const { data, error } = await (
    await createClient()
  ).rpc("add_shipment_event", {
    _shipment_id: parsed.data.shipmentId,
    _status: parsed.data.status,
    _note: parsed.data.note || undefined,
    _location: parsed.data.location || undefined,
  });
  if (error) return failed(error);
  const result = data as { moved: string[]; skipped: unknown[] };
  // Each order that is now out for delivery gets its delivery code. If this fails,
  // the code is made the next time the buyer or an admin opens the order.
  if (parsed.data.status === "out_for_delivery") {
    await Promise.all(result.moved.map((id) => ensureDeliveryCode(id).catch(() => undefined)));
  }
  refreshShipmentPages(result.moved);
  const skipped = result.skipped.length;
  return {
    ok: true,
    message: `${result.moved.length} order(s) moved.${skipped > 0 ? ` ${skipped} skipped because they cannot take this step (for example a dispute).` : ""}`,
  };
}
