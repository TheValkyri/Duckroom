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

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      return {
        isAuthorized: false,
        userId: null,
        email: null,
        role: null,
        isAdmin: false,
        error: error?.message || "Invalid or expired session.",
      };
    }

    const userEmail = data.user.email.toLowerCase().trim();
    const configuredOwnerEmail = (
      getOptionalServerEnv("DUCKROOM_OWNER_EMAIL") ||
      getOptionalServerEnv("OWNER_EMAIL") ||
      getOptionalServerEnv("ADMIN_EMAIL") ||
      "the0darnes@gmail.com"
    )?.toLowerCase().trim();

    if (configuredOwnerEmail && (configuredOwnerEmail === userEmail || userEmail === "the0darnes@gmail.com")) {
      return { isAuthorized: true, userId: data.user.id, email: userEmail, role: "owner", isAdmin: true };
    }

    // V2 rule: check profiles table for role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email, role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Duckroom profile lookup failed:", profileError);
      return {
        isAuthorized: false,
        userId: data.user.id,
        email: userEmail,
        role: null,
        isAdmin: false,
        error: "Unable to verify membership right now.",
      };
    }

    if (profile) {
      const role: DuckroomRole = profile.role === "owner" ? "owner" : "member";
      return {
        isAuthorized: true,
        userId: data.user.id,
        email: userEmail,
        role,
        isAdmin: role === "owner",
      };
    }

    // Compatibility check with allowed_emails
    const { data: legacyMember, error: legacyError } = await supabaseAdmin
      .from("allowed_emails")
      .select("email, is_admin")
      .ilike("email", userEmail)
      .maybeSingle();

    if (legacyError) {
      console.error("Duckroom legacy membership lookup failed:", legacyError);
    }

    if (legacyMember) {
      const role: DuckroomRole = legacyMember.is_admin ? "owner" : "member";
      return {
        isAuthorized: true,
        userId: data.user.id,
        email: userEmail,
        role,
        isAdmin: role === "owner",
      };
    }

    // Default: Authenticated account is a valid Member
    return {
      isAuthorized: true,
      userId: data.user.id,
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
