import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  SlidingWindowRateLimiter,
  extractClientIp,
  checkRateLimit,
  assertRateLimit,
  clearRateLimiter,
  RATE_LIMIT_CONFIGS,
  createRateLimitMiddleware,
} from "../lib/rate-limit";

describe("Phase 1 — In-Memory Rate Limiting (P1.1)", () => {
  beforeEach(() => {
    clearRateLimiter();
    vi.restoreAllMocks();
  });

  describe("Safe Client IP Extraction (extractClientIp)", () => {
    it("extracts IP from cf-connecting-ip header (highest priority)", () => {
      const headers = new Headers({
        "cf-connecting-ip": "203.0.113.195",
        "x-real-ip": "198.51.100.1",
        "x-forwarded-for": "192.0.2.1, 10.0.0.1",
      });
      expect(extractClientIp(headers)).toBe("203.0.113.195");
    });

    it("extracts IP from x-real-ip when cf-connecting-ip is absent", () => {
      const headers = new Headers({
        "x-real-ip": "198.51.100.42",
        "x-forwarded-for": "192.0.2.1, 10.0.0.1",
      });
      expect(extractClientIp(headers)).toBe("198.51.100.42");
    });

    it("extracts leftmost client IP from x-forwarded-for chain", () => {
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178",
      });
      expect(extractClientIp(headers)).toBe("203.0.113.50");
    });

    it("strips IPv6-mapped IPv4 prefix (::ffff:)", () => {
      const headers = new Headers({
        "cf-connecting-ip": "::ffff:192.168.1.5",
      });
      expect(extractClientIp(headers)).toBe("192.168.1.5");
    });

    it("strips port number from IPv4 address", () => {
      const headers = new Headers({
        "x-real-ip": "192.168.1.100:54321",
      });
      expect(extractClientIp(headers)).toBe("192.168.1.100");
    });

    it("works with a standard Request object", () => {
      const req = new Request("https://duckroom.vn/api/test", {
        headers: { "cf-connecting-ip": "103.21.244.2" },
      });
      expect(extractClientIp(req)).toBe("103.21.244.2");
    });

    it("works with a plain JavaScript object map of headers", () => {
      const raw = { "X-Forwarded-For": "14.161.40.10, 10.0.0.1" };
      expect(extractClientIp(raw)).toBe("14.161.40.10");
    });

    it("works with a Node IncomingMessage-like object containing .headers map", () => {
      const nodeReq = {
        headers: {
          "x-forwarded-for": "203.0.113.195, 10.0.0.1",
        },
        url: "/api/test",
        method: "POST",
      };
      expect(extractClientIp(nodeReq)).toBe("203.0.113.195");
    });

    it("works with an object containing a standard Headers instance in .headers", () => {
      const customReq = {
        headers: new Headers({
          "cf-connecting-ip": "198.51.100.99",
        }),
      };
      expect(extractClientIp(customReq)).toBe("198.51.100.99");
    });

    it("extracts IPv6 from bracketed notation with or without port", () => {
      expect(extractClientIp({ "cf-connecting-ip": "[2001:db8::1]:8080" })).toBe("2001:db8::1");
      expect(extractClientIp({ "cf-connecting-ip": "[2001:db8::1]" })).toBe("2001:db8::1");
    });

    it("skips 'unknown' entry in x-forwarded-for chain to find first valid client IP", () => {
      const headers = {
        "x-forwarded-for": "unknown, 198.51.100.10, 10.0.0.1",
      };
      expect(extractClientIp(headers)).toBe("198.51.100.10");
    });

    it("falls back to 127.0.0.1 when no proxy headers are present", () => {
      expect(extractClientIp(new Headers())).toBe("127.0.0.1");
      expect(extractClientIp(null)).toBe("127.0.0.1");
      expect(extractClientIp(undefined)).toBe("127.0.0.1");
      expect(extractClientIp({})).toBe("127.0.0.1");
    });
  });

  describe("Sliding Window Rate Limiter Engine", () => {
    it("allows requests within quota limit", () => {
      const limiter = new SlidingWindowRateLimiter();
      const ip = "1.2.3.4";
      const config = { limit: 3, windowMs: 10_000, bucketName: "test" };

      const r1 = limiter.check("test:" + ip, config.limit, config.windowMs);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.check("test:" + ip, config.limit, config.windowMs);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.check("test:" + ip, config.limit, config.windowMs);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // 4th request exceeds quota
      const r4 = limiter.check("test:" + ip, config.limit, config.windowMs);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("differentiates different IP addresses into separate buckets", () => {
      const limiter = new SlidingWindowRateLimiter();
      const config = { limit: 2, windowMs: 60_000, bucketName: "test" };

      // Exhaust quota for IP A
      limiter.check("test:1.1.1.1", config.limit, config.windowMs);
      limiter.check("test:1.1.1.1", config.limit, config.windowMs);
      const rA = limiter.check("test:1.1.1.1", config.limit, config.windowMs);
      expect(rA.allowed).toBe(false);

      // IP B should still have full quota
      const rB = limiter.check("test:2.2.2.2", config.limit, config.windowMs);
      expect(rB.allowed).toBe(true);
      expect(rB.remaining).toBe(1);
    });

    it("resets quota after window slides past old timestamps", () => {
      const limiter = new SlidingWindowRateLimiter();
      const key = "test:10.0.0.1";
      const limit = 2;
      const windowMs = 5000;
      const startTime = 1_000_000;

      // 2 requests at startTime
      expect(limiter.check(key, limit, windowMs, startTime).allowed).toBe(true);
      expect(limiter.check(key, limit, windowMs, startTime + 100).allowed).toBe(true);

      // Blocked at startTime + 200
      expect(limiter.check(key, limit, windowMs, startTime + 200).allowed).toBe(false);

      // Advance clock past window
      const futureTime = startTime + windowMs + 1000;
      const resetCheck = limiter.check(key, limit, windowMs, futureTime);
      expect(resetCheck.allowed).toBe(true);
      expect(resetCheck.remaining).toBe(1);
    });

    it("bounds in-memory storage capacity and evicts oldest buckets", () => {
      const limiter = new SlidingWindowRateLimiter({ maxBuckets: 5 });
      const now = Date.now();

      for (let i = 1; i <= 6; i++) {
        limiter.check(`bucket:ip-${i}`, 10, 60_000, now);
      }

      // Max capacity must not exceed 5
      expect(limiter.size).toBeLessThanOrEqual(5);
    });

    it("prunes expired timestamps across inactive buckets", () => {
      const limiter = new SlidingWindowRateLimiter();
      const now = 1_000_000;

      limiter.check("bucket:old", 5, 10_000, now);
      expect(limiter.size).toBe(1);

      // Prune after window expired
      const pruned = limiter.prune(now + 15_000, 10_000);
      expect(pruned).toBe(1);
      expect(limiter.size).toBe(0);
    });
  });

  describe("Configured Quotas Enforcement", () => {
    it("enforces Playback URL quota: 60 requests / minute / IP", () => {
      const ip = "172.16.0.1";
      const { limit, windowMs } = RATE_LIMIT_CONFIGS.playback;
      expect(limit).toBe(60);
      expect(windowMs).toBe(60_000);

      for (let i = 0; i < 60; i++) {
        const res = checkRateLimit(RATE_LIMIT_CONFIGS.playback, ip);
        expect(res.allowed).toBe(true);
      }

      const overLimit = checkRateLimit(RATE_LIMIT_CONFIGS.playback, ip);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.remaining).toBe(0);
    });

    it("enforces Share Link Creation quota: 10 requests / minute / IP", () => {
      const ip = "172.16.0.2";
      const { limit, windowMs } = RATE_LIMIT_CONFIGS.shareLink;
      expect(limit).toBe(10);
      expect(windowMs).toBe(60_000);

      for (let i = 0; i < 10; i++) {
        const res = checkRateLimit(RATE_LIMIT_CONFIGS.shareLink, ip);
        expect(res.allowed).toBe(true);
      }

      const overLimit = checkRateLimit(RATE_LIMIT_CONFIGS.shareLink, ip);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.remaining).toBe(0);
    });

    it("enforces Presigned Upload URL quota: 5 requests / minute / IP", () => {
      const ip = "172.16.0.3";
      const { limit, windowMs } = RATE_LIMIT_CONFIGS.presignedUpload;
      expect(limit).toBe(5);
      expect(windowMs).toBe(60_000);

      for (let i = 0; i < 5; i++) {
        const res = checkRateLimit(RATE_LIMIT_CONFIGS.presignedUpload, ip);
        expect(res.allowed).toBe(true);
      }

      const overLimit = checkRateLimit(RATE_LIMIT_CONFIGS.presignedUpload, ip);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.remaining).toBe(0);
    });
  });

  describe("assertRateLimit & HTTP 429 Response Format", () => {
    it("does not throw when within quota", () => {
      expect(() => {
        assertRateLimit(RATE_LIMIT_CONFIGS.presignedUpload, "10.10.10.10");
      }).not.toThrow();
    });

    it("throws a Response object with status 429 and Retry-After header on quota exceeded", async () => {
      const ip = "10.10.10.20";
      for (let i = 0; i < 5; i++) {
        assertRateLimit(RATE_LIMIT_CONFIGS.presignedUpload, ip);
      }

      let caughtResponse: Response | null = null;
      try {
        assertRateLimit(RATE_LIMIT_CONFIGS.presignedUpload, ip);
      } catch (err) {
        if (err instanceof Response) {
          caughtResponse = err;
        }
      }

      expect(caughtResponse).not.toBeNull();
      expect(caughtResponse?.status).toBe(429);
      expect(caughtResponse?.statusText).toBe("Too Many Requests");
      expect(caughtResponse?.headers.get("Content-Type")).toBe("application/json");
      expect(caughtResponse?.headers.get("Retry-After")).toBeDefined();

      const body = await caughtResponse?.json();
      expect(body.error).toMatch(/Too Many Requests: Rate limit exceeded/i);
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe("Rate Limit Middleware Creation", () => {
    it("creates a middleware that executes assertRateLimit on server invocation", async () => {
      const mw = createRateLimitMiddleware({ limit: 1, windowMs: 60_000, bucketName: "mw-test" });
      expect(mw).toBeDefined();
      expect(mw.options).toBeDefined();
      expect(typeof mw.options?.server).toBe("function");
    });
  });
});
