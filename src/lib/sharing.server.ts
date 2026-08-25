import { createHash, randomBytes } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSupabaseAdmin } from "./supabase";
import { getS3ServerClient } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import { validateStorageKey } from "./auth-guard";

/**
 * SERVER-ONLY core of the capability-token share model.
 * NEVER import this module from client-reachable code: `node:crypto` at
 * module scope crashes the browser bundle (release blocker, fixed 2026-08-25
 * by splitting sharing.ts into this server core + client-safe RPC wrappers).
 *
 * Capability-token model (Master Plan §13):
 *
 * - A valid, unrevoked, unexpired token IS the capability to view its target.
 * - Guests may mint capabilities ONLY for public content.
 * - Members may additionally mint capabilities for playlists they own.
 * - Owners may mint capabilities for ANY visibility (curated private shares).
 * - Resolve time enforces exactly the same rule set against the stored
 *   creator identity, eliminating the historical create-vs-resolve policy
 *   contradiction that produced dead-on-arrival owner tokens.
 *
 * Tokens are never persisted. Only their SHA-256 hex digest (token_hash)
 * reaches the database, so a metadata leak cannot expose live share URLs.
 */

const TOKEN_BYTES = 16; // 128-bit entropy for long-lived unauthenticated capability URLs

function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves the deployment origin for canonical share URLs.
 *
 * Server-side precedence: explicit DUCKROOM_PUBLIC_ORIGIN override, then
 * Vercel's injected deployment domains. Client side uses the live origin.
 * Deliberately does NOT trust Host/X-Forwarded-* headers (host-header
 * injection surface).
 */
function originForShare(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  const explicit = process.env["DUCKROOM_PUBLIC_ORIGIN"]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const preview = process.env["VERCEL_URL"]?.trim();
  const production = process.env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim();
  const host = production || preview;
  if (host) return `https://${host.replace(/\/+$/, "")}`;
  return "https://duckroom.vercel.app";
}

type ShareActorContext = { auth?: { userId?: string | null; role?: string | null } | null };

export type ShareResourceType = "track" | "album" | "video" | "playlist";

export interface CreateShareLinkInput {
  resourceType: ShareResourceType;
  resourceId: string;
  expiresAt?: string | null | undefined;
}

async function getCreatorRole(db: ReturnType<typeof getSupabaseAdmin>, creatorId: string): Promise<string | null> {
  const { data: profile } = await db.from("profiles").select("role").eq("user_id", creatorId).maybeSingle();
  return (profile?.role as string | undefined) ?? null;
}

/** Create-time authorization gate shared by every resource type. */
async function assertCreatorMayMint(
  db: ReturnType<typeof getSupabaseAdmin>,
  actor: ShareActorContext["auth"],
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<void> {
  const userId = actor?.userId ?? null;
  const role = actor?.role ?? null;

  if (resourceType === "playlist") {
    if (!userId) {
      throw new Response(JSON.stringify({ error: "Chỉ thành viên mới có thể chia sẻ playlist." }), { status: 401 });
    }
    const { data: playlist } = await db
      .from("playlists")
      .select("id, user_id, is_public")
      .eq("id", resourceId)
      .maybeSingle();
    if (!playlist) throw new Error("Playlist không tồn tại.");
    const ownsPlaylist = playlist.user_id === userId;
    if (!ownsPlaylist && !playlist.is_public && role !== "owner") {
      throw new Error("Playlist không tồn tại hoặc chưa được chia sẻ công khai.");
    }
    return;
  }

  const table = resourceType === "track" ? "tracks" : resourceType === "album" ? "albums" : "videos";
  const { data: resource } = await db.from(table).select("id, visibility").eq("id", resourceId).maybeSingle();
  if (!resource) throw new Error("Nội dung không tồn tại.");
  if (resource["visibility"] !== "public" && role !== "owner") {
    throw new Error("Nội dung này chưa được công khai.");
  }
}

export async function createShareLinkInternal(
  data: CreateShareLinkInput,
  auth?: ShareActorContext["auth"],
): Promise<{ token: string; path: string }> {
  const db = getSupabaseAdmin();

  await assertCreatorMayMint(db, auth ?? null, data.resourceType, data.resourceId);

  const rawToken = generateShareToken();
  const { error } = await db.from("share_links").insert({
    token_hash: hashShareToken(rawToken),
    resource_type: data.resourceType,
    resource_id: data.resourceId,
    created_by: auth?.userId ?? null,
    expires_at: data.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
  return { token: rawToken, path: `/s/${rawToken}` };
}

export async function resolveShareLinkInternal(data: { token: string }) {
  const db = getSupabaseAdmin();
  const tokenHash = hashShareToken(data.token);

  const { data: share } = await db
    .from("share_links")
    .select("id, token_hash, resource_type, resource_id, created_by, expires_at, revoked_at, created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!share || share.revoked_at || (share.expires_at && new Date(share.expires_at).getTime() <= Date.now())) {
    // Indistinguishable response for missing/expired/revoked — avoids oracle.
    throw new Response("Share link expired or revoked", { status: 404 });
  }

  let resource: Record<string, any> | null = null;
  let storageKey: string | null = null;
  let artworkKey: string | null = null;

  if (share.resource_type === "track") {
    const result = await db
      .from("tracks")
      .select(
        "id,title,artist,album_id,year,format,bit_depth,sample_rate,duration_seconds,storage_key,cover_storage_key,lyrics,visibility,track_files(sample_rate,bit_depth,container,codec,duration_seconds,verified_at)",
      )
      .eq("id", share.resource_id)
      .maybeSingle();
    if (result.data) {
      const raw = result.data as Record<string, any>;
      const files = Array.isArray(raw["track_files"])
        ? raw["track_files"]
        : raw["track_files"]
          ? [raw["track_files"]]
          : [];
      const masterFile = files.find((f: any) => f.verified_at) ?? files[0];
      resource = {
        ...raw,
        format: masterFile?.container ?? masterFile?.codec ?? raw["format"],
        bit_depth: masterFile?.bit_depth ?? raw["bit_depth"],
        sample_rate: masterFile?.sample_rate ?? raw["sample_rate"],
        duration_seconds: masterFile?.duration_seconds ?? raw["duration_seconds"],
      };
    }
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
        "id,title,artist,year,thumb_storage_key,storage_key,duration_seconds,resolution,codec,bitrate,visibility,video_files(resolution,codec,duration_seconds,verified_at)",
      )
      .eq("id", share.resource_id)
      .maybeSingle();
    if (result.data) {
      const raw = result.data as Record<string, any>;
      const files = Array.isArray(raw["video_files"])
        ? raw["video_files"]
        : raw["video_files"]
          ? [raw["video_files"]]
          : [];
      const masterFile = files.find((f: any) => f.verified_at) ?? files[0];
      resource = {
        ...raw,
        resolution: masterFile?.resolution ?? raw["resolution"],
        codec: masterFile?.codec ?? raw["codec"],
        duration_seconds: masterFile?.duration_seconds ?? raw["duration_seconds"],
      };
    }
    storageKey = (result.data?.storage_key as string | undefined) ?? null;
    artworkKey = (result.data?.thumb_storage_key as string | undefined) ?? null;
  } else {
    const result = await db
      .from("playlists")
      .select(
        "id,name,description,is_public,user_id,created_at,playlist_tracks(position,tracks(id,title,artist,duration_seconds))",
      )
      .eq("id", share.resource_id)
      .maybeSingle();
    if (result.data) {
      const raw = result.data as Record<string, any>;
      const entries = Array.isArray(raw["playlist_tracks"]) ? (raw["playlist_tracks"] as any[]) : [];
      raw["playlist_tracks"] = entries
        .slice()
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
        .map((entry) => {
          const t = Array.isArray(entry.tracks) ? entry.tracks[0] : entry.tracks;
          return t
            ? {
                id: String(t.id),
                title: String(t.title ?? ""),
                artist: String(t.artist ?? ""),
                duration_seconds: t.duration_seconds,
              }
            : null;
        })
        .filter(Boolean);
    }
    resource = result.data ? (result.data as Record<string, any>) : null;
  }

  if (!resource) throw new Response("Shared resource not found", { status: 404 });

  // ---- Capability enforcement (mirrors mint-time rules exactly) ----
  const isPublicResource =
    share.resource_type === "playlist" ? resource["is_public"] === true : resource["visibility"] === "public";

  if (!isPublicResource) {
    let creatorMayMint = false;
    if (share.created_by) {
      const creatorRole = await getCreatorRole(db, share.created_by as string);
      const creatorIsOwner = creatorRole === "owner";
      const creatorOwnsPlaylist =
        share.resource_type === "playlist" && share.created_by === (resource["user_id"] as string);
      creatorMayMint = creatorIsOwner || creatorOwnsPlaylist;
    }
    if (!creatorMayMint) {
      throw new Response("Shared resource is not public", { status: 403 });
    }
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
    resource_type: share.resource_type,
    resource_id: share.resource_id,
    expires_at: share.expires_at,
    revoked_at: share.revoked_at,
    created_at: share.created_at,
    resource,
    mediaUrl,
    artworkUrl,
    canonicalUrl: `${originForShare()}/s/${data.token}`,
  };
}

export async function revokeShareLinkInternal(
  data: { token: string },
  auth?: ShareActorContext["auth"],
): Promise<{ success: boolean; token: string }> {
  const userId = auth?.userId;
  const db = getSupabaseAdmin();

  const { data: share } = await db
    .from("share_links")
    .select("id, created_by")
    .eq("token_hash", hashShareToken(data.token))
    .maybeSingle();
  if (!share) throw new Error("Share link không tồn tại");

  if (auth?.role !== "owner" && (!userId || share.created_by !== userId)) {
    throw new Response(JSON.stringify({ error: "Không có quyền hủy liên kết này" }), { status: 403 });
  }

  const { error } = await db
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashShareToken(data.token));

  if (error) throw new Error(error.message);
  return { success: true, token: data.token };
}
