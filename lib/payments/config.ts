import "server-only";
import { z } from "zod";

const schema = z.object({
  PAYSTACK_SECRET_KEY: z
    .string()
    .min(10)
    .startsWith("sk_", "PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_...)"),
  // Only tests point this elsewhere (a fake Paystack). In production it stays the default.
  PAYSTACK_API_BASE: z.url().default("https://api.paystack.co"),
});

export type PaystackConfig = { secretKey: string; apiBase: string };

/** Paystack settings from the environment. Throws a clear error when the secret key is missing. */
export function getPaystackConfig(): PaystackConfig {
  const parsed = schema.safeParse({
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    PAYSTACK_API_BASE: process.env.PAYSTACK_API_BASE || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Paystack is not set up: ${parsed.error.issues.map((i) => i.message).join("; ")}. See .env.example.`,
    );
  }
  return {
    secretKey: parsed.data.PAYSTACK_SECRET_KEY,
    apiBase: parsed.data.PAYSTACK_API_BASE.replace(/\/+$/, ""),
  };
}
