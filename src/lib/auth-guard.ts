import { createMiddleware } from "@tanstack/react-start";
import { verifyMemberAuthorization } from "./auth.server";
import { getAccessToken } from "./useAuth";

const ALLOWED_EXTENSIONS = new Set([
  "flac",
  "alac",
  "wav",
  "mp3",
  "m4a",
  "mp4",
  "mkv",
  "webm",
  "mov",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "vtt",
  "json",
]);

/**
 * Supported prefixes:
 * - Canonical V2: audio/, video/, artwork/, subtitles/, backups/
 * - Legacy compatibility: singles/, albums/, videos/, artworks/, covers/, library_manifest.json
 */
const ALLOWED_PREFIXES = [
  "audio/",
  "video/",
  "artwork/",
  "subtitles/",
  "backups/",
  "singles/",
  "albums/",
  "videos/",
  "artworks/",
  "covers/",
  "library_manifest.json",
];

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
 * Server middleware enforcing request integrity.
 */
export const serverSecurityMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  return next();
});

/**
 * Optional Auth middleware: resolves user identity if token provided, but allows Guest (unauthenticated) through.
 */
export const optionalAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const token = typeof window !== "undefined" ? await getAccessToken() : null;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      sendContext: { authToken: token },
    });
  })
  .server(async ({ next, context }) => {
    const passedToken = (context as { authToken?: string | null })?.authToken || null;
    let auth: import("./auth.server").AuthorizationResult = {
      isAuthorized: false,
      userId: null,
      email: null,
      role: null,
      isAdmin: false,
    };
    if (passedToken) {
      auth = await verifyMemberAuthorization(undefined, passedToken);
    }
    return next({ context: { auth } });
  });

/**
 * Server middleware enforcing REAL Supabase Auth Member Authorization.
 */
export const requireMemberMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const token = typeof window !== "undefined" ? await getAccessToken() : null;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      sendContext: {
        authToken: token,
      },
    });
  })
  .server(async ({ next, context }) => {
    const passedToken = (context as { authToken?: string | null })?.authToken || null;
    const auth = await verifyMemberAuthorization(undefined, passedToken);

    if (!auth.isAuthorized) {
      throw new Response(JSON.stringify({ error: auth.error || "Unauthorized: Member login required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return next({ context: { auth } });
  });

/**
 * Server middleware enforcing Owner role authorization for destructive/admin operations.
 */
export const requireOwnerMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const token = typeof window !== "undefined" ? await getAccessToken() : null;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      sendContext: { authToken: token },
    });
  })
  .server(async ({ next, context }) => {
    const passedToken = (context as { authToken?: string | null })?.authToken || null;
    const auth = await verifyMemberAuthorization(undefined, passedToken);
    if (!auth.isAuthorized) {
      throw new Response(JSON.stringify({ error: auth.error || "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (auth.role !== "owner") {
      throw new Response(JSON.stringify({ error: "Forbidden: Owner role required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return next({ context: { auth } });
  });
