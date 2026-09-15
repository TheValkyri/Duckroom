import { createMiddleware } from "@tanstack/react-start";

/**
 * RATE LIMITING SPECIFICATION (Phase 1 — P1.1)
 *
 * Sliding-window in-memory rate limiter suited for serverless execution containers:
 * - Tracks exact timestamp logs per IP bucket.
 * - Quotas:
 *     1. Playback URL requests (track/video): 60 requests / minute / IP
 *     2. Share link creation: 10 requests / minute / IP
 *     3. Presigned upload URL requests: 5 requests / minute / IP
 * - Safe client IP extraction from standard reverse proxy headers:
 *     1. cf-connecting-ip (Cloudflare)
 *     2. x-real-ip (Reverse proxy)
 *     3. x-forwarded-for (First non-proxied IP)
 * - Returns HTTP 429 ("Too Many Requests") with Retry-After header and clear JSON error.
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  bucketName: string;
}

export const RATE_LIMIT_CONFIGS = {
  playback: {
    limit: 60,
    windowMs: 60_000,
    bucketName: "playback",
  },
  shareLink: {
    limit: 10,
    windowMs: 60_000,
    bucketName: "share-link",
  },
  presignedUpload: {
    limit: 5,
    windowMs: 60_000,
    bucketName: "presigned-upload",
  },
} as const;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
}

export function sanitizeIp(raw: string): string {
  let cleaned = raw.trim();
  // Strip IPv6-mapped IPv4 prefix (e.g. "::ffff:192.168.1.1")
  cleaned = cleaned.replace(/^::ffff:/i, "");
  // If bracketed IPv6 with optional port (e.g. "[2001:db8::1]:8080"), extract IPv6
  const bracketMatch = cleaned.match(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1];
  }
  // If IPv4 with port (e.g. "1.2.3.4:8080"), strip the port
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(cleaned)) {
    return cleaned.split(":")[0] ?? "127.0.0.1";
  }
  return cleaned || "127.0.0.1";
}

function extractIpFromRecord(record: Record<string, any>): string {
  const getVal = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(record)) {
      if (k.toLowerCase() === lower) {
        if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
        if (typeof v === "string") return v;
      }
    }
    return undefined;
  };

  const cf = getVal("cf-connecting-ip");
  if (cf && cf.trim()) return sanitizeIp(cf);

  const real = getVal("x-real-ip");
  if (real && real.trim()) return sanitizeIp(real);

  const xff = getVal("x-forwarded-for");
  if (xff && xff.trim()) {
    const parts = xff.split(",");
    for (const part of parts) {
      const candidate = part.trim();
      if (candidate && candidate.toLowerCase() !== "unknown") {
        return sanitizeIp(candidate);
      }
    }
  }

  return "127.0.0.1";
}

function extractIpFromHeaders(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return sanitizeIp(cf);

  const real = headers.get("x-real-ip");
  if (real && real.trim()) return sanitizeIp(real);

  const xff = headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    const parts = xff.split(",");
    for (const part of parts) {
      const candidate = part.trim();
      if (candidate && candidate.toLowerCase() !== "unknown") {
        return sanitizeIp(candidate);
      }
    }
  }

  return "127.0.0.1";
}

/**
 * Safely extracts client IP from standard proxy/CDN headers.
 * Order of preference:
 * 1. cf-connecting-ip (Cloudflare edge)
 * 2. x-real-ip (Nginx / Edge gateway)
 * 3. x-forwarded-for (Standard client proxy chain — leftmost valid address)
 */
export function extractClientIp(source?: Request | Headers | Record<string, any> | null): string {
  if (!source) return "127.0.0.1";

  // If source has a headers property (e.g. Request, Node IncomingMessage, H3 request, { headers: ... })
  if (typeof source === "object" && "headers" in source && (source as any).headers) {
    const hdrs = (source as any).headers;
    if (typeof hdrs?.get === "function") {
      return extractIpFromHeaders(hdrs as Headers);
    }
    if (typeof hdrs === "object") {
      return extractIpFromRecord(hdrs);
    }
  }

  // If source itself has .get() (e.g. Headers instance)
  if (typeof (source as any).get === "function") {
    return extractIpFromHeaders(source as Headers);
  }

  // If source is a plain record of headers
  if (typeof source === "object") {
    return extractIpFromRecord(source as Record<string, any>);
  }

  return "127.0.0.1";
}

/**
 * In-memory sliding-window log rate limiter with bounded memory for serverless environments.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxBuckets: number;

  constructor(options?: { maxBuckets?: number }) {
    this.maxBuckets = options?.maxBuckets ?? 5000;
  }

  check(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const cutoff = now - windowMs;
    let timestamps = this.buckets.get(key);

    if (!timestamps) {
      timestamps = [];
      this.ensureCapacity(now, windowMs);
      this.buckets.set(key, timestamps);
    } else {
      timestamps = timestamps.filter((t) => t > cutoff);
      // Refresh recency in Map insertion order for LRU eviction
      this.buckets.delete(key);
      this.buckets.set(key, timestamps);
    }

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now;
      const resetMs = Math.max(1, oldest + windowMs - now);
      const retryAfterSeconds = Math.ceil(resetMs / 1000);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs,
        retryAfterSeconds,
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      limit,
      remaining: limit - timestamps.length,
      resetMs: windowMs,
      retryAfterSeconds: 0,
    };
  }

  private ensureCapacity(now: number, windowMs: number): void {
    if (this.buckets.size >= this.maxBuckets) {
      this.prune(now, windowMs);
      if (this.buckets.size >= this.maxBuckets) {
        // Evict oldest bucket to maintain bound
        const firstKey = this.buckets.keys().next().value;
        if (firstKey !== undefined) {
          this.buckets.delete(firstKey);
        }
      }
    }
  }

  prune(now = Date.now(), windowMs = 60_000): number {
    let pruned = 0;
    const cutoff = now - windowMs;
    for (const [key, timestamps] of this.buckets.entries()) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        this.buckets.delete(key);
        pruned++;
      } else {
        this.buckets.set(key, active);
      }
    }
    return pruned;
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

export const globalRateLimiter = new SlidingWindowRateLimiter();

export function clearRateLimiter(): void {
  globalRateLimiter.clear();
}

/**
 * Checks and records rate limit usage for a given bucket and IP.
 */
export function checkRateLimit(
  config: RateLimitConfig,
  ip: string,
  limiter: SlidingWindowRateLimiter = globalRateLimiter,
  now?: number,
): RateLimitResult {
  const key = `${config.bucketName}:${ip}`;
  return limiter.check(key, config.limit, config.windowMs, now);
}

/**
 * Asserts that rate limit quota is not exceeded.
 * Throws HTTP 429 Response if limit is exceeded.
 */
export function assertRateLimit(
  config: RateLimitConfig,
  sourceOrIp?: Request | Headers | Record<string, string | string[] | undefined> | string | null,
  limiter: SlidingWindowRateLimiter = globalRateLimiter,
  now?: number,
): RateLimitResult {
  const ip = typeof sourceOrIp === "string" ? sanitizeIp(sourceOrIp) : extractClientIp(sourceOrIp);
  const result = checkRateLimit(config, ip, limiter, now);

  if (!result.allowed) {
    const errorMsg = `Too Many Requests: Rate limit exceeded for ${config.bucketName}. Limit is ${config.limit} requests per minute. Please try again in ${result.retryAfterSeconds} seconds.`;
    throw new Response(
      JSON.stringify({
        error: errorMsg,
        retryAfterSeconds: result.retryAfterSeconds,
      }),
      {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.retryAfterSeconds),
        },
      },
    );
  }

  return result;
}

/**
 * Creates TanStack Start server function middleware enforcing rate limiting for an endpoint.
 */
export function createRateLimitMiddleware(
  config: RateLimitConfig,
  limiter: SlidingWindowRateLimiter = globalRateLimiter,
) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    let clientIp = "127.0.0.1";
    try {
      const serverMod = await import("@tanstack/react-start/server");
      // 1. Check getRequestHeader if available
      if (typeof serverMod?.getRequestHeader === "function") {
        const cf = serverMod.getRequestHeader("cf-connecting-ip");
        const real = serverMod.getRequestHeader("x-real-ip");
        const xff = serverMod.getRequestHeader("x-forwarded-for");
        if (cf || real || xff) {
          clientIp = extractClientIp({ "cf-connecting-ip": cf, "x-real-ip": real, "x-forwarded-for": xff });
        }
      }
      // 2. Fall back to inspecting getRequest() (Node IncomingMessage / H3 request)
      if (clientIp === "127.0.0.1" && typeof serverMod?.getRequest === "function") {
        const req = serverMod.getRequest();
        if (req) {
          clientIp = extractClientIp(req);
        }
      }
      // 3. Fall back to getRequestIP if provided
      if (clientIp === "127.0.0.1" && typeof serverMod?.getRequestIP === "function") {
        const ip = serverMod.getRequestIP({ xForwardedFor: true });
        if (ip) {
          clientIp = sanitizeIp(ip);
        }
      }
    } catch {
      // In unit test or environment outside active H3 request
    }

    assertRateLimit(config, clientIp, limiter);
    return next({ context: { clientIp } });
  });
}

/** Rate limiter middleware for audio/video playback URL endpoints (60 req/min/IP) */
export const playbackRateLimitMiddleware = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.playback);

/** Rate limiter middleware for share link creation endpoints (10 req/min/IP) */
export const shareLinkRateLimitMiddleware = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.shareLink);

/** Rate limiter middleware for presigned upload URL requests (5 req/min/IP) */
export const uploadRateLimitMiddleware = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.presignedUpload);
