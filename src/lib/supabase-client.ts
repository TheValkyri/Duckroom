import { createClient } from "@supabase/supabase-js";

function getEnvVar(name: string): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.[name]) {
    const val = import.meta.env[name] as string;
    if (val && typeof val === "string" && val.trim()) return val.trim();
  }
  if (typeof process !== "undefined" && process.env?.[name]) {
    const val = process.env[name] as string;
    if (val && typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}

const supabaseUrl =
  getEnvVar("VITE_SUPABASE_URL") ||
  getEnvVar("SUPABASE_URL") ||
  "https://lvrcqcghwebxlkrsisby.supabase.co";

const supabaseAnonKey =
  getEnvVar("VITE_SUPABASE_ANON_KEY") ||
  getEnvVar("SUPABASE_ANON_KEY") ||
  "dummy-anon-key";

/** Browser-side & SSR public Supabase client (safe against missing env) */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
