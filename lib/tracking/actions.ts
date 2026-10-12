"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { hashDeliveryCode, isWellFormedCode } from "@/lib/delivery/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { TRACKING_TOKEN_PATTERN } from "./data";
import { allowCodeEntry } from "./throttle";

export type CodeResult =
  { ok: true; message: string } | { ok: false; message: string; locked?: boolean; attemptsLeft?: number };

/** The recipient enters the 6-digit code at the door. The database counts tries, locks after 5 and delivers on a match. */
export async function confirmDeliveryCode(token: string, code: string): Promise<CodeResult> {
  const cleaned = code.replace(/\s+/g, "");
  if (!TRACKING_TOKEN_PATTERN.test(token)) return { ok: false, message: "This tracking link is not valid." };
  if (!isWellFormedCode(cleaned)) return { ok: false, message: "Enter the 6 digits of the delivery code." };
  if (!(await allowCodeEntry(await headers()))) {
    return { ok: false, message: "Too many tries from this device. Wait 10 minutes and try again." };
  }

  const { data, error } = await createServiceClient().rpc("confirm_delivery_with_code", {
    _token: token,
    _hash: hashDeliveryCode(token, cleaned),
  });
  if (error) {
    console.error("Delivery confirmation failed", error.message);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  const answer = data as { result: string; attempts_left?: number };
  revalidatePath(`/t/${token}`);
  switch (answer.result) {
    case "delivered":
      return { ok: true, message: "Thank you. Delivery is confirmed." };
    case "wrong":
      return {
        ok: false,
        message: `That code is not right. ${answer.attempts_left} ${answer.attempts_left === 1 ? "try" : "tries"} left.`,
        attemptsLeft: answer.attempts_left,
      };
    case "locked":
      return {
        ok: false,
        locked: true,
        message: "Too many wrong codes. The code is locked. Contact the sender or our support to unlock it.",
      };
    default:
      return { ok: false, message: "This order is not ready for a delivery code." };
  }
}
