import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack signs each webhook with HMAC SHA-512 of the exact raw request body,
 * using the account's secret key, and sends it in x-paystack-signature. The
 * body must be the bytes as received: parsing and re-serializing changes them.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature.trim(), "hex");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** A signature for a body, for tests and the local webhook script. */
export function signPaystackBody(rawBody: string, secret: string): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}
