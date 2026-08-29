import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import {
  optionalAuthMiddleware,
  requireOwnerMiddleware,
  serverSecurityMiddleware,
  validateStorageKey,
  validateVisualAssetKey,
} from "./auth-guard";
import { getOptionalServerEnv, requireServerEnv } from "./server-env";
import { BUCKET_NAME } from "./s3-constants";
export { BUCKET_NAME };

export function getS3ServerClient() {
  const endpoint = getOptionalServerEnv("S3_ENDPOINT") || "https://s3.pikamc.vn";
  const region = getOptionalServerEnv("S3_REGION") || "vn-hcm-1";
  const accessKeyId = requireServerEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireServerEnv("S3_SECRET_ACCESS_KEY");

  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 2,
    // Fix 2026-08-25 (403 playback + ERR_HTTP2_PROTOCOL_ERROR khi upload):
    // SDK v3.729+ mặc định "WHEN_SUPPORTED" — gắn x-amz-checksum-mode=ENABLED
    // vào presigned GET và yêu cầu checksum header cho presigned PUT. S3
    // compatible (Pikamc) tính chữ ký trên TOÀN BỘ query → chữ ký lệch →
    // 403 mọi ảnh bìa/nhạc, và PUT upload bị ngắt stream giữa chừng.
    // "WHEN_REQUIRED" chỉ thêm checksum khi bucket thực sự yêu cầu.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Server function to request a 15-minute presigned PUT upload URL.
 * Strictly OWNER ONLY.
 */
export const requestPresignedUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { key: string; contentType: string }) => {
    validateStorageKey(data.key, "write");
    return data;
  })
  .handler(async ({ data }) => {
    const s3 = getS3ServerClient();
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: data.key,
      ContentType: data.contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { uploadUrl };
  });

/**
 * Internal domain helper to resolve track playback URL with visibility enforcement
 */
export async function getTrackPlaybackUrlInternal(
  trackId: string,
  role = "guest",
): Promise<{ playbackUrl: string; expiresIn: number }> {
  const db = getSupabaseAdmin();
  const { data: track, error } = await db
    .from("tracks")
    .select("id, storage_key, visibility")
    .eq("id", trackId)
    .maybeSingle();

  if (error || !track) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Track not found", 404);
  }

  const visibility = track.visibility || "public";
  if (visibility === "owner" && role !== "owner") {
    throw new StorageOperationError("FORBIDDEN", "Forbidden: Owner-only track", 403);
  }
  if (visibility === "members" && role === "guest") {
    throw new StorageOperationError("UNAUTHORIZED", "Unauthorized: Member login required", 401);
  }

  if (!track.storage_key) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Track has no storage key", 404);
  }

  validateStorageKey(track.storage_key);
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: track.storage_key,
    ResponseContentDisposition: "inline",
  });
  const playbackUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { playbackUrl, expiresIn: 900 };
}

/**
 * Domain-driven Playback URL Resolver for Tracks Server RPC:
 * Resolves trackId -> Supabase DB row -> checks visibility against user role -> signs storage_key for <= 900s.
 */
export const getTrackPlaybackUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    return await getTrackPlaybackUrlInternal(data.trackId, role);
  });

/**
 * Internal domain helper to resolve video playback URL with visibility enforcement
 */
export async function getVideoPlaybackUrlInternal(
  videoId: string,
  role = "guest",
): Promise<{ playbackUrl: string; expiresIn: number }> {
  const db = getSupabaseAdmin();
  const { data: video, error } = await db
    .from("videos")
    .select("id, storage_key, visibility")
    .eq("id", videoId)
    .maybeSingle();

  if (error || !video) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Video not found", 404);
  }

  const visibility = video.visibility || "public";
  if (visibility === "owner" && role !== "owner") {
    throw new StorageOperationError("FORBIDDEN", "Forbidden: Owner-only video", 403);
  }
  if (visibility === "members" && role === "guest") {
    throw new StorageOperationError("UNAUTHORIZED", "Unauthorized: Member login required", 401);
  }

  if (!video.storage_key) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Video has no storage key", 404);
  }

  validateStorageKey(video.storage_key);
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: video.storage_key,
    ResponseContentDisposition: "inline",
  });
  const playbackUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { playbackUrl, expiresIn: 900 };
}

/**
 * Domain-driven Playback URL Resolver for Videos Server RPC:
 * Resolves videoId -> Supabase DB row -> checks visibility -> signs storage_key for <= 900s.
 */
export const getVideoPlaybackUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ videoId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    return await getVideoPlaybackUrlInternal(data.videoId, role);
  });

/**
 * Internal domain helper to resolve track artwork URL with visibility enforcement
 */
export async function getTrackArtworkUrlInternal(
  trackId: string,
  role = "guest",
): Promise<{ assetUrl: string; expiresIn: number }> {
  const db = getSupabaseAdmin();
  const { data: track, error } = await db
    .from("tracks")
    .select("id, cover_storage_key, visibility")
    .eq("id", trackId)
    .maybeSingle();

  if (error || !track) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Track not found", 404);
  }

  const visibility = track.visibility || "public";
  if (visibility === "owner" && role !== "owner") {
    throw new StorageOperationError("FORBIDDEN", "Forbidden: Owner-only track artwork", 403);
  }
  if (visibility === "members" && role === "guest") {
    throw new StorageOperationError("UNAUTHORIZED", "Unauthorized: Member login required", 401);
  }

  if (!track.cover_storage_key) {
    return { assetUrl: "", expiresIn: 900 };
  }

  validateVisualAssetKey(track.cover_storage_key);
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: track.cover_storage_key,
    ResponseContentDisposition: "inline",
  });
  const assetUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { assetUrl, expiresIn: 900 };
}

/**
 * Domain-driven Artwork URL Resolver for Tracks Server RPC:
 * Resolves trackId -> Supabase DB row -> checks visibility against user role -> signs cover_storage_key for <= 900s.
 */
export const getTrackArtworkUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    return await getTrackArtworkUrlInternal(data.trackId, role);
  });

/**
 * Internal domain helper to resolve album artwork URL with visibility enforcement
 */
export async function getAlbumArtworkUrlInternal(
  albumId: string,
  role = "guest",
): Promise<{ assetUrl: string; expiresIn: number }> {
  const db = getSupabaseAdmin();
  const { data: album, error } = await db
    .from("albums")
    .select("id, cover_storage_key, visibility")
    .eq("id", albumId)
    .maybeSingle();

  if (error || !album) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Album not found", 404);
  }

  const visibility = album.visibility || "public";
  if (visibility === "owner" && role !== "owner") {
    throw new StorageOperationError("FORBIDDEN", "Forbidden: Owner-only album artwork", 403);
  }
  if (visibility === "members" && role === "guest") {
    throw new StorageOperationError("UNAUTHORIZED", "Unauthorized: Member login required", 401);
  }

  if (!album.cover_storage_key) {
    return { assetUrl: "", expiresIn: 900 };
  }

  validateVisualAssetKey(album.cover_storage_key);
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: album.cover_storage_key,
    ResponseContentDisposition: "inline",
  });
  const assetUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { assetUrl, expiresIn: 900 };
}

/**
 * Domain-driven Artwork URL Resolver for Albums Server RPC:
 * Resolves albumId -> Supabase DB row -> checks visibility against user role -> signs cover_storage_key for <= 900s.
 */
export const getAlbumArtworkUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ albumId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    return await getAlbumArtworkUrlInternal(data.albumId, role);
  });

/**
 * Internal domain helper to resolve video thumbnail URL with visibility enforcement
 */
export async function getVideoThumbnailUrlInternal(
  videoId: string,
  role = "guest",
): Promise<{ assetUrl: string; expiresIn: number }> {
  const db = getSupabaseAdmin();
  const { data: video, error } = await db
    .from("videos")
    .select("id, thumb_storage_key, visibility")
    .eq("id", videoId)
    .maybeSingle();

  if (error || !video) {
    throw new StorageOperationError("RESOURCE_NOT_FOUND", "Video not found", 404);
  }

  const visibility = video.visibility || "public";
  if (visibility === "owner" && role !== "owner") {
    throw new StorageOperationError("FORBIDDEN", "Forbidden: Owner-only video thumbnail", 403);
  }
  if (visibility === "members" && role === "guest") {
    throw new StorageOperationError("UNAUTHORIZED", "Unauthorized: Member login required", 401);
  }

  if (!video.thumb_storage_key) {
    return { assetUrl: "", expiresIn: 900 };
  }

  validateVisualAssetKey(video.thumb_storage_key);
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: video.thumb_storage_key,
    ResponseContentDisposition: "inline",
  });
  const assetUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { assetUrl, expiresIn: 900 };
}

/**
 * Domain-driven Thumbnail URL Resolver for Videos Server RPC:
 * Resolves videoId -> Supabase DB row -> checks visibility against user role -> signs thumb_storage_key for <= 900s.
 */
export const getVideoThumbnailUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ videoId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    return await getVideoThumbnailUrlInternal(data.videoId, role);
  });

/**
 * Internal domain helper to delete a track safely:
 * Resolves track -> physically deletes S3 audio & cover -> deletes DB row -> logs audit.
 * Strict failure safety: If S3 master deletion fails, DB row is NOT deleted and error is thrown.
 */
export async function deleteTrackDomainInternal(
  trackId: string,
  expectedVersion: number,
  userId?: string | null,
): Promise<{ success: boolean; trackId: string }> {
  const db = getSupabaseAdmin();
  const { data: track, error: fetchErr } = await db
    .from("tracks")
    .select("id, title, storage_key, cover_storage_key, version")
    .eq("id", trackId)
    .maybeSingle();

  if (fetchErr || !track) throw new Error(`Track ${trackId} not found`);

  const cleanupKeys = [track.storage_key].filter(
    (key): key is string => typeof key === "string" && key.trim().length > 0,
  );
  const { data: debt, error: debtErr } = await db
    .from("storage_cleanup_debts")
    .insert({
      resource_type: "track",
      resource_id: trackId,
      storage_keys: cleanupKeys,
      actor_user_id: userId ?? null,
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (debtErr || !debt)
    throw new Error(`[CLEANUP_DEBT_CREATE_FAILED] ${debtErr?.message || "Unable to create cleanup debt"}`);

  // Delete the canonical DB row first. This guarantees that a subsequent S3 failure
  // can only leave an unreachable orphan object, never a broken DB -> S3 reference.
  const { data: deletedTrack, error: delErr } = await db
    .from("tracks")
    .delete()
    .eq("id", trackId)
    .eq("version", expectedVersion)
    .select("id")
    .maybeSingle();

  if (delErr || !deletedTrack) {
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "failed",
        last_error: delErr?.message || `Stale revision: expected version ${expectedVersion}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
    if (delErr) throw new Error(`Failed to delete track row: ${delErr.message}`);
    throw new Error(`Stale revision: Track ${trackId} was not deleted because its version changed.`);
  }

  const s3 = getS3ServerClient();
  try {
    if (track.storage_key) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: track.storage_key }));
    }
    // Track artwork is intentionally NOT hard-deleted here. It may be shared and is
    // reclaimed only by the owner-controlled orphan scanner.
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
    throw new Error(`S3 cleanup failed for track ${trackId}; DB deletion is committed and cleanup debt is durable.`);
  }

  await db.from("audit_logs").insert({
    actor_user_id: userId,
    action: "track.delete",
    resource_type: "track",
    resource_id: trackId,
    metadata: { title: track.title, storage_key: track.storage_key, cleanup_debt_id: debt.id },
  });

  return { success: true, trackId };
}

/**
 * Domain-driven Track Deletion Server RPC:
 * Strictly OWNER ONLY.
 */
export const deleteTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ trackId: z.string().min(1), expectedVersion: z.number().int().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = (context as { auth?: { userId?: string | null } })?.auth?.userId;
    return await deleteTrackDomainInternal(data.trackId, data.expectedVersion, userId);
  });

/**
 * Internal domain helper to delete a video safely:
 * Resolves video -> physically deletes S3 video & thumb -> deletes DB row -> logs audit.
 * Strict failure safety: If S3 video deletion fails, DB row is NOT deleted and error is thrown.
 */
export async function deleteVideoDomainInternal(
  videoId: string,
  expectedVersion: number,
  userId?: string | null,
): Promise<{ success: boolean; videoId: string }> {
  const db = getSupabaseAdmin();
  const { data: video, error: fetchErr } = await db
    .from("videos")
    .select("id, title, storage_key, thumb_storage_key, version")
    .eq("id", videoId)
    .maybeSingle();

  if (fetchErr || !video) throw new Error(`Video ${videoId} not found`);

  const cleanupKeys = [video.storage_key].filter(
    (key): key is string => typeof key === "string" && key.trim().length > 0,
  );
  const { data: debt, error: debtErr } = await db
    .from("storage_cleanup_debts")
    .insert({
      resource_type: "video",
      resource_id: videoId,
      storage_keys: cleanupKeys,
      actor_user_id: userId ?? null,
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (debtErr || !debt)
    throw new Error(`[CLEANUP_DEBT_CREATE_FAILED] ${debtErr?.message || "Unable to create cleanup debt"}`);

  const { data: deletedVideo, error: delErr } = await db
    .from("videos")
    .delete()
    .eq("id", videoId)
    .eq("version", expectedVersion)
    .select("id")
    .maybeSingle();

  if (delErr || !deletedVideo) {
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "failed",
        last_error: delErr?.message || `Stale revision: expected version ${expectedVersion}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
    if (delErr) throw new Error(`Failed to delete video row: ${delErr.message}`);
    throw new Error(`Stale revision: Video ${videoId} was not deleted because its version changed.`);
  }

  const s3 = getS3ServerClient();
  try {
    if (video.storage_key) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: video.storage_key }));
    }
    // Video artwork/thumbs are intentionally left to the owner orphan scanner.
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("storage_cleanup_debts")
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", debt.id);
    throw new Error(`S3 cleanup failed for video ${videoId}; DB deletion is committed and cleanup debt is durable.`);
  }

  await db.from("audit_logs").insert({
    actor_user_id: userId,
    action: "video.delete",
    resource_type: "video",
    resource_id: videoId,
    metadata: { title: video.title, storage_key: video.storage_key, cleanup_debt_id: debt.id },
  });

  return { success: true, videoId };
}

/**
 * Domain-driven Video Deletion Server RPC:
 * Strictly OWNER ONLY.
 */
export const deleteVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ videoId: z.string().min(1), expectedVersion: z.number().int().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = (context as { auth?: { userId?: string | null } })?.auth?.userId;
    return await deleteVideoDomainInternal(data.videoId, data.expectedVersion, userId);
  });

/**
 * Internal server helper to delete an object physically from S3 without going through RPC middleware.
 */
export async function deleteS3ObjectInternal(key: string): Promise<boolean> {
  try {
    validateStorageKey(key);
    const s3 = getS3ServerClient();
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await s3.send(command);
    return true;
  } catch (err) {
    console.error(`S3 Delete Object error for ${key}:`, err);
    return false;
  }
}

/**
 * Server function to delete an object physically from Pikamc S3 Bucket.
 * Strictly OWNER ONLY.
 */
export const deleteS3ObjectServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { key: string }) => {
    validateStorageKey(data.key, "read");
    return data;
  })
  .handler(async ({ data }) => {
    const success = await deleteS3ObjectInternal(data.key);
    return { success };
  });

/**
 * Internal server helper to list all keys in S3 without going through RPC middleware.
 */
export async function listS3ObjectsInternal(): Promise<string[]> {
  try {
    const s3 = getS3ServerClient();
    const allKeys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        ContinuationToken: continuationToken,
      });
      const res = await s3.send(command);
      const keys = (res.Contents || []).map((item) => item.Key).filter(Boolean) as string[];
      allKeys.push(...keys);
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return allKeys;
  } catch (err) {
    console.error("S3 List Objects error:", err);
    throw new Error(`S3 storage listing unavailable: ${err instanceof Error ? err.message : "Storage error"}`);
  }
}

/**
 * Server function to list ALL keys in Pikamc S3 Bucket with pagination support.
 * Strictly OWNER ONLY.
 */
export const listS3ObjectsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const keys = await listS3ObjectsInternal();
    return { keys };
  });

export class StorageOperationError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 500) {
    super(`[${code}] ${message}`);
    this.name = "StorageOperationError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Internal server helper to save library manifest to S3 without going through RPC middleware.
 */
export async function saveLibraryManifestInternal(jsonString: string): Promise<boolean> {
  const s3 = getS3ServerClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: "library_manifest.json",
    Body: jsonString,
    ContentType: "application/json",
  });
  try {
    await s3.send(command);
    return true;
  } catch (err: any) {
    console.error("[Duckroom Storage] Manifest save S3 failure:", err);
    throw new StorageOperationError(
      "STORAGE_UNAVAILABLE",
      `S3 save manifest failed: ${err?.message || "Storage error"}`,
      503,
    );
  }
}

/**
 * Server function to save library manifest json to Pikamc S3 Bucket.
 * Strictly OWNER ONLY (Recovery/Snapshot artifact).
 */
export const saveLibraryManifestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { jsonString: string }) => data)
  .handler(async ({ data }) => {
    const success = await saveLibraryManifestInternal(data.jsonString);
    return { success };
  });

/**
 * Server function to get a short-lived preview signed URL for any orphan object on S3.
 * Strictly OWNER ONLY.
 */
export const getOrphanPreviewUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ key: z.string().min(1) }))
  .handler(async ({ data }) => {
    validateStorageKey(data.key);
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: data.key,
      ResponseContentDisposition: "inline",
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { url, key: data.key };
  });

/**
 * Internal server helper to retrieve library manifest with structured error semantics:
 * - 404 / NoSuchKey -> throws StorageOperationError with code 'MANIFEST_NOT_FOUND'
 * - S3 unreachable / network -> throws StorageOperationError with code 'STORAGE_UNAVAILABLE'
 * - Corrupt JSON syntax -> throws StorageOperationError with code 'MANIFEST_CORRUPT'
 */
export async function getLibraryManifestInternal(): Promise<any> {
  const s3 = getS3ServerClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: "library_manifest.json",
  });

  let res;
  try {
    res = await s3.send(command);
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      throw new StorageOperationError("MANIFEST_NOT_FOUND", "library_manifest.json not found on storage", 404);
    }
    console.error("[Duckroom Storage] S3 Manifest read failure:", err);
    throw new StorageOperationError(
      "STORAGE_UNAVAILABLE",
      `S3 storage unreachable: ${err?.message || "Storage error"}`,
      503,
    );
  }

  let jsonString: string | undefined;
  try {
    jsonString = await res.Body?.transformToString();
  } catch (err: any) {
    throw new StorageOperationError(
      "STORAGE_UNAVAILABLE",
      `Failed to stream manifest body: ${err?.message || "Stream error"}`,
      503,
    );
  }

  if (!jsonString || !jsonString.trim()) {
    throw new StorageOperationError("MANIFEST_NOT_FOUND", "library_manifest.json is empty", 404);
  }

  try {
    return JSON.parse(jsonString);
  } catch (parseErr: any) {
    console.error("[Duckroom Storage] Manifest corrupt JSON:", parseErr);
    throw new StorageOperationError(
      "MANIFEST_CORRUPT",
      `library_manifest.json contains corrupt JSON syntax: ${parseErr?.message}`,
      500,
    );
  }
}

/**
 * Server function to get library manifest json from Pikamc S3 Bucket.
 * Strictly OWNER ONLY (Recovery/Snapshot read only).
 */
export const getLibraryManifestServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const manifest = await getLibraryManifestInternal();
    return { manifest };
  });
