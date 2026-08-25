import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "./server-env";

/**
 * Server-side Supabase entry points.
 *
 * FAIL-CLOSED (hardening 2026-08-25): đã bỏ default URL/anon key hardcode
 * (trước đây chứa anon key thật — vi phạm §21.1). Admin client yêu cầu
 * SUPABASE_SERVICE_ROLE_KEY qua requireServerEnv — thiếu secrets là fail
 * với thông báo [SERVER_CONFIG] ngay từ đầu.
 *
 * Public client được re-export từ supabase-client.ts (lazy, fail-closed).
 */

export { supabase } from "./supabase-client";

let adminClient: SupabaseClient | null = null;

/**
 * Server-only Supabase client. Never exported as a singleton from a shared
 * module so the service-role secret cannot accidentally enter the client graph.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("[SUPABASE_CONFIG] Service-role client is server-only");
  }
  if (!adminClient) {
    const url =
      (typeof process !== "undefined"
        ? process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"]
        : undefined) || requireServerEnv("SUPABASE_URL");
    const serviceRoleKey = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}
