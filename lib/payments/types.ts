/** What the app needs from a payment provider. Paystack is the only one in V1. */
export type InitializeInput = {
  email: string;
  /** Smallest unit (kobo). */
  amountMinor: number;
  currency: string;
  /** Our payment id. The provider returns it on the webhook and the callback. */
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
};

export type InitializedTransaction = { authorizationUrl: string; reference: string };

export type VerifiedTransaction = {
  reference: string;
  /** The provider's own status word, for example "success". */
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  initialize(input: InitializeInput): Promise<InitializedTransaction>;
  verify(reference: string): Promise<VerifiedTransaction>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
