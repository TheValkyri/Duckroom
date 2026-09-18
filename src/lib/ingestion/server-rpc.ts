import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFreshOwnerMiddleware, serverSecurityMiddleware, uploadRateLimitMiddleware } from "../auth-guard";
import {
  approveUploadSessionInternal,
  cancelUploadSessionInternal,
  createUploadSessionInternal,
  getUploadPresignedUrlInternal,
  recoverUploadSessionForRetryInternal,
  retryStagingCleanupInternal,
} from "./session-lifecycle";
import { verifyAndAnalyzeServerUploadInternal } from "./verify-and-analyze";
import { finalizeIngestionCommitInternal } from "./commit";

export const createUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      expectedFilename: z.string().min(1),
      expectedSizeBytes: z.number().int().positive(),
      expectedMime: z.string().min(1),
      resourceKind: z.enum(["track", "video"]),
      clientSha256: z.string().length(64).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    if (!actorUserId) throw new Error("Unauthorized");
    return await createUploadSessionInternal(data, actorUserId);
  });

export const getUploadPresignedUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware, uploadRateLimitMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      includeArtwork: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await getUploadPresignedUrlInternal(data, actorUserId);
  });

export const verifyAndAnalyzeServerUpload = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      hasArtwork: z.boolean().optional(),
      clientAnalysis: z.any().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await verifyAndAnalyzeServerUploadInternal(data, actorUserId);
  });

export const approveUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      duplicateDecision: z.enum(["upload_anyway", "use_existing", "cancel"]).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await approveUploadSessionInternal(data, actorUserId);
  });

export const finalizeIngestionCommitServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      metadataOverrides: z
        .object({
          title: z.string().min(1).optional(),
          artist: z.string().optional(),
          albumId: z.string().nullable().optional(),
          albumTitle: z.string().optional(),
          year: z.number().int().optional(),
          trackNo: z.number().int().optional(),
          lyrics: z.array(z.object({ time: z.number(), text: z.string() })).optional(),
        })
        .optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await finalizeIngestionCommitInternal(data, actorUserId);
  });

export const retryStagingCleanupServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await retryStagingCleanupInternal(data, actorUserId);
  });

export const cancelUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await cancelUploadSessionInternal(data, actorUserId);
  });

export const recoverUploadSessionForRetryServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await recoverUploadSessionForRetryInternal(data, actorUserId);
  });
