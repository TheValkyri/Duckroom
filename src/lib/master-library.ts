import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { getS3ServerClient } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateStorageKey } from "./auth-guard";
import { extractS3KeyFromUrl } from "./s3-key";

const lyricLine = z.object({ time: z.number().finite(), text: z.string() });
const trackSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artist: z.string(),
  albumId: z.string().nullable().optional(),
  duration: z.number().finite().min(0),
  trackNo: z.number().int().min(0),
  format: z.string(),
  bitDepth: z.number().finite().min(0),
  sampleRate: z.number().finite().min(0),
  sizeMB: z.number().finite().min(0),
  src: z.string().optional(),
  cover: z.string().optional(),
  year: z.number().int().optional(),
  lyrics: z.array(lyricLine).default([]),
});
const albumSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artist: z.string(),
  year: z.number().int(),
  cover: z.string(),
  accent: z.string(),
  note: z.string(),
});
const videoSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artist: z.string(),
  year: z.number().int(),
  thumb: z.string(),
  duration: z.number().finite().min(0),
  resolution: z.string(),
  codec: z.string(),
  bitrate: z.string(),
  sizeMB: z.number().finite().min(0),
  src: z.string().optional(),
});

function keyFromValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const extracted = extractS3KeyFromUrl(value);
  if (extracted) return extracted;
  return value.startsWith("http") ? null : value;
}

/**
 * True Replace Semantics for Canonical Master Library:
 * - Upserts incoming records.
 * - Reconciles deletions by removing records from DB that are no longer in the master set.
 * - Strictly OWNER ONLY.
 */
export interface ReplaceMasterLibraryInput {
  tracks: z.infer<typeof trackSchema>[];
  albums: z.infer<typeof albumSchema>[];
  videos: z.infer<typeof videoSchema>[];
  allowMassDeletion: boolean;
  expectedLibraryRevision: number;
}

export async function replaceMasterLibraryInternal(data: ReplaceMasterLibraryInput, actorUserId?: string) {
  const db = getSupabaseAdmin();

  const trackRows = data.tracks.map((track) => ({
    id: track.id,
    album_id: track.albumId && track.albumId !== "singles" ? track.albumId : null,
    title: track.title,
    artist: track.artist,
    track_no: track.trackNo,
    duration_seconds: Math.round(track.duration),
    format: track.format || "UNKNOWN",
    bit_depth: Math.round(track.bitDepth) || 0,
    sample_rate: track.sampleRate || 0,
    size_mb: track.sizeMB || 0,
    storage_key: keyFromValue(track.src) ?? "",
    cover_storage_key: keyFromValue(track.cover),
    year: track.year ?? null,
    lyrics: track.lyrics,
  }));

  const albumRows = data.albums.map((album) => ({
    id: album.id,
    title: album.title,
    artist: album.artist,
    year: album.year,
    cover_storage_key: keyFromValue(album.cover) ?? "",
    accent: album.accent,
    note: album.note,
  }));

  const videoRows = data.videos.map((video) => ({
    id: video.id,
    title: video.title,
    artist: video.artist,
    year: video.year,
    thumb_storage_key: keyFromValue(video.thumb) ?? "",
    storage_key: keyFromValue(video.src) ?? "",
    duration_seconds: Math.round(video.duration),
    resolution: video.resolution || "UNKNOWN",
    codec: video.codec || "UNKNOWN",
    bitrate: video.bitrate || "UNKNOWN",
    size_mb: video.sizeMB || 0,
  }));

  const { data: result, error } = await db.rpc("replace_master_library_atomic", {
    p_albums: albumRows,
    p_tracks: trackRows,
    p_videos: videoRows,
    p_allow_mass_deletion: data.allowMassDeletion,
    p_expected_library_revision: data.expectedLibraryRevision,
    p_actor_user_id: actorUserId ?? null,
  });

  if (error) {
    throw new Error(`[RECONCILE_FAILED] ${error.message}`);
  }

  return {
    ...(result || {}),
    actorUserId,
  };
}

export async function getMasterLibraryRevisionInternal() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("library_revisions").select("revision").eq("id", true).maybeSingle();
  if (error) throw new Error(`[LIBRARY_REVISION_READ_FAILED] ${error.message}`);
  if (!data || typeof data.revision !== "number")
    throw new Error("[LIBRARY_REVISION_STATE_MISSING] Canonical library revision is unavailable.");
  return data.revision;
}

export const getMasterLibraryRevisionServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => getMasterLibraryRevisionInternal());

export const replaceMasterLibraryServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      tracks: z.array(trackSchema),
      albums: z.array(albumSchema),
      videos: z.array(videoSchema),
      allowMassDeletion: z.boolean(),
      expectedLibraryRevision: z.number().int().positive(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await replaceMasterLibraryInternal(data, actorUserId);
  });

/**
 * Internal Public Master Library Reader:
 * Returns all public canonical tracks, albums, and videos with short-lived (15 min) signed URLs.
 * Throws explicit error if database is unreachable (does NOT return fake empty arrays).
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function getCachedSignedUrl(key: string, inline: boolean): string | null {
  const cacheKey = `${key}::${inline ? "inline" : "attach"}`;
  const hit = signedUrlCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) {
    return hit.url;
  }
  return null;
}

function setCachedSignedUrl(key: string, inline: boolean, url: string) {
  const cacheKey = `${key}::${inline ? "inline" : "attach"}`;
  // Prune cache if it grows too large
  if (signedUrlCache.size > 500) {
    signedUrlCache.clear();
  }
  signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + 720_000 });
}

export async function getPublicMasterLibraryInternal() {
  const db = getSupabaseAdmin();
  const [albums, tracks, videos] = await Promise.all([
    db
      .from("albums")
      .select("id,title,artist,year,cover_storage_key,accent,note,visibility,version,updated_at,status")
      .eq("visibility", "public")
      .neq("status", "trash")
      .order("year", { ascending: false }),
    db
      .from("tracks")
      .select(
        "id,title,artist,album_id,track_no,duration_seconds,format,bit_depth,sample_rate,size_mb,storage_key,cover_storage_key,year,lyrics,lyrics_source,visibility,version,updated_at,status,track_files(file_size_bytes,sha256,sample_rate,bit_depth,container,codec,duration_seconds,verified_at)",
      )
      .eq("visibility", "public")
      .neq("status", "trash")
      .order("created_at", { ascending: true }),
    db
      .from("videos")
      .select(
        "id,title,artist,year,thumb_storage_key,storage_key,duration_seconds,resolution,codec,bitrate,size_mb,visibility,version,updated_at,status,video_files(file_size_bytes,sha256,codec,resolution,duration_seconds,verified_at)",
      )
      .eq("visibility", "public")
      .neq("status", "trash")
      .order("year", { ascending: false }),
  ]);

  for (const result of [albums, tracks, videos]) {
    if (result.error) {
      throw new Error(`[Duckroom Database] Master library fetch failed: ${result.error.message}`);
    }
  }

  const s3 = getS3ServerClient();
  const sign = async (key: string | null | undefined, inline = false) => {
    if (!key || typeof key !== "string" || !key.trim()) return undefined;
    const cleanKey = key.trim();
    if (cleanKey.startsWith("http://") || cleanKey.startsWith("https://")) {
      return cleanKey;
    }
    const cached = getCachedSignedUrl(cleanKey, inline);
    if (cached) return cached;
    try {
      validateStorageKey(cleanKey);
      const signed = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: cleanKey,
          ...(inline ? { ResponseContentDisposition: "inline" } : {}),
        }),
        { expiresIn: 900 },
      );
      if (signed) setCachedSignedUrl(cleanKey, inline, signed);
      return signed;
    } catch (err) {
      console.warn(`[Duckroom Storage] Could not sign key: "${cleanKey}"`, err);
      return undefined;
    }
  };

  function getAlbumPriority(album: { id?: string; title?: string }): number {
    const title = (album.title || "").toLowerCase().trim();
    const id = (album.id || "").toLowerCase().trim();

    // 1. HVL (MCK)
    if (title === "hvl" || title.includes("hvl") || id.includes("hvl")) return 1;
    // 2. Đánh Đổi (Obito)
    if (
      title === "đánh đổi" ||
      title === "danh doi" ||
      title.includes("đánh đổi") ||
      title.includes("danh doi") ||
      id.includes("danh-doi")
    ) {
      return 2;
    }
    // 3. Bảy (HAZEL)
    if (title === "bảy" || title === "bay" || title.includes("bảy") || title.includes("bay") || id.includes("bay")) {
      return 3;
    }
    // 4. Trái Tim Băng Bổ (Dangrangto)
    if (
      title.includes("trái tim") ||
      title.includes("trai tim") ||
      title.includes("băng b") ||
      title.includes("bang b") ||
      id.includes("trai-tim")
    ) {
      return 4;
    }

    return 999;
  }

  const albumRows = await Promise.all(
    (albums.data ?? []).map(async (a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      year: a.year,
      cover: (await sign(a.cover_storage_key)) ?? "",
      accent: a.accent,
      note: a.note,
      version: a.version,
      updated_at: a.updated_at,
      status: a.status,
    })),
  );

  albumRows.sort((a, b) => {
    const pA = getAlbumPriority(a);
    const pB = getAlbumPriority(b);
    if (pA !== pB) return pA - pB;
    return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);
  });

  const trackRows = await Promise.all(
    (tracks.data ?? []).map(async (t: any) => {
      const files = Array.isArray(t.track_files) ? t.track_files : t.track_files ? [t.track_files] : [];
      const masterFile = files.find((f: any) => f.verified_at) ?? files[0];

      // Authoritative physical metadata precedence over legacy display fields
      const format = masterFile?.container ?? masterFile?.codec ?? t.format;
      const bitDepth = masterFile?.bit_depth ?? t.bit_depth;
      const sampleRate = masterFile?.sample_rate ?? t.sample_rate;
      const duration = masterFile?.duration_seconds ?? t.duration_seconds;
      const sizeMB =
        masterFile?.file_size_bytes != null
          ? parseFloat((masterFile.file_size_bytes / (1024 * 1024)).toFixed(2))
          : Number(t.size_mb);

      return {
        id: t.id,
        albumId: t.album_id ?? undefined,
        title: t.title,
        artist: t.artist,
        duration,
        trackNo: t.track_no,
        format,
        bitDepth,
        sampleRate,
        sizeMB,
        src: (await sign(t.storage_key, true)) ?? "",
        cover: await sign(t.cover_storage_key),
        year: t.year ?? undefined,
        lyrics: t.lyrics ?? [],
        lyricsSource: (t.lyrics_source as string | null) ?? null,
        rgTrackDb:
          typeof masterFile?.replaygain_track_gain_db === "number" ? masterFile.replaygain_track_gain_db : undefined,
        rgAlbumDb:
          typeof masterFile?.replaygain_album_gain_db === "number" ? masterFile.replaygain_album_gain_db : undefined,
        version: t.version,
        updated_at: t.updated_at,
        status: t.status,
      };
    }),
  );

  const videoRows = await Promise.all(
    (videos.data ?? []).map(async (v: any) => {
      const files = Array.isArray(v.video_files) ? v.video_files : v.video_files ? [v.video_files] : [];
      const masterFile = files.find((f: any) => f.verified_at) ?? files[0];

      const resolution = masterFile?.resolution ?? v.resolution;
      const codec = masterFile?.codec ?? v.codec;
      const duration = masterFile?.duration_seconds ?? v.duration_seconds;
      const sizeMB =
        masterFile?.file_size_bytes != null
          ? parseFloat((masterFile.file_size_bytes / (1024 * 1024)).toFixed(2))
          : Number(v.size_mb);

      return {
        id: v.id,
        title: v.title,
        artist: v.artist,
        year: v.year,
        thumb: (await sign(v.thumb_storage_key)) ?? "",
        duration,
        resolution,
        codec,
        bitrate: v.bitrate,
        sizeMB,
        src: (await sign(v.storage_key, true)) ?? "",
        version: v.version,
        updated_at: v.updated_at,
        status: v.status,
      };
    }),
  );

  return { albums: albumRows, tracks: trackRows, videos: videoRows };
}

export function clearSignedUrlCache() {
  signedUrlCache.clear();
}

/**
 * Public Master Library Reader Server RPC:
 */
export const getPublicMasterLibraryServer = createServerFn({ method: "GET" }).handler(async () => {
  return await getPublicMasterLibraryInternal();
});
