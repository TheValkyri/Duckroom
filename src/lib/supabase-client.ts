import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Public / browser-safe Supabase client.
 *
 * FAIL-CLOSED (hardening 2026-08-25): KHÔNG có default URL/key hardcode trong
 * source — trước đây anon key thật từng bị hardcode làm fallback, vi phạm
 * Master Plan §21.1 và lộ project ref khi push public. Client được tạo LAZY
 * qua Proxy: module import không bao giờ throw (tests/SSR an toàn), lần đầu
 * dùng mới kiểm tra env và fail với thông báo rõ ràng nếu thiếu.
 *
 * Module này cố ý KHÔNG import module server-only nào để giữ bundle sạch.
 */

interface CustomImportMetaEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

function readClientEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | undefined {
  const meta = typeof import.meta !== "undefined" ? (import.meta.env as unknown as CustomImportMetaEnv) : undefined;
  const fromMeta = meta?.[name];
  if (fromMeta) return fromMeta;
  // SSR/node fallback (nitro runtime cũng nhận VITE_ qua process.env khi build)
  if (typeof process !== "undefined") return process.env[name];
  return undefined;
}

function makeClient(): SupabaseClient {
  const url = readClientEnv("VITE_SUPABASE_URL");
  const anonKey = readClientEnv("VITE_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error(
      "[SUPABASE_CONFIG] Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
        "Khai báo trong .env (local) hoặc Environment Variables (Vercel) rồi build lại.",
    );
  }
  return createClient(url, anonKey);
}

let instance: SupabaseClient | null = null;

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    if (!instance) instance = makeClient();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});
