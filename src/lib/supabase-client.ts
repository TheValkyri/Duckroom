import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://lvrcqcghwebxlkrsisby.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cmNxY2dod2VieGxrcnNpc2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1ODczMjIsImV4cCI6MjEwMjE2MzMyMn0.TEUxf8buGs-2wTa78LU762-ymJKdXGUu_kRCXvOlmn4";

interface CustomImportMetaEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

const env = typeof import.meta !== "undefined" ? (import.meta.env as unknown as CustomImportMetaEnv) : undefined;

const supabaseUrl = env?.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

/**
 * Public / browser-safe Supabase client.
 * This module deliberately does NOT import any server-only modules
 * (server-env.ts, auth.server.ts, etc.) to keep the client bundle clean.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
