// In-memory fixed-window rate limiter. Per serverless instance, so it's a
// first line of defense, not a guarantee — pair with platform-level (Vercel
// WAF / bot protection) for the public launch.
const buckets = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n++;
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  return b.n <= limit;
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
