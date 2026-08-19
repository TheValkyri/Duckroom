import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "./server-env";

const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env ? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined)?.trim() : undefined) ||
  (typeof process !== "undefined" && process.env ? (process.env["SUPABASE_URL"] as string | undefined)?.trim() : undefined) ||
  "https://lvrcqcghwebxlkrsisby.supabase.co";

const supabaseAnonKey =
  (typeof import.meta !== "undefined" && import.meta.env ? (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined)?.trim() : undefined) ||
  (typeof process !== "undefined" && process.env ? (process.env["SUPABASE_ANON_KEY"] as string | undefined)?.trim() : undefined) ||
  "";

/** Public/browser Supabase client. Only anon key is allowed here. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey || "dummy-anon-key");

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
    const url = (typeof process !== "undefined" && process.env ? (process.env["SUPABASE_URL"] as string | undefined)?.trim() : undefined) || supabaseUrl;
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
