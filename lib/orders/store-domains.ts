/**
 * Store matching for "Buy it for me" links. The rules come from the database
 * (store_domains): nothing about a store is hardcoded here. The database
 * function create_link_order() matches the same way and decides in the end;
 * a test compares the two.
 */

export type StoreRule = {
  id: string;
  domain: string;
  display_name: string;
  corridor_id: string | null;
  preview_allowed: boolean;
  supported: boolean;
};

export type StoreCheck =
  { kind: "supported"; store: StoreRule } | { kind: "unsupported"; store: StoreRule } | { kind: "unknown" };

/** Lower-case, no trailing dot. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The best (longest) store whose domain equals the host or is a parent of it:
 * m.aliexpress.com matches aliexpress.com, evilaliexpress.com does not.
 */
export function matchStoreDomain(host: string, stores: readonly StoreRule[]): StoreRule | null {
  const normalized = normalizeHost(host);
  let best: StoreRule | null = null;
  for (const store of stores) {
    const matches = normalized === store.domain || normalized.endsWith(`.${store.domain}`);
    if (matches && (best === null || store.domain.length > best.domain.length)) best = store;
  }
  return best;
}

export function checkStore(host: string, stores: readonly StoreRule[]): StoreCheck {
  const store = matchStoreDomain(host, stores);
  if (!store) return { kind: "unknown" };
  return store.supported ? { kind: "supported", store } : { kind: "unsupported", store };
}

export function unsupportedStoreMessage(store: Pick<StoreRule, "display_name">): string {
  return `We cannot buy from ${store.display_name} yet. Please send a link from a store we support.`;
}

export const MAX_URL_LENGTH = 2048;

export type ParsedProductUrl = { ok: true; href: string; host: string } | { ok: false; error: string };

const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|\?|#|$)/i;

/**
 * Reads what a buyer pasted. Phone share buttons often paste a sentence with
 * a link in it, so the first link is taken out of the text. The link must be
 * https on the standard port, with no user name or password, and must have a
 * real host name (not an IP address).
 */
export function parseProductUrl(input: string): ParsedProductUrl {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Paste the link to the product." };

  const found = /https?:\/\/[^\s<>"']+/i.exec(text)?.[0];
  const candidate = found ?? (BARE_DOMAIN.test(text) && !/\s/.test(text) ? `https://${text}` : text);
  if (candidate.length > MAX_URL_LENGTH) return { ok: false, error: "That link is too long." };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "That does not look like a link. Paste the full link from the store." };
  }

  if (url.protocol !== "https:") return { ok: false, error: "Use the https link from the store's website." };
  if (url.username !== "" || url.password !== "")
    return { ok: false, error: "That link has a user name in it. Use the plain product link." };
  if (url.port !== "" && url.port !== "443")
    return { ok: false, error: "That link uses an unusual port. Use the plain product link." };

  const host = normalizeHost(url.hostname);
  const isIpAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
  if (isIpAddress || !host.includes("."))
    return { ok: false, error: "Use the link from the store's website." };

  url.hash = "";
  return { ok: true, href: url.href, host };
}
