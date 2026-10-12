/**
 * A wa.me link that opens WhatsApp with a ready message to the recipient. The
 * buyer taps send; we do not send anything ourselves in V1. wa.me wants the
 * number as digits only, with the country code and no plus sign.
 */
export function buildWhatsAppLink(input: {
  recipientPhone: string | null;
  recipientFirstName: string;
  trackingUrl: string;
  code: string;
}): string {
  const text =
    `Hello ${input.recipientFirstName}, your order is on its way. ` +
    `Track it here: ${input.trackingUrl}\n` +
    `Your delivery code is ${input.code}. Give it to the rider only when you have your item in your hands.`;
  const digits = (input.recipientPhone ?? "").replace(/\D/g, "");
  const base = digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}
