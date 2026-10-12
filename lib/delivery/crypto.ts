import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";

/**
 * The 6-digit delivery code is stored twice, never in clear text:
 *   hash        HMAC-SHA256 over "<tracking token>:<code>", checked when the recipient enters the code
 *   ciphertext  AES-256-GCM, decrypted only for the buyer's own order page
 * Both keys come from one server secret, DELIVERY_CODE_KEY, split with HKDF.
 * A leaked database dump alone cannot be turned back into codes; a 6-digit
 * code is guessable only with the key.
 */

const KEY_ENV = "DELIVERY_CODE_KEY";

function masterKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length < 32) {
    throw new Error(
      `${KEY_ENV} is not set. Use a long random value, for example \`openssl rand -base64 32\`. See .env.example.`,
    );
  }
  return Buffer.from(raw, "utf8");
}

function subKey(label: "hash" | "encrypt"): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `mapk-delivery-code:${label}`, 32));
}

/** Six digits from a secure random source, with leading zeros kept. */
export function generateDeliveryCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function isWellFormedCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** Hex HMAC the database compares with. Bound to the order's tracking token, so a hash from one order never fits another. */
export function hashDeliveryCode(trackingToken: string, code: string): string {
  return createHmac("sha256", subKey("hash")).update(`${trackingToken}:${code}`, "utf8").digest("hex");
}

export function encryptDeliveryCode(code: string, trackingToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subKey("encrypt"), iv);
  cipher.setAAD(Buffer.from(trackingToken, "utf8"));
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

/** Returns the code, or null if the value was changed or belongs to another order. */
export function decryptDeliveryCode(stored: string, trackingToken: string): string | null {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", subKey("encrypt"), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(trackingToken, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const code = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString(
      "utf8",
    );
    return isWellFormedCode(code) ? code : null;
  } catch {
    return null;
  }
}
