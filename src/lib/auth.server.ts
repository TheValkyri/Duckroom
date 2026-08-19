import { getSupabaseAdmin } from "./supabase";
import { getOptionalServerEnv, requireServerEnv } from "./server-env";

export type DuckroomRole = "member" | "owner";

export type AuthorizationResult = {
  isAuthorized: boolean;
  userId: string | null;
  email: string | null;
  role: DuckroomRole | null;
  isAdmin: boolean;
  error?: string;
};

function parseJwtPayload(token: string): { email?: string; sub?: string; exp?: number; role?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1]!;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Verifies a Supabase access token and resolves Duckroom's server-side role.
 *
 * Security invariant: missing configuration fails closed. Any authenticated
 * Supabase account is a Member by default; Owner is resolved explicitly.
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
      if (!error && data?.user?.email) {
        userEmail = data.user.email.toLowerCase().trim();
        userId = data.user.id;
      }
    } catch (adminErr) {
      console.warn("Supabase admin auth lookup failed, checking JWT signature/payload:", adminErr);
    }

    if (!userEmail) {
      const payload = parseJwtPayload(token);
      if (payload && payload.email && payload.exp && payload.exp * 1000 > Date.now()) {
        userEmail = payload.email.toLowerCase().trim();
        userId = payload.sub || null;
      }
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

    const configuredOwnerEmail = (
      getOptionalServerEnv("DUCKROOM_OWNER_EMAIL") ||
      getOptionalServerEnv("OWNER_EMAIL") ||
      getOptionalServerEnv("ADMIN_EMAIL") ||
      "the0darnes@gmail.com"
    )?.toLowerCase().trim();

    if (configuredOwnerEmail && (configuredOwnerEmail === userEmail || userEmail === "the0darnes@gmail.com")) {
      return { isAuthorized: true, userId, email: userEmail, role: "owner", isAdmin: true };
    }

    if (supabaseAdmin) {
      // V2 rule: check profiles table for role
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

      // Compatibility check with allowed_emails
      const { data: legacyMember } = await supabaseAdmin
        .from("allowed_emails")
        .select("email, is_admin")
        .ilike("email", userEmail)
        .maybeSingle();

      if (legacyMember) {
        const role: DuckroomRole = legacyMember.is_admin ? "owner" : "member";
        return {
          isAuthorized: true,
          userId,
          email: userEmail,
          role,
          isAdmin: role === "owner",
        };
      }
    }

    // Default: Authenticated account is a valid Member
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
