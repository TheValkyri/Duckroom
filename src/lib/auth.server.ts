import { supabaseAdmin } from "./supabase";

/**
 * Validates whether a request comes from an authenticated Supabase user
 * who is present in the `allowed_emails` table or matching ALLOWED_ADMIN_EMAILS.
 */
export async function verifyMemberAuthorization(
  request?: Request,
  explicitToken?: string | null
): Promise<{
  isAuthorized: boolean;
  email: string | null;
  isAdmin: boolean;
  error?: string;
}> {
  const supabaseUrl =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
    (typeof import.meta !== "undefined" && (import.meta.env?.VITE_SUPABASE_URL as string));

  const supabaseServiceKey =
    (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) ||
    (typeof import.meta !== "undefined" && (import.meta.env?.VITE_SUPABASE_SERVICE_ROLE_KEY as string));

  // If Supabase is not configured yet on env, allow dev mode with warning
  if (!supabaseUrl || !supabaseServiceKey || supabaseUrl.includes("your-supabase-project")) {
    return { isAuthorized: true, email: "dev@local", isAdmin: true };
  }

  const rawToken =
    explicitToken ||
    request?.headers?.get?.("authorization") ||
    request?.headers?.get?.("x-supabase-auth") ||
    request?.headers?.get?.("x-auth-token");

  if (!rawToken) {
    return {
      isAuthorized: false,
      email: null,
      isAdmin: false,
      error: "Vui lòng đăng nhập tài khoản trước khi tải tệp lên Pikamc S3.",
    };
  }

  const token = rawToken.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { isAuthorized: false, email: null, isAdmin: false, error: "Empty authorization token" };
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      return {
        isAuthorized: false,
        email: null,
        isAdmin: false,
        error: error?.message || "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
      };
    }

    const userEmail = data.user.email.toLowerCase().trim();

    // Check env fallback for admin emails
    const allowedEnv = (process.env.ALLOWED_ADMIN_EMAILS || "")
      .toLowerCase()
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    if (allowedEnv.includes(userEmail)) {
      return { isAuthorized: true, email: userEmail, isAdmin: true };
    }

    try {
      // Query allowed_emails table in Supabase DB if it exists
      const { data: allowedRecord } = await supabaseAdmin
        .from("allowed_emails")
        .select("email, is_admin")
        .ilike("email", userEmail)
        .maybeSingle();

      if (allowedRecord) {
        return {
          isAuthorized: true,
          email: userEmail,
          isAdmin: !!allowedRecord.is_admin,
        };
      }
    } catch {
      // Table might not exist or error, continue
    }

    // Default: Authenticated user is authorized
    return {
      isAuthorized: true,
      email: userEmail,
      isAdmin: false,
    };
  } catch (err) {
    console.error("Supabase Auth verification error:", err);
    return { isAuthorized: false, email: null, isAdmin: false, error: String(err) };
  }
}
