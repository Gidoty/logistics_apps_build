import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedAddress, isIpLiteral } from "./ip";

/**
 * Fetches a web page for a link preview without letting a visitor aim the
 * server at our own network (SSRF).
 *
 * - https only, standard port, no user name or password in the link
 * - the host name is resolved here and every address must be public
 * - the connection goes to the very address that was checked, so a DNS answer
 *   cannot change between the check and the connection
 * - at most 3 redirects, each one checked the same way
 * - 5 second limit for everything, and at most 1 MB is read
 * - HTML only, no cookies, nothing is executed or stored
 */

export type SafeFetchFailure =
  | "invalid_url"
  | "not_https"
  | "blocked_host"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "timeout"
  | "bad_status"
  | "not_html"
  | "network";

export type SafeFetchResult =
  { ok: true; text: string; finalUrl: string; truncated: boolean } | { ok: false; reason: SafeFetchFailure };

export type RawResponse = {
  status: number;
  header: (name: string) => string | null;
  body: ReadableStream<Uint8Array> | null;
  /** Releases the connection. Called once the response has been used. */
  close: () => Promise<void> | void;
};

export type SafeFetchDeps = {
  /** All addresses (IPv4 and IPv6) for a host name. */
  resolve: (host: string) => Promise<string[]>;
  /** Makes one request to the given, already checked addresses. Must not follow redirects. */
  request: (url: URL, addresses: string[], signal: AbortSignal) => Promise<RawResponse>;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  deps?: Partial<SafeFetchDeps>;
};

export const DEFAULTS = { timeoutMs: 5000, maxBytes: 1_000_000, maxRedirects: 3 } as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_NAME = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp|intranet)$/i;

/** Checks a link before any network call. Returns a failure reason, or the parsed URL. */
export function checkUrl(url: URL): SafeFetchFailure | null {
  if (url.protocol !== "https:") return "not_https";
  if (url.username !== "" || url.password !== "") return "invalid_url";
  if (url.port !== "" && url.port !== "443") return "invalid_url";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return "invalid_url";
  if (isIpLiteral(host)) return "blocked_host";
  if (!host.includes(".") || BLOCKED_NAME.test(host)) return "blocked_host";
  return null;
}

/**
 * A DNS lookup function that always answers with the addresses we already
 * checked. Given to the HTTP client so it connects to exactly those.
 */
export function pinnedLookup(addresses: readonly string[]) {
  const list = addresses.map((address) => ({ address, family: isIP(address) }));
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      error: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    if (list.length === 0) return callback(new Error("No address to connect to"), "", 0);
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  };
}

const defaultResolve: SafeFetchDeps["resolve"] = async (host) => {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const defaultRequest: SafeFetchDeps["request"] = async (url, addresses, signal) => {
  const { Agent, fetch } = await import("undici");
  const agent = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
  try {
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; MapkLinkPreview/1.0)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
    });
    return {
      status: response.status,
      header: (name) => response.headers.get(name),
      body: response.body as ReadableStream<Uint8Array> | null,
      close: () => agent.close(),
    };
  } catch (error) {
    await agent.close();
    throw error;
  }
};

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (received - maxBytes)));
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(received, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), truncated };
}

/** Fetches an HTML page under the rules above. Never throws: failures come back as a reason. */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const resolve = options.deps?.resolve ?? defaultResolve;
  const request = options.deps?.request ?? defaultRequest;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const problem = checkUrl(url);
      if (problem) return { ok: false, reason: problem };

      let addresses: string[];
      try {
        addresses = await resolve(url.hostname.replace(/\.$/, ""));
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "dns_failed" };
      }
      if (addresses.length === 0) return { ok: false, reason: "dns_failed" };
      // One private address is enough to refuse: the host could hand it out any time.
      if (addresses.some((address) => isBlockedAddress(address)))
        return { ok: false, reason: "blocked_address" };

      let response: RawResponse;
      try {
        response = await request(url, addresses, controller.signal);
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
      }

      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.header("location");
          if (!location) return { ok: false, reason: "bad_status" };
          try {
            url = new URL(location, url);
          } catch {
            return { ok: false, reason: "invalid_url" };
          }
          continue;
        }
        if (response.status !== 200) return { ok: false, reason: "bad_status" };

        const type = (response.header("content-type") ?? "").toLowerCase();
        if (!type.startsWith("text/html") && !type.startsWith("application/xhtml+xml")) {
          return { ok: false, reason: "not_html" };
        }

        const { text, truncated } = await readCapped(response.body, maxBytes);
        return { ok: true, text, finalUrl: url.href, truncated };
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
      } finally {
        await Promise.resolve(response.close()).catch(() => undefined);
      }
    }
    return { ok: false, reason: "too_many_redirects" };
  } finally {
    clearTimeout(timer);
  }
}
