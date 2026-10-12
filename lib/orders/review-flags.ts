export const REVIEW_FLAG_LABELS: Record<string, string> = {
  paid_after_quote_expired:
    "Paid after the quote expired. Check the price is still right, then continue or refund.",
  stock_unavailable: "The item ran out of stock. Refund the buyer.",
  duplicate_payment: "Paid twice. Refund the extra payment.",
  payment_on_closed_order: "Paid for an order that was already closed. Refund the buyer.",
};
