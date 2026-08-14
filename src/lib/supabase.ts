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

const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cmNxY2dod2VieGxrcnNpc2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODczMjIsImV4cCI6MjEwMjE2MzMyMn0.TEUxf8buGs-2wTa78LU762-ymJKdXGUu_kRCXvOlmn4";

const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cmNxY2dod2VieGxrcnNpc2J5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjU4NzMyMiwiZXhwIjoyMTAyMTYzMzIyfQ.8G4haeWpmMu_m0SrJ2nsCugd2RlyDM4imuHLnCCnQpQ";

const supabaseAnonKey =
  getEnvVar("SUPABASE_ANON_KEY") ||
  getEnvVar("VITE_SUPABASE_ANON_KEY") ||
  DEFAULT_ANON_KEY;

const supabaseServiceKey =
  getEnvVar("SUPABASE_SERVICE_ROLE_KEY") ||
  getEnvVar("VITE_SUPABASE_SERVICE_ROLE_KEY") ||
  DEFAULT_SERVICE_ROLE_KEY;

/** Client phía browser/public */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Client phía server (Service Role - Quyền tối cao, CHỈ dùng phía Server) */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
