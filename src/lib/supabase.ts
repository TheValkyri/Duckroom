import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "./server-env";

const DEFAULT_SUPABASE_URL = "https://lvrcqcghwebxlkrsisby.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cmNxY2dod2VieGxrcnNpc2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODczMjIsImV4cCI6MjEwMjE2MzMyMn0.TEUxf8buGs-2wTa78LU762-ymJKdXGUu_kRCXvOlmn4";

interface CustomImportMetaEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

const customEnv = typeof import.meta !== "undefined" ? (import.meta.env as unknown as CustomImportMetaEnv) : undefined;

const supabaseUrl =
  customEnv?.VITE_SUPABASE_URL ||
  (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined) ||
  DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  customEnv?.VITE_SUPABASE_ANON_KEY ||
  (typeof process !== "undefined" ? process.env["SUPABASE_ANON_KEY"] : undefined) ||
  DEFAULT_ANON_KEY;

/** Public/browser Supabase client (Always initialized with valid public anon key) */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
    const url = (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined) || supabaseUrl;
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
