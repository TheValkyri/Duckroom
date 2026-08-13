import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  (typeof import.meta !== "undefined" && (import.meta.env?.VITE_SUPABASE_URL as string)) || "";
const supabaseAnonKey =
  (typeof import.meta !== "undefined" && (import.meta.env?.VITE_SUPABASE_ANON_KEY as string)) || "";

/** Browser-side Supabase client using public/anon key only */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
