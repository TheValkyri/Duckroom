import { randomBytes } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { getS3ServerClient } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import {
  optionalAuthMiddleware,
  requireMemberMiddleware,
  serverSecurityMiddleware,
  validateStorageKey,
} from "./auth-guard";

function originForShare(request?: Request): string {
  return request?.headers.get("origin") || "https://duckroom.vercel.app";
}

/**
 * Creates a shareable link (/s/:token).
 * Allows Guests and Members to share public content.
 * Private playlists require ownership or public status.
 */
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
    const auth = (context as { auth?: { userId?: string | null; role?: string } })?.auth;
    const userId = auth?.userId || null;
    const db = getSupabaseAdmin();

    if (data.resourceType === "playlist") {
      if (!userId) {
        throw new Response(JSON.stringify({ error: "Chỉ thành viên mới có thể chia sẻ playlist." }), { status: 401 });
      }
      const { data: playlist } = await db
        .from("playlists")
        .select("id, user_id, is_public")
        .eq("id", data.resourceId)
        .maybeSingle();
      if (!playlist || (playlist.user_id !== userId && !playlist.is_public)) {
        throw new Error("Playlist không tồn tại hoặc chưa được chia sẻ công khai.");
      }
    } else {
      const table = data.resourceType === "track" ? "tracks" : data.resourceType === "album" ? "albums" : "videos";
      const { data: resource } = await db.from(table).select("id, visibility").eq("id", data.resourceId).maybeSingle();
      if (!resource) throw new Error("Nội dung không tồn tại.");
      if (resource["visibility"] !== "public" && auth?.role !== "owner") {
        throw new Error("Nội dung này chưa được công khai.");
      }
    }

    const token = randomBytes(12).toString("base64url");
    const { error } = await db.from("share_links").insert({
      token,
      resource_type: data.resourceType,
      resource_id: data.resourceId,
      created_by: userId,
      expires_at: data.expiresAt ?? null,
    });
    if (error) throw new Error(error.message);
    return { token, path: `/s/${token}` };
  });

/**
 * Resolves a shared link token.
 * Validates expiration, revocation status, resource visibility, and signs media on demand (15 min TTL).
 */
export const resolveShareLinkServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .validator(z.object({ token: z.string().min(8).max(64) }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const { data: share } = await db
      .from("share_links")
      .select("id, token, resource_type, resource_id, expires_at, revoked_at, created_at")
      .eq("token", data.token)
      .maybeSingle();

    if (!share || share.revoked_at || (share.expires_at && new Date(share.expires_at).getTime() <= Date.now())) {
      throw new Response("Share link expired or revoked", { status: 404 });
    }

    let resource: Record<string, any> | null = null;
    let storageKey: string | null = null;
    let artworkKey: string | null = null;

    if (share.resource_type === "track") {
      const result = await db
        .from("tracks")
        .select(
          "id,title,artist,album_id,year,format,bit_depth,sample_rate,duration_seconds,storage_key,cover_storage_key,lyrics,visibility",
        )
        .eq("id", share.resource_id)
        .maybeSingle();
      resource = result.data ? (result.data as Record<string, any>) : null;
      storageKey = (result.data?.storage_key as string | undefined) ?? null;
      artworkKey = (result.data?.cover_storage_key as string | undefined) ?? null;
    } else if (share.resource_type === "album") {
      const result = await db
        .from("albums")
        .select("id,title,artist,year,cover_storage_key,visibility")
        .eq("id", share.resource_id)
        .maybeSingle();
      resource = result.data ? (result.data as Record<string, any>) : null;
      artworkKey = (result.data?.cover_storage_key as string | undefined) ?? null;
    } else if (share.resource_type === "video") {
      const result = await db
        .from("videos")
        .select(
          "id,title,artist,year,thumb_storage_key,storage_key,duration_seconds,resolution,codec,bitrate,visibility",
        )
        .eq("id", share.resource_id)
        .maybeSingle();
      resource = result.data ? (result.data as Record<string, any>) : null;
      storageKey = (result.data?.storage_key as string | undefined) ?? null;
      artworkKey = (result.data?.thumb_storage_key as string | undefined) ?? null;
    } else {
      const result = await db
        .from("playlists")
        .select("id,name,description,is_public,user_id,created_at,playlist_tracks(track_id,position)")
        .eq("id", share.resource_id)
        .maybeSingle();
      resource = result.data ? (result.data as Record<string, any>) : null;
    }

    if (!resource) throw new Response("Shared resource not found", { status: 404 });
    if (
      (resource["visibility"] === "owner" || resource["visibility"] === "members") &&
      share.resource_type !== "playlist"
    ) {
      throw new Response("Shared resource is not public", { status: 403 });
    }
    if (share.resource_type === "playlist" && resource["is_public"] !== true) {
      throw new Response("Playlist is private", { status: 403 });
    }

    const s3 = getS3ServerClient();
    const sign = async (key: string | null, inline = false) => {
      if (!key) return null;
      validateStorageKey(key);
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          ...(inline ? { ResponseContentDisposition: "inline" } : {}),
        }),
        { expiresIn: 900 },
      );
    };

    const mediaUrl = await sign(storageKey, true);
    const artworkUrl = await sign(artworkKey);
    return {
      id: share.id,
      token: share.token,
      resource_type: share.resource_type,
      resource_id: share.resource_id,
      expires_at: share.expires_at,
      revoked_at: share.revoked_at,
      created_at: share.created_at,
      resource,
      mediaUrl,
      artworkUrl,
      canonicalUrl: `${originForShare()}/s/${share.token}`,
    };
  });

/**
 * Revokes an existing share link.
 * Owner can revoke any link; Members can revoke links they created.
 */
export const revokeShareLinkServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator(z.object({ token: z.string().min(8) }))
  .handler(async ({ context, data }) => {
    const auth = (context as { auth?: { userId?: string | null; role?: string } })?.auth;
    const userId = auth?.userId;
    const db = getSupabaseAdmin();

    const { data: share } = await db.from("share_links").select("id, created_by").eq("token", data.token).maybeSingle();
    if (!share) throw new Error("Share link không tồn tại");

    if (auth?.role !== "owner" && share.created_by !== userId) {
      throw new Response(JSON.stringify({ error: "Không có quyền hủy liên kết này" }), { status: 403 });
    }

    const { error } = await db
      .from("share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", data.token);

    if (error) throw new Error(error.message);
    return { success: true, token: data.token };
  });
