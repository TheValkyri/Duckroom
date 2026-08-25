import { getSupabaseAdmin } from "./supabase";

export type DuckroomRole = "member" | "owner";

export type AuthorizationResult = {
  isAuthorized: boolean;
  userId: string | null;
  email: string | null;
  role: DuckroomRole | null;
  isAdmin: boolean;
  error?: string;
};

/**
 * Verifies a Supabase access token and resolves Duckroom's server-side role.
 *
 * Security invariants:
 * - Fail-closed: invalid, expired, forged, or missing tokens are strictly rejected.
 * - No unsigned JWT parsing fallback: only cryptographic verification via Supabase Auth is trusted.
 * - No hardcoded Owner identity: Owner role is resolved from canonical database profiles or explicit server environment configuration.
 */
export async function verifyMemberAuthorization(
  request?: Request,
  explicitToken?: string | null,
): Promise<AuthorizationResult> {
  try {
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
    if (supabaseAdmin) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("user_id, email, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (!profileError && profile) {
        const role: DuckroomRole = profile.role === "owner" ? "owner" : "member";
        return {
          isAuthorized: true,
          userId,
          email: userEmail,
          role,
          isAdmin: role === "owner",
        };
      }
    }

    // Default: Verified Supabase account without explicit 'owner' role in profiles is a valid Member
    return {
      isAuthorized: true,
      userId,
      email: userEmail,
      role: "member",
      isAdmin: false,
    };
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
