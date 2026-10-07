/**
 * A small in-memory limiter: at most `limit` events per `windowMs` for a key.
 * Best effort only. Each server instance keeps its own counts and they reset
 * when it restarts, so use it to blunt abuse of cheap endpoints, never as the
 * only protection for anything that matters (those limits live in the database).
 */
export function createThrottle(limit: number, windowMs: number, now: () => number = Date.now) {
  const events = new Map<string, number[]>();

  return {
    /** Records an event and returns false when the key is over its limit. */
    allow(key: string): boolean {
      const current = now();
      const recent = (events.get(key) ?? []).filter((time) => current - time < windowMs);
      if (recent.length >= limit) {
        events.set(key, recent);
        return false;
      }
      recent.push(current);
      events.set(key, recent);
      // Keep memory bounded: drop keys with no recent events now and then.
      if (events.size > 5000) {
        for (const [existing, times] of events) {
          if (times.every((time) => current - time >= windowMs)) events.delete(existing);
        }
      }
      return true;
    },
  };
}
