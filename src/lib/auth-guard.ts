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
 * Canonical V2 Writable Prefixes:
 * - audio/: Canonical lossless audio masters
 * - video/: Canonical video masters
 * - artwork/: Canonical visual artwork and covers
 * - temp/upload-sessions/: Temporary atomic ingestion staging
 */
export const CANONICAL_WRITE_PREFIXES = ["audio/", "video/", "artwork/", "temp/upload-sessions/"];

/**
 * Legacy prefixes permitted strictly for read-compatibility of historical S3 objects.
 */
export const LEGACY_READ_PREFIXES = [
  "singles/",
  "albums/",
  "videos/",
  "artworks/",
  "covers/",
  "thumbnails/",
  "avatars/",
  "backups/",
  "staging/",
  "temp/",
  "subtitles/",
  "library_manifest.json",
];

const ALL_ALLOWED_READ_PREFIXES = [...CANONICAL_WRITE_PREFIXES, ...LEGACY_READ_PREFIXES];

/**
 * Validates S3 storage object keys to prevent Path Traversal or arbitrary file creation.
 * Enforces canonical write namespaces for new writes, and allows legacy read prefixes for existing objects.
 */
export function validateStorageKey(key: string, mode: "read" | "write" = "read"): void {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("Invalid or missing storage key");
  }

  const cleanKey = key.trim();

  // Prevent path traversal
  if (cleanKey.includes("..") || cleanKey.startsWith("/") || cleanKey.includes("\\")) {
    throw new Error("Path traversal or illegal path characters detected in key");
  }

  if (mode === "write") {
    const hasCanonicalPrefix = CANONICAL_WRITE_PREFIXES.some((prefix) => cleanKey.startsWith(prefix));
    if (!hasCanonicalPrefix) {
      throw new Error(
        `Write rejected: Key "${cleanKey}" is not in an authorized canonical write namespace (${CANONICAL_WRITE_PREFIXES.join(", ")}).`,
      );
    }
  } else {
    const isRootFile = !cleanKey.includes("/");
    const hasValidPrefix = ALL_ALLOWED_READ_PREFIXES.some((prefix) => cleanKey.startsWith(prefix));
    if (!hasValidPrefix && !isRootFile) {
      throw new Error(`Key prefix not authorized. Allowed prefixes: ${ALL_ALLOWED_READ_PREFIXES.join(", ")}`);
    }
  }

  // Validate extension if key is not library_manifest.json
  if (cleanKey !== "library_manifest.json") {
    const ext = cleanKey.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File extension .${ext} is not allowed.`);
    }
  }
}

const CANONICAL_VISUAL_WRITE_PREFIXES = ["artwork/"];
const ALLOWED_VISUAL_READ_PREFIXES = ["artwork/", "artworks/", "covers/", "thumbnails/", "avatars/", "temp/"];
const ALLOWED_VISUAL_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"]);

/**
 * Validates that an S3 key belongs strictly to public visual assets (artwork, covers, thumbnails).
 * Master audio, video, backups, and manifests are strictly rejected.
 */
export function validateVisualAssetKey(key: string, mode: "read" | "write" = "read"): void {
  validateStorageKey(key, mode);
  const cleanKey = key.trim();
  const prefixes = mode === "write" ? CANONICAL_VISUAL_WRITE_PREFIXES : ALLOWED_VISUAL_READ_PREFIXES;
  const hasValidVisualPrefix = prefixes.some((prefix) => cleanKey.startsWith(prefix));
  if (!hasValidVisualPrefix) {
    throw new Error(`Access Denied: Key "${cleanKey}" is not in an authorized visual asset namespace.`);
  }
  const ext = cleanKey.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_VISUAL_EXTENSIONS.has(ext)) {
    throw new Error(`Access Denied: File extension .${ext} is not an authorized visual asset format.`);
  }
}

import { requireServerEnv } from "./server-env";

/**
 * Server security middleware verifying backend configuration and server environment invariants.
 * Fails closed immediately if server security secrets are unconfigured.
 */
export const serverSecurityMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");
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
