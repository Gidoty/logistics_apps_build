import { describe, expect, it, vi } from "vitest";
import { quoteTotalInNgn } from "@/lib/payments/amount";
import { PaystackProvider, type FetchLike } from "@/lib/payments/paystack";
import { signPaystackBody, verifyPaystackSignature } from "@/lib/payments/signature";
import { startPayment, type PayableOrder, type StartPaymentDeps } from "@/lib/payments/start";
import { PaymentProviderError, type PaymentProvider, type VerifiedTransaction } from "@/lib/payments/types";
import {
  handlePaystackWebhook,
  MAX_WEBHOOK_BYTES,
  type PaymentRecord,
  type PaymentStore,
} from "@/lib/payments/webhook";
import { calculateLandedCost } from "@/lib/pricing/engine";
import { PricingError } from "@/lib/pricing/errors";
import { chinaInput, fxRows, nigeriaInput, rules } from "./pricing-fixtures";

const SECRET = "sk_test_0123456789abcdef";

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "abc" } });
  it("accepts the HMAC SHA-512 of the raw body", () => {
    expect(verifyPaystackSignature(body, signPaystackBody(body, SECRET), SECRET)).toBe(true);
  });
  it("rejects a wrong key, a changed body, a missing or malformed signature", () => {
    const good = signPaystackBody(body, SECRET);
    expect(verifyPaystackSignature(body, signPaystackBody(body, "sk_test_other_key_00"), SECRET)).toBe(false);
    expect(verifyPaystackSignature(body + " ", good, SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, null, SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "", SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "not hex at all", SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, good.slice(0, 20), SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, good, "")).toBe(false);
  });
  it("depends on the exact bytes, not the meaning of the JSON", () => {
    const spaced = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyPaystackSignature(spaced, signPaystackBody(body, SECRET), SECRET)).toBe(false);
  });
});

describe("PaystackProvider", () => {
  function fakeFetch(answer: unknown, ok = true, status = 200) {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fn: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok, status, json: async () => answer };
    };
    return { fn, calls };
  }

  it("initializes with kobo, our reference, the callback and the bearer key", async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/abc", reference: "pay-1" },
    });
    const provider = new PaystackProvider(SECRET, "https://api.paystack.co", fn);
    const result = await provider.initialize({
      email: "a@b.test",
      amountMinor: 13_772_493,
      currency: "NGN",
      reference: "pay-1",
      callbackUrl: "https://app.test/pay/callback?reference=pay-1",
      metadata: { order_id: "o1" },
    });
    expect(result).toEqual({ authorizationUrl: "https://checkout.paystack.com/abc", reference: "pay-1" });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      email: "a@b.test",
      amount: 13_772_493,
      currency: "NGN",
      reference: "pay-1",
      callback_url: "https://app.test/pay/callback?reference=pay-1",
      metadata: { order_id: "o1" },
    });
  });

  it("refuses a bad amount before calling Paystack", async () => {
    const { fn, calls } = fakeFetch({});
    const provider = new PaystackProvider(SECRET, "https://api.paystack.co", fn);
    for (const amountMinor of [0, -5, 10.5]) {
      await expect(
        provider.initialize({
          email: "a@b.test",
          amountMinor,
          currency: "NGN",
          reference: "r",
          callbackUrl: "https://x.test",
        }),
      ).rejects.toThrow(PaymentProviderError);
    }
    expect(calls).toHaveLength(0);
  });

  it("verifies and reads status, amount, currency and time", async () => {
    const { fn, calls } = fakeFetch({
      status: true,
      data: {
        status: "success",
        reference: "pay-1",
        amount: 500000,
        currency: "ngn",
        paid_at: "2026-10-20T10:00:00.000Z",
      },
    });
    const verified = await new PaystackProvider(SECRET, "https://api.paystack.co", fn).verify("pay-1");
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/pay-1");
    expect(verified).toMatchObject({
      reference: "pay-1",
      status: "success",
      amountMinor: 500000,
      currency: "NGN",
      paidAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("turns HTTP errors, odd answers and network failures into PaymentProviderError", async () => {
    const make = (fn: FetchLike) => new PaystackProvider(SECRET, "https://api.paystack.co", fn);
    await expect(make(fakeFetch({ message: "Invalid key" }, false, 401).fn).verify("pay-1")).rejects.toThrow(
      /401: Invalid key/,
    );
    await expect(make(fakeFetch({ status: true, data: {} }).fn).verify("pay-1")).rejects.toThrow(
      /unexpected/,
    );
    await expect(
      make(async () => {
        throw new TypeError("fetch failed");
      }).verify("pay-1"),
    ).rejects.toThrow(/Could not reach/);
    await expect(make(fakeFetch({}).fn).verify("../../etc")).rejects.toThrow(/valid reference/);
  });
});

describe("quoteTotalInNgn", () => {
  it("leaves a naira quote as it is", () => {
    const result = quoteTotalInNgn(13_772_493, "NGN", null);
    expect(result.amountMinor).toBe(13_772_493);
    expect(result.note.method).toBe("same_currency");
  });

  it("converts a pound quote at the rates frozen in its snapshot", () => {
    // 1 USD = 1500 NGN = 0.8 GBP in the fixtures, so 1 pence = 1875 kobo (GBP 1 = NGN 1,875).
    const quote = calculateLandedCost(nigeriaInput(), rules(), fxRows());
    expect(quote.currency).toBe("GBP");
    expect(quote.total).toBe(9061);
    const charge = quoteTotalInNgn(quote.total, "GBP", quote.snapshot);
    expect(charge.amountMinor).toBe(Math.round((9061 * 1500) / 0.8)); // 16,989,375 kobo
    expect(charge.amountMinor).toBe(16_989_375);
    expect(charge.note).toMatchObject({
      method: "snapshot_rates",
      quoteCurrency: "GBP",
      quoteTotalMinor: 9061,
    });
  });

  it("keeps working after live rates change, and after the snapshot has been stored and read back", () => {
    const quote = calculateLandedCost(chinaInput({ buyerCurrency: "USD" }), rules(), fxRows());
    const stored = JSON.parse(JSON.stringify(quote.snapshot));
    // 1 US cent = NGN 15.00 = 1500 kobo
    expect(quoteTotalInNgn(quote.total, "USD", stored).amountMinor).toBe(quote.total * 1500);
  });

  it("includes an admin-changed total, because it converts the quote and not the engine result", () => {
    const quote = calculateLandedCost(nigeriaInput(), rules(), fxRows());
    const charge = quoteTotalInNgn(quote.total - 200, "GBP", quote.snapshot);
    expect(charge.amountMinor).toBe(Math.round(((quote.total - 200) * 1500) / 0.8));
  });

  it("rounds to the nearest kobo, half up", () => {
    // 1 CNY fen = 1500 / 7.2 = 208.33 kobo; 5 fen = 1041.67 kobo
    const quote = calculateLandedCost(chinaInput({ buyerCurrency: "CNY" }), rules(), fxRows());
    expect(quoteTotalInNgn(1, "CNY", quote.snapshot).amountMinor).toBe(208);
    expect(quoteTotalInNgn(5, "CNY", quote.snapshot).amountMinor).toBe(1042);
  });

  it("refuses when the snapshot is missing or lacks a rate", () => {
    expect(() => quoteTotalInNgn(100, "GBP", null)).toThrow(PricingError);
    const quote = calculateLandedCost(nigeriaInput(), rules(), fxRows());
    const noRates = { ...quote.snapshot, data: { ...quote.snapshot.data, fxRows: [] } };
    expect(() => quoteTotalInNgn(100, "GBP", noRates)).toThrow(PricingError);
  });

  it("records the buyer-currency and naira rates for every buyer currency", () => {
    for (const buyerCurrency of ["GBP", "USD", "CNY"]) {
      const quote = calculateLandedCost(
        nigeriaInput({ buyerCurrency, itemCurrency: "NGN" }),
        rules(),
        fxRows(),
      );
      expect(() => quoteTotalInNgn(quote.total, buyerCurrency, quote.snapshot)).not.toThrow();
    }
  });
});

describe("Paystack webhook handling", () => {
  type Row = PaymentRecord;
  function setup(row: Partial<Row> | null = {}, verified: Partial<VerifiedTransaction> | Error = {}) {
    const payment: Row | null =
      row === null
        ? null
        : {
            id: "pay-uuid",
            status: "pending",
            amountMinor: 500_000,
            currency: "NGN",
            orderId: "order-1",
            ...row,
          };
    const calls = { verify: 0, apply: 0, mark: [] as string[] };
    const store: PaymentStore = {
      findByReference: async () => payment,
      applySuccess: async () => {
        calls.apply += 1;
        return "applied";
      },
      markStatus: async (_id, status) => {
        calls.mark.push(status);
      },
    };
    const provider: PaymentProvider = {
      name: "paystack",
      initialize: vi.fn(),
      verify: async (reference) => {
        calls.verify += 1;
        if (verified instanceof Error) throw verified;
        return {
          reference,
          status: "success",
          amountMinor: 500_000,
          currency: "NGN",
          paidAt: "2026-10-20T10:00:00Z",
          raw: {},
          ...verified,
        };
      },
    };
    const send = (
      body: unknown = { event: "charge.success", data: { reference: "pay-uuid" } },
      signWith = SECRET,
    ) => {
      const rawBody = typeof body === "string" ? body : JSON.stringify(body);
      return handlePaystackWebhook({
        rawBody,
        signature: signPaystackBody(rawBody, signWith),
        secret: SECRET,
        provider,
        store,
      });
    };
    return { calls, send, store, provider };
  }

  it("applies a valid, verified payment", async () => {
    const { send, calls } = setup();
    const result = await send();
    expect(result).toEqual({ status: 200, body: { ok: true, outcome: "applied" } });
    expect(calls.verify).toBe(1);
    expect(calls.apply).toBe(1);
  });

  it("answers 401 for an invalid signature and does nothing else", async () => {
    const { send, calls } = setup();
    const result = await send(undefined, "sk_test_wrong_key_00000");
    expect(result.status).toBe(401);
    expect(calls).toEqual({ verify: 0, apply: 0, mark: [] });
  });

  it("answers 401 with no signature at all, and for an oversized body", async () => {
    const { store, provider } = setup();
    const none = await handlePaystackWebhook({
      rawBody: "{}",
      signature: null,
      secret: SECRET,
      provider,
      store,
    });
    expect(none.status).toBe(401);
    const huge = JSON.stringify({
      event: "charge.success",
      data: { reference: "x", pad: "a".repeat(MAX_WEBHOOK_BYTES) },
    });
    const big = await handlePaystackWebhook({
      rawBody: huge,
      signature: signPaystackBody(huge, SECRET),
      secret: SECRET,
      provider,
      store,
    });
    expect(big.status).toBe(401);
  });

  it("ignores a repeat for a payment already applied, without asking Paystack again", async () => {
    const { send, calls } = setup({ status: "success" });
    const result = await send();
    expect(result).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(calls).toEqual({ verify: 0, apply: 0, mark: [] });
  });

  it("rejects an amount that differs from our payment row and puts the payment on hold", async () => {
    const { send, calls } = setup({}, { amountMinor: 400_000 });
    const result = await send();
    expect(result.body).toEqual({ ok: false, rejected: "amount_mismatch" });
    expect(calls.apply).toBe(0);
    expect(calls.mark).toEqual(["mismatch"]);
  });

  it("rejects a different currency the same way", async () => {
    const { send, calls } = setup({}, { currency: "USD" });
    expect((await send()).body).toMatchObject({ rejected: "amount_mismatch" });
    expect(calls.mark).toEqual(["mismatch"]);
  });

  it("does not apply a payment Paystack says did not succeed, or one for another reference", async () => {
    const failed = setup({}, { status: "failed" });
    expect((await failed.send()).body).toMatchObject({ ignored: "not_successful" });
    expect(failed.calls.apply).toBe(0);
    const other = setup({}, { reference: "someone-else" });
    expect((await other.send()).body).toMatchObject({ ignored: "not_successful" });
    expect(other.calls.apply).toBe(0);
  });

  it("trusts Paystack's answer, not the webhook body: a claimed amount in the body changes nothing", async () => {
    const { send, calls } = setup({}, { amountMinor: 1 });
    const result = await send({
      event: "charge.success",
      data: { reference: "pay-uuid", amount: 500_000, status: "success" },
    });
    expect(result.body).toMatchObject({ rejected: "amount_mismatch" });
    expect(calls.apply).toBe(0);
  });

  it("acknowledges other events and unknown references without a verify call", async () => {
    const other = setup();
    expect(
      (await other.send({ event: "transfer.success", data: { reference: "pay-uuid" } })).body,
    ).toMatchObject({ ignored: "event" });
    const unknown = setup(null);
    expect((await unknown.send()).body).toMatchObject({ ignored: "unknown_reference" });
    expect(unknown.calls.verify + other.calls.verify).toBe(0);
  });

  it("leaves a payment on hold alone", async () => {
    const { send, calls } = setup({ status: "mismatch" });
    expect((await send()).body).toMatchObject({ ignored: "on_hold" });
    expect(calls.apply).toBe(0);
  });

  it("lets an error reaching Paystack surface, so the webhook is sent again later", async () => {
    const { send } = setup({}, new PaymentProviderError("Could not reach Paystack"));
    await expect(send()).rejects.toThrow(/Could not reach/);
  });

  it("rejects bodies that are not JSON or not an event", async () => {
    const { send } = setup();
    expect((await send("not json")).status).toBe(400);
    expect((await send({ hello: "world" })).status).toBe(400);
  });
});

describe("startPayment", () => {
  const NOW = new Date("2026-10-20T12:00:00Z");
  const quote = calculateLandedCost(nigeriaInput(), rules(), fxRows());
  const order = (over: Partial<PayableOrder> = {}): PayableOrder => ({
    id: "o1",
    buyerId: "buyer-1",
    status: "awaiting_payment",
    quote: {
      id: "q1",
      status: "accepted",
      totalMinor: quote.total,
      currency: "GBP",
      expiresAt: "2026-10-20T14:00:00Z",
      snapshot: quote.snapshot,
    },
    ...over,
  });

  function deps(o: PayableOrder | null, over: Partial<StartPaymentDeps> = {}) {
    const created: unknown[] = [];
    const initialized: unknown[] = [];
    const failed: string[] = [];
    const value: StartPaymentDeps = {
      loadOrder: async () => o,
      createPayment: async (args) => {
        created.push(args);
        return "pay-uuid";
      },
      markFailed: async (id) => {
        failed.push(id);
      },
      provider: {
        name: "paystack",
        initialize: async (input) => {
          initialized.push(input);
          return { authorizationUrl: "https://checkout.paystack.com/x", reference: input.reference };
        },
        verify: vi.fn(),
      },
      callbackUrl: (id) => `https://app.test/pay/callback?reference=${id}`,
      now: () => NOW,
      ...over,
    };
    return { value, created, initialized, failed };
  }
  const buyer = { id: "buyer-1", email: "buyer@test.example" };

  it("charges the naira amount from the snapshot with our payment id as the reference", async () => {
    const d = deps(order());
    const result = await startPayment("o1", buyer, d.value);
    expect(result).toEqual({ ok: true, url: "https://checkout.paystack.com/x", paymentId: "pay-uuid" });
    expect(d.created[0]).toMatchObject({ amountMinor: 16_989_375, orderId: "o1", buyerId: "buyer-1" });
    expect(d.initialized[0]).toMatchObject({
      email: "buyer@test.example",
      amountMinor: 16_989_375,
      currency: "NGN",
      reference: "pay-uuid",
      callbackUrl: "https://app.test/pay/callback?reference=pay-uuid",
    });
  });

  it("refuses another buyer's order, an unknown order and an order not waiting for payment", async () => {
    for (const [o, code] of [
      [null, "not_found"],
      [order({ buyerId: "someone-else" }), "not_found"],
      [order({ status: "paid" }), "not_payable"],
      [order({ quote: null }), "not_payable"],
    ] as const) {
      const d = deps(o);
      const result = await startPayment("o1", buyer, d.value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
      expect(d.created).toHaveLength(0);
    }
  });

  it("refuses once the quote has expired, before creating anything", async () => {
    const o = order();
    o.quote!.expiresAt = "2026-10-20T11:59:59Z";
    const d = deps(o);
    const result = await startPayment("o1", buyer, d.value);
    expect(result).toMatchObject({ ok: false, code: "quote_expired" });
    expect(d.created).toHaveLength(0);
    expect(d.initialized).toHaveLength(0);
  });

  it("marks the payment failed when Paystack cannot be reached", async () => {
    const d = deps(order(), {
      provider: {
        name: "paystack",
        initialize: async () => {
          throw new PaymentProviderError("Could not reach Paystack");
        },
        verify: vi.fn(),
      },
    });
    const result = await startPayment("o1", buyer, d.value);
    expect(result).toMatchObject({ ok: false, code: "provider" });
    expect(d.failed).toEqual(["pay-uuid"]);
  });

  it("passes on a database refusal as a readable message", async () => {
    const d = deps(order(), {
      createPayment: async () => {
        throw new Error("This order has already been paid");
      },
    });
    expect(await startPayment("o1", buyer, d.value)).toMatchObject({
      ok: false,
      message: "This order has already been paid",
    });
  });
});
