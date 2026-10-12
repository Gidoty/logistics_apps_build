import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptDeliveryCode,
  encryptDeliveryCode,
  generateDeliveryCode,
  hashDeliveryCode,
  isWellFormedCode,
} from "@/lib/delivery/crypto";
import { buildWhatsAppLink } from "@/lib/delivery/whatsapp";
import { parseTracking } from "@/lib/tracking/data";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

describe("delivery code crypto", () => {
  const saved = process.env.DELIVERY_CODE_KEY;
  beforeEach(() => {
    process.env.DELIVERY_CODE_KEY = "test-key-test-key-test-key-test-key-1234";
  });
  afterEach(() => {
    process.env.DELIVERY_CODE_KEY = saved;
  });

  it("makes six digits and keeps leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(generateDeliveryCode()).toMatch(/^\d{6}$/);
    expect(isWellFormedCode("012345")).toBe(true);
    expect(isWellFormedCode("12345")).toBe(false);
    expect(isWellFormedCode("1234567")).toBe(false);
    expect(isWellFormedCode("12 456")).toBe(false);
  });

  it("uses the whole range, not a short one", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(Math.floor(Number(generateDeliveryCode()) / 100_000));
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("hashes to 64 hex characters, bound to the order and the code", () => {
    const hash = hashDeliveryCode(TOKEN, "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeliveryCode(TOKEN, "123456")).toBe(hash);
    expect(hashDeliveryCode(TOKEN, "123457")).not.toBe(hash);
    expect(hashDeliveryCode(OTHER, "123456")).not.toBe(hash);
  });

  it("changes the hash when the key changes", () => {
    const first = hashDeliveryCode(TOKEN, "123456");
    process.env.DELIVERY_CODE_KEY = "another-key-another-key-another-key-99";
    expect(hashDeliveryCode(TOKEN, "123456")).not.toBe(first);
  });

  it("encrypts and decrypts, never storing the code in clear text", () => {
    const stored = encryptDeliveryCode("004217", TOKEN);
    expect(stored).not.toContain("004217");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptDeliveryCode(stored, TOKEN)).toBe("004217");
    expect(encryptDeliveryCode("004217", TOKEN)).not.toBe(stored);
  });

  it("refuses a copy moved to another order, a changed copy, or the wrong key", () => {
    const stored = encryptDeliveryCode("004217", TOKEN);
    expect(decryptDeliveryCode(stored, OTHER)).toBeNull();
    const parts = stored.split(".");
    parts[3] = Buffer.from("999999").toString("base64url");
    expect(decryptDeliveryCode(parts.join("."), TOKEN)).toBeNull();
    expect(decryptDeliveryCode("garbage", TOKEN)).toBeNull();
    process.env.DELIVERY_CODE_KEY = "another-key-another-key-another-key-99";
    expect(decryptDeliveryCode(stored, TOKEN)).toBeNull();
  });

  it("fails loudly when the key is missing or short", () => {
    delete process.env.DELIVERY_CODE_KEY;
    expect(() => hashDeliveryCode(TOKEN, "123456")).toThrow(/DELIVERY_CODE_KEY/);
    process.env.DELIVERY_CODE_KEY = "short";
    expect(() => generateDeliveryCode() && encryptDeliveryCode("123456", TOKEN)).toThrow(/DELIVERY_CODE_KEY/);
  });
});

describe("buildWhatsAppLink", () => {
  const base = { recipientFirstName: "Ada", trackingUrl: "https://app.test/t/abc", code: "123456" };

  it("addresses the recipient with digits only and includes the tracking link and code", () => {
    const url = new URL(buildWhatsAppLink({ ...base, recipientPhone: "+234 803 123 4567" }));
    expect(url.origin + url.pathname).toBe("https://wa.me/2348031234567");
    const text = url.searchParams.get("text") ?? "";
    expect(text).toContain("Ada");
    expect(text).toContain("https://app.test/t/abc");
    expect(text).toContain("123456");
  });

  it("opens WhatsApp's contact picker when the number looks wrong", () => {
    for (const phone of [null, "", "12", "+1".padEnd(30, "1")]) {
      const url = new URL(buildWhatsAppLink({ ...base, recipientPhone: phone }));
      expect(url.origin + url.pathname).toBe("https://wa.me/");
    }
  });
});

describe("parseTracking", () => {
  const good = {
    status: "in_transit",
    item: "Phone",
    recipient_first_name: "Ada",
    recipient_city: "Lagos",
    updated_at: "2026-10-12T10:00:00Z",
    can_enter_code: false,
    code_locked: false,
    history: [{ status: "paid", at: "2026-10-10T10:00:00Z" }],
  };

  it("keeps the safe fields", () => {
    expect(parseTracking(good)).toEqual(good);
  });

  it("drops any extra field a database change might add", () => {
    const parsed = parseTracking({
      ...good,
      phone: "+2348031234567",
      address_line: "12 Aba Road",
      total_minor: 15000000,
      history: [{ status: "paid", at: "2026-10-10T10:00:00Z", note: "secret" }],
    });
    expect(Object.keys(parsed ?? {}).sort()).toEqual(Object.keys(good).sort());
    expect(JSON.stringify(parsed)).not.toMatch(/2348031234567|Aba Road|15000000|secret/);
  });

  it("rejects anything that is not the expected shape", () => {
    expect(parseTracking(null)).toBeNull();
    expect(parseTracking({ status: "paid" })).toBeNull();
  });
});
