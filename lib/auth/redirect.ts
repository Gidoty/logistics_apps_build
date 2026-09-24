const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

export const DEFAULT_AFTER_LOGIN = "/account";
export const LOGIN_PATH = "/login";
export const UNAUTHORIZED_PATH = "/unauthorized";

/**
 * Returns a same-site path to redirect to after login, or the fallback.
 * Blocks open redirects such as "//evil.com", "/\\evil.com" and absolute URLs.
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters and backslashes can be read as other hosts by browsers.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** Builds the login URL that returns the user to `path` afterwards. */
export function loginPathFor(path: string): string {
  const next = safeRedirectPath(path);
  return next === DEFAULT_AFTER_LOGIN ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}
