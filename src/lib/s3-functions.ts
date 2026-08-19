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
} from "./auth-guard";
import { BUCKET_NAME } from "./s3-constants";
export { BUCKET_NAME };

function requireEnv(name: string, fallback?: string): string {
  const val =
    (typeof process !== "undefined" && process.env?.[name]) ||
    (typeof import.meta !== "undefined" && (import.meta.env?.[`VITE_${name}`] as string));

  if (val && typeof val === "string" && val.trim()) {
    return val.trim();
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`[S3 Server Error] Missing required environment variable: ${name}`);
}

export function getS3ServerClient() {
  const endpoint = requireEnv("S3_ENDPOINT", "https://s3.pikamc.vn");
  const region = requireEnv("S3_REGION", "vn-hcm-1");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");

  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

/**
 * Server function to request a 15-minute presigned PUT upload URL.
 * Strictly OWNER ONLY.
 */
export const requestPresignedUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { key: string; contentType: string }) => {
    validateStorageKey(data.key);
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
 * Domain-driven Playback URL Resolver for Tracks:
 * Resolves trackId -> Supabase DB row -> checks visibility against user role -> signs storage_key for <= 900s.
 * Accessible by Guest (public tracks), Member (public/members tracks), Owner (all tracks).
 */
export const getTrackPlaybackUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    const db = getSupabaseAdmin();

    const { data: track, error } = await db
      .from("tracks")
      .select("id, storage_key, visibility")
      .eq("id", data.trackId)
      .maybeSingle();

    if (error || !track) {
      throw new Response(JSON.stringify({ error: "Track not found" }), { status: 404 });
    }

    const visibility = track.visibility || "public";
    if (visibility === "owner" && role !== "owner") {
      throw new Response(JSON.stringify({ error: "Forbidden: Owner-only track" }), { status: 403 });
    }
    if (visibility === "members" && role === "guest") {
      throw new Response(JSON.stringify({ error: "Unauthorized: Member login required" }), { status: 401 });
    }

    if (!track.storage_key) {
      throw new Response(JSON.stringify({ error: "Track has no storage key" }), { status: 404 });
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
  });

/**
 * Domain-driven Playback URL Resolver for Videos:
 * Resolves videoId -> Supabase DB row -> checks visibility -> signs storage_key for <= 900s.
 */
export const getVideoPlaybackUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ videoId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const role = (context as { auth?: { role?: string } })?.auth?.role || "guest";
    const db = getSupabaseAdmin();

    const { data: video, error } = await db
      .from("videos")
      .select("id, storage_key, visibility")
      .eq("id", data.videoId)
      .maybeSingle();

    if (error || !video) {
      throw new Response(JSON.stringify({ error: "Video not found" }), { status: 404 });
    }

    const visibility = video.visibility || "public";
    if (visibility === "owner" && role !== "owner") {
      throw new Response(JSON.stringify({ error: "Forbidden: Owner-only video" }), { status: 403 });
    }
    if (visibility === "members" && role === "guest") {
      throw new Response(JSON.stringify({ error: "Unauthorized: Member login required" }), { status: 401 });
    }

    if (!video.storage_key) {
      throw new Response(JSON.stringify({ error: "Video has no storage key" }), { status: 404 });
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
  });

/**
 * Public Asset URL Resolver (Artwork / Covers / Video Thumbs):
 * Signs public visual assets with 15-minute expiry (900s).
 */
export const getPublicAssetUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, optionalAuthMiddleware])
  .validator(z.object({ key: z.string().min(1) }))
  .handler(async ({ data }) => {
    validateStorageKey(data.key);
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: data.key,
      ResponseContentDisposition: "inline",
    });
    const assetUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { assetUrl, expiresIn: 900 };
  });

/**
 * Domain-driven Track Deletion:
 * Resolves track -> verifies Owner role -> physically deletes S3 audio & cover -> deletes DB row -> logs audit.
 * Strictly OWNER ONLY.
 */
export const deleteTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = (context as { auth?: { userId?: string | null } })?.auth?.userId;
    const db = getSupabaseAdmin();

    const { data: track, error: fetchErr } = await db
      .from("tracks")
      .select("id, title, storage_key, cover_storage_key")
      .eq("id", data.trackId)
      .maybeSingle();

    if (fetchErr || !track) {
      throw new Error(`Track ${data.trackId} not found`);
    }

    const s3 = getS3ServerClient();
    // Delete master audio file
    if (track.storage_key) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: track.storage_key }));
      } catch (err) {
        console.warn(`Could not delete S3 audio object ${track.storage_key}:`, err);
      }
    }
    // Delete artwork if track-specific
    if (track.cover_storage_key && track.cover_storage_key.startsWith("artworks/")) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: track.cover_storage_key }));
      } catch (err) {
        console.warn(`Could not delete S3 cover object ${track.cover_storage_key}:`, err);
      }
    }

    // Delete DB row
    const { error: delErr } = await db.from("tracks").delete().eq("id", data.trackId);
    if (delErr) throw new Error(`Failed to delete track row: ${delErr.message}`);

    // Audit log
    await db.from("audit_logs").insert({
      actor_user_id: userId,
      action: "track.delete",
      resource_type: "track",
      resource_id: data.trackId,
      metadata: { title: track.title, storage_key: track.storage_key },
    });

    return { success: true, trackId: data.trackId };
  });

/**
 * Domain-driven Video Deletion:
 * Resolves video -> verifies Owner role -> physically deletes S3 video & thumb -> deletes DB row -> logs audit.
 * Strictly OWNER ONLY.
 */
export const deleteVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ videoId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = (context as { auth?: { userId?: string | null } })?.auth?.userId;
    const db = getSupabaseAdmin();

    const { data: video, error: fetchErr } = await db
      .from("videos")
      .select("id, title, storage_key, thumb_storage_key")
      .eq("id", data.videoId)
      .maybeSingle();

    if (fetchErr || !video) {
      throw new Error(`Video ${data.videoId} not found`);
    }

    const s3 = getS3ServerClient();
    if (video.storage_key) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: video.storage_key }));
      } catch (err) {
        console.warn(`Could not delete S3 video object ${video.storage_key}:`, err);
      }
    }
    if (video.thumb_storage_key && video.thumb_storage_key.startsWith("artworks/")) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: video.thumb_storage_key }));
      } catch (err) {
        console.warn(`Could not delete S3 thumb object ${video.thumb_storage_key}:`, err);
      }
    }

    const { error: delErr } = await db.from("videos").delete().eq("id", data.videoId);
    if (delErr) throw new Error(`Failed to delete video row: ${delErr.message}`);

    await db.from("audit_logs").insert({
      actor_user_id: userId,
      action: "video.delete",
      resource_type: "video",
      resource_id: data.videoId,
      metadata: { title: video.title, storage_key: video.storage_key },
    });

    return { success: true, videoId: data.videoId };
  });

/**
 * Server function to delete an object physically from Pikamc S3 Bucket.
 * Strictly OWNER ONLY.
 */
export const deleteS3ObjectServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { key: string }) => {
    validateStorageKey(data.key);
    return data;
  })
  .handler(async ({ data }) => {
    try {
      const s3 = getS3ServerClient();
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: data.key,
      });
      await s3.send(command);
      return { success: true };
    } catch (err) {
      console.error("S3 Delete Object error:", err);
      return { success: false, error: String(err) };
    }
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
    return [];
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

/**
 * Server function to save library manifest json to Pikamc S3 Bucket.
 * Strictly OWNER ONLY.
 */
export const saveLibraryManifestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator((data: { jsonString: string }) => data)
  .handler(async ({ data }) => {
    try {
      const s3 = getS3ServerClient();
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "library_manifest.json",
        Body: data.jsonString,
        ContentType: "application/json",
      });
      await s3.send(command);
      return { success: true };
    } catch (err) {
      console.error("S3 Save Manifest error:", err);
      return { success: false };
    }
  });

/**
 * Server function to get library manifest json from Pikamc S3 Bucket.
 * Snapshot / recovery read only.
 */
export const getLibraryManifestServer = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: "library_manifest.json",
    });
    const res = await s3.send(command);
    const jsonString = await res.Body?.transformToString();
    if (!jsonString) return { manifest: null };
    return { manifest: JSON.parse(jsonString) };
  } catch (err) {
    return { manifest: null };
  }
});
