import { createMiddleware } from "@tanstack/react-start";
import { verifyMemberAuthorization } from "./auth.server";

const ALLOWED_EXTENSIONS = new Set([
  "flac",
  "alac",
  "wav",
  "mp3",
  "m4a",
  "mp4",
  "mkv",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

const ALLOWED_PREFIXES = ["singles/", "albums/", "videos/", "artworks/", "library_manifest.json"];

/**
 * Validates S3 storage object keys to prevent Path Traversal or arbitrary file creation.
 */
export function validateStorageKey(key: string): void {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("Invalid or missing storage key");
  }

  const cleanKey = key.trim();

  // Prevent path traversal
  if (cleanKey.includes("..") || cleanKey.startsWith("/") || cleanKey.includes("\\")) {
    throw new Error("Path traversal or illegal path characters detected in key");
  }

  // Enforce prefix policy
  const hasValidPrefix = ALLOWED_PREFIXES.some((prefix) => cleanKey.startsWith(prefix));
  if (!hasValidPrefix) {
    throw new Error(`Key prefix not authorized. Allowed prefixes: ${ALLOWED_PREFIXES.join(", ")}`);
  }

  // Validate extension if key is not library_manifest.json
  if (cleanKey !== "library_manifest.json") {
    const ext = cleanKey.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File extension .${ext} is not allowed.`);
    }
  }
}

/**
 * Server middleware enforcing request integrity & Origin validation.
 */
export const serverSecurityMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (request) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (origin && host) {
      const originHost = origin.replace(/^https?:\/\//, "");
      if (originHost !== host && !originHost.includes("localhost") && !originHost.includes("vercel.app")) {
        throw new Response("Forbidden: Origin mismatch", { status: 403 });
      }
    }
  }

  return next();
});

import { getAccessToken } from "./useAuth";

/**
 * Server middleware enforcing REAL Supabase Auth & allowed_emails Authorization.
 */
export const requireMemberMiddleware = createMiddleware()
  .client(async ({ next }) => {
    const token = typeof window !== "undefined" ? await getAccessToken() : null;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  })
  .server(async ({ next, request }) => {
    const auth = await verifyMemberAuthorization(request);

    if (!auth.isAuthorized) {
      throw new Response(
        JSON.stringify({ error: auth.error || "Unauthorized: Member email required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    return next({ context: { auth } });
  });

