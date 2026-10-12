import { z } from "zod";
import {
  PaymentProviderError,
  type InitializeInput,
  type InitializedTransaction,
  type PaymentProvider,
  type VerifiedTransaction,
} from "./types";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const initializeResponse = z.object({
  status: z.literal(true),
  data: z.object({ authorization_url: z.url(), reference: z.string().min(1) }),
});

const verifyResponse = z.object({
  status: z.literal(true),
  data: z.object({
    status: z.string(),
    reference: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    paid_at: z.string().nullable().optional(),
  }),
});

/**
 * Paystack over its REST API. The secret key stays on the server. Amounts are
 * in kobo. Initialize returns the hosted payment page; verify is how a
 * payment is confirmed, whatever a webhook or a browser claims.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";

  constructor(
    private readonly secretKey: string,
    private readonly apiBase = "https://api.paystack.co",
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly timeoutMs = 15_000,
  ) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.secretKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const message = z.object({ message: z.string() }).safeParse(json);
        throw new PaymentProviderError(
          `Paystack answered ${response.status}${message.success ? `: ${message.data.message}` : ""}`,
          response.status,
        );
      }
      return json;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError(
        error instanceof Error && error.name === "AbortError"
          ? "Paystack did not answer in time"
          : "Could not reach Paystack",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize(input: InitializeInput): Promise<InitializedTransaction> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new PaymentProviderError("The amount to charge is not valid");
    }
    const json = await this.call("POST", "/transaction/initialize", {
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    const parsed = initializeResponse.safeParse(json);
    if (!parsed.success) throw new PaymentProviderError("Paystack sent an unexpected answer");
    return { authorizationUrl: parsed.data.data.authorization_url, reference: parsed.data.data.reference };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    if (!/^[A-Za-z0-9._=-]{1,100}$/.test(reference)) throw new PaymentProviderError("Not a valid reference");
    const json = await this.call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
    const parsed = verifyResponse.safeParse(json);
    if (!parsed.success) throw new PaymentProviderError("Paystack sent an unexpected answer");
    const d = parsed.data.data;
    return {
      reference: d.reference,
      status: d.status,
      amountMinor: d.amount,
      currency: d.currency.toUpperCase(),
      paidAt: d.paid_at ?? null,
      raw: json,
    };
  }
}
