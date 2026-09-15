import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LruCache } from "../lib/lru-cache";
import {
  verifyMemberAuthorization,
  clearAuthCache,
  getAuthCacheSize,
  hashAuthToken,
  invalidateAuthUser,
  invalidateAuthToken,
} from "../lib/auth.server";
import * as supabaseModule from "../lib/supabase";

describe("Phase 1 — In-Memory Auth Cache 60s & LRU Cache (P1.2)", () => {
  describe("Bounded LRU Cache with TTL (LruCache)", () => {
    it("stores and retrieves non-expired entries", () => {
      const cache = new LruCache<string, number>({ maxSize: 10, ttlMs: 10_000 });
      cache.set("a", 100);
      expect(cache.get("a")).toBe(100);
      expect(cache.has("a")).toBe(true);
      expect(cache.size).toBe(1);
    });

    it("returns undefined for expired entries and cleans them lazily", () => {
      const cache = new LruCache<string, string>({ maxSize: 10, ttlMs: 100 });
      cache.set("short-lived", "value", 1); // 1ms TTL

      // Wait 10ms for expiration
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy-wait
      }

      expect(cache.get("short-lived")).toBeUndefined();
      expect(cache.has("short-lived")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("expires immediately when customTtlMs is 0", () => {
      const cache = new LruCache<string, string>({ maxSize: 10, ttlMs: 60_000 });
      cache.set("zero-ttl", "val", 0);
      expect(cache.get("zero-ttl")).toBeUndefined();
      expect(cache.has("zero-ttl")).toBe(false);
    });

    it("evicts the least recently used entry when maxSize is reached", () => {
      const cache = new LruCache<string, string>({ maxSize: 3, ttlMs: 60_000 });

      cache.set("first", "1");
      cache.set("second", "2");
      cache.set("third", "3");

      // Access "first" so "second" becomes the oldest / least recently used
      expect(cache.get("first")).toBe("1");

      // Insert 4th entry, which should trigger eviction of "second"
      cache.set("fourth", "4");

      expect(cache.get("second")).toBeUndefined();
      expect(cache.get("first")).toBe("1");
      expect(cache.get("third")).toBe("3");
      expect(cache.get("fourth")).toBe("4");
      expect(cache.size).toBe(3);
    });

    it("prunes all expired entries when prune() is invoked", () => {
      const cache = new LruCache<string, string>({ maxSize: 10, ttlMs: 60_000 });
      cache.set("keep", "valid", 60_000);
      cache.set("expire1", "exp", 1);
      cache.set("expire2", "exp", 1);

      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const prunedCount = cache.prune();
      expect(prunedCount).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.get("keep")).toBe("valid");
    });

    it("deletes entries matching a custom predicate via deleteWhere()", () => {
      const cache = new LruCache<string, { userId: string; role: string }>({ maxSize: 10 });
      cache.set("k1", { userId: "user-1", role: "member" });
      cache.set("k2", { userId: "user-2", role: "member" });
      cache.set("k3", { userId: "user-1", role: "owner" });

      const deleted = cache.deleteWhere((entry) => entry.userId === "user-1");
      expect(deleted).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.has("k2")).toBe(true);
      expect(cache.has("k1")).toBe(false);
      expect(cache.has("k3")).toBe(false);
    });

    it("clears all entries with clear()", () => {
      const cache = new LruCache<string, number>({ maxSize: 10 });
      cache.set("x", 1);
      cache.set("y", 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("x")).toBeUndefined();
    });
  });

  describe("Session Verification Caching (verifyMemberAuthorization)", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      clearAuthCache();
      vi.restoreAllMocks();
      process.env = { ...originalEnv };
      delete process.env["DUCKROOM_OWNER_EMAIL"];
      delete process.env["OWNER_EMAIL"];
    });

    afterEach(() => {
      process.env = originalEnv;
      clearAuthCache();
      vi.restoreAllMocks();
    });

    it("computes SHA-256 hash as cache key and never stores raw JWT as key", () => {
      const token = "sample-token-string";
      const hash = hashAuthToken(token);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toBe(token);
    });

    it("caches verified session for subsequent calls within 60s (eliminates double-hop latency)", async () => {
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-cached-1", email: "cached@duckroom.vn" } },
        error: null,
      });

      const profileMock = vi.fn().mockResolvedValue({
        data: { user_id: "user-cached-1", email: "cached@duckroom.vn", role: "member" },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: profileMock,
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const token = "Bearer my-secret-session-token";

      // First verification: should call Supabase getUser + profiles
      const res1 = await verifyMemberAuthorization(undefined, token);
      expect(res1.isAuthorized).toBe(true);
      expect(res1.userId).toBe("user-cached-1");
      expect(res1.role).toBe("member");
      expect(getUserMock).toHaveBeenCalledTimes(1);
      expect(profileMock).toHaveBeenCalledTimes(1);
      expect(getAuthCacheSize()).toBe(1);

      // Second verification within 60s: should hit cache WITHOUT calling Supabase
      const res2 = await verifyMemberAuthorization(undefined, token);
      expect(res2.isAuthorized).toBe(true);
      expect(res2.userId).toBe("user-cached-1");
      expect(res2.role).toBe("member");
      expect(getUserMock).toHaveBeenCalledTimes(1); // STILL 1 (cache hit!)
      expect(profileMock).toHaveBeenCalledTimes(1); // STILL 1 (cache hit!)
    });

    it("bypasses cache when options.fresh is true (enforced for write mutations)", async () => {
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-fresh-1", email: "fresh@duckroom.vn" } },
        error: null,
      });

      const profileMock = vi.fn().mockResolvedValue({
        data: { user_id: "user-fresh-1", email: "fresh@duckroom.vn", role: "owner" },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: profileMock,
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const token = "Bearer write-mutation-token";

      // 1. Initial cached read
      await verifyMemberAuthorization(undefined, token);
      expect(getUserMock).toHaveBeenCalledTimes(1);

      // 2. Write mutation with fresh: true
      const freshRes = await verifyMemberAuthorization(undefined, token, { fresh: true });
      expect(freshRes.isAuthorized).toBe(true);
      expect(freshRes.role).toBe("owner");
      expect(getUserMock).toHaveBeenCalledTimes(2); // Called again because fresh: true!
    });

    it("invalidates cached sessions for user when role is updated (invalidateAuthUser)", async () => {
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-elevated", email: "elevated@duckroom.vn" } },
        error: null,
      });

      const profileMock = vi
        .fn()
        .mockResolvedValueOnce({
          data: { user_id: "user-elevated", email: "elevated@duckroom.vn", role: "member" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { user_id: "user-elevated", email: "elevated@duckroom.vn", role: "owner" },
          error: null,
        });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: profileMock,
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const token = "Bearer role-elevation-token";

      // Initial read: member
      const initial = await verifyMemberAuthorization(undefined, token);
      expect(initial.role).toBe("member");
      expect(getAuthCacheSize()).toBe(1);

      // User's role is updated in DB -> invalidate cache
      const invalidatedCount = invalidateAuthUser("user-elevated");
      expect(invalidatedCount).toBe(1);
      expect(getAuthCacheSize()).toBe(0);

      // Subsequent read: misses cache and reflects updated owner role
      const elevated = await verifyMemberAuthorization(undefined, token);
      expect(elevated.role).toBe("owner");
      expect(getUserMock).toHaveBeenCalledTimes(2);
    });

    it("invalidates cache by raw token via invalidateAuthToken", async () => {
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-logout", email: "logout@duckroom.vn" } },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const token = "Bearer logout-token";
      await verifyMemberAuthorization(undefined, token);
      expect(getAuthCacheSize()).toBe(1);

      invalidateAuthToken(token);
      expect(getAuthCacheSize()).toBe(0);
    });

    it("does not cache failed authentication or network error results", async () => {
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid session" },
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn(),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const token = "Bearer bad-token";
      const res = await verifyMemberAuthorization(undefined, token);
      expect(res.isAuthorized).toBe(false);

      // Failed auth must NEVER be cached
      expect(getAuthCacheSize()).toBe(0);
    });

    it("caps cache TTL to remaining token expiration if expiring in less than 60s", async () => {
      const expiresInSeconds = 2; // Expiring in 2 seconds
      const fakeHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const fakePayload = btoa(
        JSON.stringify({
          sub: "user-short-jwt",
          email: "short@duckroom.vn",
          exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        }),
      );
      const shortJwt = `Bearer ${fakeHeader}.${fakePayload}.signature`;

      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-short-jwt", email: "short@duckroom.vn" } },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await verifyMemberAuthorization(undefined, shortJwt);
      expect(res.isAuthorized).toBe(true);
      expect(getAuthCacheSize()).toBe(1);

      // Wait 2.2 seconds for token expiration
      await new Promise((r) => setTimeout(r, 2200));

      // Should have expired from cache
      const cachedResult = await verifyMemberAuthorization(undefined, shortJwt);
      expect(getUserMock).toHaveBeenCalledTimes(2); // Re-verified from Supabase
    });

    it("enforces fresh check in requireFreshMemberMiddleware without cache", async () => {
      const { requireFreshMemberMiddleware } = await import("../lib/auth-guard");
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-fresh-mw", email: "fresh-mw@duckroom.vn" } },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const serverFn = (requireFreshMemberMiddleware as any).options?.server;
      expect(serverFn).toBeDefined();

      const nextMock = vi.fn().mockImplementation(({ context }) => ({ context }));

      // Call 1
      await serverFn({
        next: nextMock,
        context: { authToken: "Bearer fresh-member-test" },
      });
      expect(getUserMock).toHaveBeenCalledTimes(1);

      // Call 2 with same token: must STILL call Supabase because fresh: true
      await serverFn({
        next: nextMock,
        context: { authToken: "Bearer fresh-member-test" },
      });
      expect(getUserMock).toHaveBeenCalledTimes(2);
    });

    it("enforces fresh owner check in requireFreshOwnerMiddleware without cache", async () => {
      const { requireFreshOwnerMiddleware } = await import("../lib/auth-guard");
      const getUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: "user-owner-mw", email: "owner-mw@duckroom.vn" } },
        error: null,
      });

      const mockSupabase = {
        auth: { getUser: getUserMock },
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { user_id: "user-owner-mw", role: "owner" },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const serverFn = (requireFreshOwnerMiddleware as any).options?.server;
      expect(serverFn).toBeDefined();

      const nextMock = vi.fn().mockImplementation(({ context }) => ({ context }));

      // Call 1
      await serverFn({
        next: nextMock,
        context: { authToken: "Bearer fresh-owner-test" },
      });
      expect(getUserMock).toHaveBeenCalledTimes(1);

      // Call 2 with same token: must STILL call Supabase because fresh: true
      await serverFn({
        next: nextMock,
        context: { authToken: "Bearer fresh-owner-test" },
      });
      expect(getUserMock).toHaveBeenCalledTimes(2);
    });
  });
});
