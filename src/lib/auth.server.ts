import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import { LruCache } from "./lru-cache";

export type DuckroomRole = "member" | "owner";

export type AuthorizationResult = {
  isAuthorized: boolean;
  userId: string | null;
  email: string | null;
  role: DuckroomRole | null;
  isAdmin: boolean;
  error?: string;
};

export interface VerifyAuthOptions {
  /** When true, bypasses the in-memory cache to force a fresh verification from Supabase and database */
  fresh?: boolean;
}

/**
 * In-memory LRU session cache for double-hop latency reduction (Phase 1 — P1.2):
 * - Bounded to 200 entries.
 * - Default TTL: 60 seconds.
 * - Keys are SHA-256 hashes of tokens (raw JWT is NEVER stored as a key in memory).
 * - Read operations leverage cache; write mutations verify fresh.
 */
const authCache = new LruCache<string, AuthorizationResult>({
  maxSize: 200,
  ttlMs: 60_000,
});

/**
 * Computes SHA-256 hash of an authorization token to use as cache key.
 */
export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Clears the session auth cache. Essential for testing and maintenance.
 */
export function clearAuthCache(): void {
  authCache.clear();
}

/**
 * Returns the current count of cached sessions.
 */
export function getAuthCacheSize(): number {
  return authCache.size;
}

/**
 * Invalidates cache entry for a specific raw token.
 */
export function invalidateAuthToken(token: string): void {
  const clean = token.replace(/^Bearer\s+/i, "").trim();
  if (clean) {
    authCache.delete(hashAuthToken(clean));
  }
}

/**
 * Invalidates all cached sessions for a given user ID (e.g. when role is updated).
 */
export function invalidateAuthUser(userId: string): number {
  return authCache.deleteWhere((val) => val.userId === userId);
}

/**
 * Extracts remaining lifetime from JWT exp claim without cryptographic verification.
 * Used strictly to ensure cache entries do not outlive the underlying token.
 */
function getJwtRemainingMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length === 3 && parts[1]) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      if (typeof payload.exp === "number") {
        return payload.exp * 1000 - Date.now();
      }
    }
  } catch {
    // Non-standard token structure, return null to use default TTL
  }
  return null;
}

/**
 * Verifies a Supabase access token and resolves Duckroom's server-side role.
 *
 * Security invariants:
 * - Fail-closed: invalid, expired, forged, or missing tokens are strictly rejected.
 * - No unsigned JWT parsing fallback: only cryptographic verification via Supabase Auth is trusted.
 * - No hardcoded Owner identity: Owner role is resolved from canonical database profiles.
 * - In-memory LRU cache (60s) used for read operations; fresh verification enforced for mutations.
 */
export async function verifyMemberAuthorization(
  request?: Request,
  explicitToken?: string | null,
  options?: VerifyAuthOptions | boolean,
): Promise<AuthorizationResult> {
  try {
    const isFresh = typeof options === "boolean" ? options : Boolean(options?.fresh);

    const rawToken =
      explicitToken ||
      request?.headers?.get?.("authorization") ||
      request?.headers?.get?.("x-supabase-auth") ||
      request?.headers?.get?.("x-auth-token");

    if (!rawToken) {
      return {
        isAuthorized: false,
        userId: null,
        email: null,
        role: null,
        isAdmin: false,
        error: "Authentication required.",
      };
    }

    const token = rawToken.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return {
        isAuthorized: false,
        userId: null,
        email: null,
        role: null,
        isAdmin: false,
        error: "Empty authorization token.",
      };
    }

    const tokenHash = hashAuthToken(token);

    // Read path: check 60s in-memory LRU cache if fresh state is not explicitly enforced
    if (!isFresh) {
      const cached = authCache.get(tokenHash);
      if (cached) {
        return cached;
      }
    }

    let userEmail: string | null = null;
    let userId: string | null = null;

    let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user?.email || !data?.user?.id) {
        return {
          isAuthorized: false,
          userId: null,
          email: null,
          role: null,
          isAdmin: false,
          error: "Invalid or expired session.",
        };
      }
      userEmail = data.user.email.toLowerCase().trim();
      userId = data.user.id;
    } catch (adminErr) {
      console.error("[Duckroom Auth] Supabase admin token verification failed:", adminErr);
      return {
        isAuthorized: false,
        userId: null,
        email: null,
        role: null,
        isAdmin: false,
        error: "Server authentication service unavailable.",
      };
    }

    if (!userEmail || !userId) {
      return {
        isAuthorized: false,
        userId: null,
        email: null,
        role: null,
        isAdmin: false,
        error: "Invalid or expired session.",
      };
    }

    // Canonical role resolution: Role is resolved SOLELY from profiles.role in Supabase
    let resolvedRole: DuckroomRole = "member";
    if (supabaseAdmin) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("user_id, email, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (!profileError && profile) {
        resolvedRole = profile.role === "owner" ? "owner" : "member";
      }
    }

    const authResult: AuthorizationResult = {
      isAuthorized: true,
      userId,
      email: userEmail,
      role: resolvedRole,
      isAdmin: resolvedRole === "owner",
    };

    // Cache successful authorization result for up to 60s, or until token expiration
    let cacheTtlMs = 60_000;
    const remainingMs = getJwtRemainingMs(token);
    if (remainingMs !== null) {
      if (remainingMs <= 0) {
        // Token is already expired
        return {
          isAuthorized: false,
          userId: null,
          email: null,
          role: null,
          isAdmin: false,
          error: "Invalid or expired session.",
        };
      }
      cacheTtlMs = Math.min(60_000, remainingMs);
    }

    authCache.set(tokenHash, authResult, cacheTtlMs);

    return authResult;
  } catch (error) {
    console.error("Duckroom authorization failure:", error);
    return {
      isAuthorized: false,
      userId: null,
      email: null,
      role: null,
      isAdmin: false,
      error: "Server authorization is unavailable.",
    };
  }
}
