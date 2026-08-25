import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalAuthMiddleware, requireMemberMiddleware, serverSecurityMiddleware } from "./auth-guard";

/**
 * CLIENT-SAFE share RPC wrappers (Master Plan §13).
 *
 * RELEASE-BLOCKER FIX (2026-08-25): this module previously held the whole
 * share implementation including a top-level `node:crypto` import. Client
 * components (TrackRow → share-client, s/$token) import these server-fn
 * stubs, so the node:crypto import reached the browser bundle and crashed
 * every page at module evaluation ("Module node:crypto has been
 * externalized for browser compatibility").
 *
 * All server internals now live in `sharing.server.ts` and are referenced
 * ONLY inside handler bodies, which the TanStack Start compiler strips from
 * the client bundle. Guard test: src/test/client-boundary.test.ts.
 */

type ShareActorContext = { auth?: { userId?: string | null; role?: string | null } | null };

/** Creates a shareable link (/s/:token). The raw token is returned exactly once. */
export const createShareLinkServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(
    z.object({
      resourceType: z.enum(["track", "album", "video", "playlist"]),
      resourceId: z.string().min(1),
      expiresAt: z.string().datetime().nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { createShareLinkInternal } = await import("./sharing.server");
    const auth = (context as ShareActorContext)?.auth;
    return createShareLinkInternal(data, auth);
  });

/** Resolves a shared link token with full capability re-enforcement. */
export const resolveShareLinkServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .validator(z.object({ token: z.string().min(8).max(128) }))
  .handler(async ({ data }) => {
    const { resolveShareLinkInternal } = await import("./sharing.server");
    return resolveShareLinkInternal(data);
  });

/** Revokes an existing share link (owner: any; member: own). */
export const revokeShareLinkServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator(z.object({ token: z.string().min(8) }))
  .handler(async ({ context, data }) => {
    const { revokeShareLinkInternal } = await import("./sharing.server");
    const auth = (context as ShareActorContext)?.auth;
    return revokeShareLinkInternal(data, auth);
  });
