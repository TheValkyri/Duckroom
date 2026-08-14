import { createClient } from "@supabase/supabase-js";

function getEnvVar(name: string): string {
  if (typeof process !== "undefined" && process.env?.[name]) {
    const val = process.env[name] as string;
    if (val && typeof val === "string" && val.trim()) return val.trim();
  }
  if (typeof import.meta !== "undefined" && import.meta.env?.[`VITE_${name}`]) {
    const val = import.meta.env[`VITE_${name}`] as string;
    if (val && typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}

const supabaseUrl =
  getEnvVar("SUPABASE_URL") ||
  getEnvVar("VITE_SUPABASE_URL") ||
  "https://lvrcqcghwebxlkrsisby.supabase.co";

const supabaseAnonKey =
  getEnvVar("SUPABASE_ANON_KEY") ||
  getEnvVar("VITE_SUPABASE_ANON_KEY") ||
  "dummy-anon-key";

const supabaseServiceKey =
  getEnvVar("SUPABASE_SERVICE_ROLE_KEY") ||
  getEnvVar("VITE_SUPABASE_SERVICE_ROLE_KEY") ||
  "dummy-service-key";

/** Client phía browser/public */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Client phía server (Service Role - Quyền tối cao, CHỈ dùng phía Server) */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
