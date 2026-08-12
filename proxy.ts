import { NextRequest, NextResponse } from "next/server";
import {
  isPilotDashboardAuthConfigured,
  isPilotDashboardAuthorized,
} from "@/lib/server/pilot-auth";

/**
 * Best-effort IP rate limiting for all /api/* routes (Next.js 16 "proxy",
 * formerly middleware).
 *
 * Several legacy routes are unauthenticated and can trigger paid Bright Data /
 * OpenRouter / Gemini calls, so without a throttle a single client can run up
 * the deployer's bill. The pilot routes also have authentication. This limiter
 * is in-memory (per instance on serverless), so it stops bursts rather than a
 * determined distributed attacker. For hard guarantees, front it with a shared
 * store (Upstash, Vercel KV).
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Per-path budgets (requests per window). The expensive pipelines get tighter caps.
const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  "/api/bulk-sro": { limit: 4, windowMs: 60_000 },
  "/api/scrape": { limit: 20, windowMs: 60_000 },
  "/api/pilot/run": { limit: 2, windowMs: 60_000 },
  "/api/pilot/results": { limit: 12, windowMs: 60_000 },
  "/api/brightdata-platforms": { limit: 12, windowMs: 60_000 },
  "/api/sro-analyze": { limit: 20, windowMs: 60_000 },
};
const DEFAULT_LIMIT = { limit: 30, windowMs: 60_000 };

export const config = { matcher: ["/api/:path*", "/pilot/:path*"] };

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path === "/pilot" || path.startsWith("/pilot/")) {
    if (!isPilotDashboardAuthConfigured()) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.next();
      }
      return NextResponse.json(
        { error: "Pilot dashboard authentication is not configured." },
        { status: 503 },
      );
    }
    if (!isPilotDashboardAuthorized(req.headers)) {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Scibasku AEO Pilot"' },
      });
    }
    return NextResponse.next();
  }

  const rule = LIMITS[path] ?? DEFAULT_LIMIT;

  const ip = (
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    req.headers.get("x-real-ip") ??
    "unknown"
  ).trim();
  const key = `${ip}:${path}`;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    // Opportunistic cleanup so the map can't grow without bound.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return NextResponse.next();
  }

  if (bucket.count >= rule.limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  bucket.count += 1;
  return NextResponse.next();
}
