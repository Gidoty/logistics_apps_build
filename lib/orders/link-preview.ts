import { z } from "zod";
import { isIpLiteral } from "@/lib/security/ip";
import { safeFetchHtml, type SafeFetchDeps } from "@/lib/security/safe-fetch";

/**
 * Link previews for "Buy it for me". Only the page's Open Graph tags are read
 * (og:title, og:description, og:image) and nothing else is taken from the page.
 * Nothing is downloaded or re-hosted: the picture's address is shown with a
 * plain <img> and no referrer.
 */

export type LinkPreview = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 500;
export const IMAGE_URL_MAX = 2048;

/** The shape saved in orders.link_preview_json. Checked again before saving. */
export const linkPreviewSchema = z.object({
  title: z.string().max(TITLE_MAX).nullable(),
  description: z.string().max(DESCRIPTION_MAX).nullable(),
  imageUrl: z.string().max(IMAGE_URL_MAX).startsWith("https://").nullable(),
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Plain text only: no control characters, no markup, one line, capped. */
function cleanText(value: string, max: number): string | null {
  const text = decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return text === "" ? null : text;
}

/** An https picture address on a real host name, or null. The picture is never fetched by us. */
export function cleanImageUrl(value: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(value).trim(), base);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const safeHost =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443") &&
    host.includes(".") &&
    !isIpLiteral(host) &&
    !/(^|\.)(localhost|local|internal|localdomain|home|lan|corp|intranet)$/.test(host);
  if (!safeHost || url.href.length > IMAGE_URL_MAX) return null;
  return url.href;
}

const META_TAG = /<meta\b[^>]{0,3000}>/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/g;
const MAX_META_TAGS = 300;

/**
 * Reads the Open Graph tags from the head of an HTML page. Comments, scripts
 * and styles are skipped, only the first value of each tag counts, and only
 * the three tags above are returned.
 */
export function parseOpenGraph(html: string, baseUrl: string): LinkPreview {
  const head = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const end = head.search(/<\/head\s*>|<body\b/i);
  const scope = end === -1 ? head : head.slice(0, end);

  const found: Record<string, string> = {};
  let tags = 0;
  for (const tag of scope.matchAll(META_TAG)) {
    if (++tags > MAX_META_TAGS) break;
    const attributes: Record<string, string> = {};
    for (const attribute of tag[0].matchAll(ATTRIBUTE)) {
      attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    }
    const key = (attributes.property ?? attributes.name ?? "").trim().toLowerCase();
    if (
      (key === "og:title" || key === "og:description" || key === "og:image") &&
      !(key in found) &&
      attributes.content !== undefined
    ) {
      found[key] = attributes.content;
    }
  }

  return {
    title: found["og:title"] ? cleanText(found["og:title"], TITLE_MAX) : null,
    description: found["og:description"] ? cleanText(found["og:description"], DESCRIPTION_MAX) : null,
    imageUrl: found["og:image"] ? cleanImageUrl(found["og:image"], baseUrl) : null,
  };
}

/**
 * Fetches a preview for a product link. Returns null when there is none: the
 * store does not allow previews, the page could not be fetched safely, or it
 * had no usable tags. A missing preview is never an error for the buyer.
 */
export async function fetchLinkPreview(
  url: string,
  options: { previewAllowed: boolean; deps?: Partial<SafeFetchDeps>; timeoutMs?: number } = {
    previewAllowed: false,
  },
): Promise<LinkPreview | null> {
  if (!options.previewAllowed) return null;
  const result = await safeFetchHtml(url, { deps: options.deps, timeoutMs: options.timeoutMs });
  if (!result.ok) return null;
  const preview = parseOpenGraph(result.text, result.finalUrl);
  return preview.title || preview.imageUrl ? preview : null;
}
