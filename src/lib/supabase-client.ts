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

const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cmNxY2dod2VieGxrcnNpc2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODczMjIsImV4cCI6MjEwMjE2MzMyMn0.TEUxf8buGs-2wTa78LU762-ymJKdXGUu_kRCXvOlmn4";

const supabaseAnonKey =
  getEnvVar("VITE_SUPABASE_ANON_KEY") ||
  getEnvVar("SUPABASE_ANON_KEY") ||
  DEFAULT_ANON_KEY;

/** Browser-side & SSR public Supabase client (safe against missing env) */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
