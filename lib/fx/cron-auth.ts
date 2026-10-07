import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks the secret on a cron request. Vercel sends `Authorization: Bearer
 * <CRON_SECRET>` when CRON_SECRET is set in the project; `x-cron-secret` is
 * accepted too for other schedulers. With no secret configured nothing is
 * authorized, so the route can never be left open by a missing variable.
 */
export function isAuthorizedCron(headers: Pick<Headers, "get">, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer ?? headers.get("x-cron-secret");
  if (!provided) return false;
  // Hashing first makes both sides the same length, so the comparison is constant time.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
