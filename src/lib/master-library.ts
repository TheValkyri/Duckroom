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
export const replaceMasterLibraryServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      tracks: z.array(trackSchema),
      albums: z.array(albumSchema),
      videos: z.array(videoSchema),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    // 1. Reconcile Albums
    const incomingAlbumIds = new Set(data.albums.map((a) => a.id));
    const albumRows = data.albums.map((album) => ({
      id: album.id,
      title: album.title,
      artist: album.artist,
      year: album.year,
      cover_storage_key: keyFromValue(album.cover) ?? "",
      accent: album.accent,
      note: album.note,
    }));
    if (albumRows.length) {
      const { error } = await db.from("albums").upsert(albumRows, { onConflict: "id" });
      if (error) throw new Error(`Album persistence failed: ${error.message}`);
    }
    // Delete removed albums (excluding singles virtual album)
    const { data: currentAlbums } = await db.from("albums").select("id");
    const albumsToDelete = (currentAlbums || [])
      .map((a) => a.id)
      .filter((id) => id !== "singles" && id !== "single-collection" && !incomingAlbumIds.has(id));
    if (albumsToDelete.length) {
      await db.from("albums").delete().in("id", albumsToDelete);
    }

    // 2. Reconcile Tracks
    const incomingTrackIds = new Set(data.tracks.map((t) => t.id));
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
    if (trackRows.length) {
      const { error } = await db.from("tracks").upsert(trackRows, { onConflict: "id" });
      if (error) throw new Error(`Track persistence failed: ${error.message}`);
    }
    // Delete removed tracks from DB
    const { data: currentTracks } = await db.from("tracks").select("id");
    const tracksToDelete = (currentTracks || []).map((t) => t.id).filter((id) => !incomingTrackIds.has(id));
    if (tracksToDelete.length) {
      await db.from("tracks").delete().in("id", tracksToDelete);
    }

    // 3. Reconcile Videos
    const incomingVideoIds = new Set(data.videos.map((v) => v.id));
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
    if (videoRows.length) {
      const { error } = await db.from("videos").upsert(videoRows, { onConflict: "id" });
      if (error) throw new Error(`Video persistence failed: ${error.message}`);
    }
    // Delete removed videos from DB
    const { data: currentVideos } = await db.from("videos").select("id");
    const videosToDelete = (currentVideos || []).map((v) => v.id).filter((id) => !incomingVideoIds.has(id));
    if (videosToDelete.length) {
      await db.from("videos").delete().in("id", videosToDelete);
    }

    return {
      success: true,
      persisted: { tracks: trackRows.length, albums: albumRows.length, videos: videoRows.length },
      deleted: { tracks: tracksToDelete.length, albums: albumsToDelete.length, videos: videosToDelete.length },
    };
  });

/**
 * Public Master Library Reader:
 * Returns all public canonical tracks, albums, and videos with short-lived (15 min) signed URLs.
 */
export const getPublicMasterLibraryServer = createServerFn({ method: "GET" }).handler(async () => {
  const db = getSupabaseAdmin();
  const [albums, tracks, videos] = await Promise.all([
    db
      .from("albums")
      .select("id,title,artist,year,cover_storage_key,accent,note,visibility")
      .eq("visibility", "public")
      .order("year", { ascending: false }),
    db
      .from("tracks")
      .select(
        "id,title,artist,album_id,track_no,duration_seconds,format,bit_depth,sample_rate,size_mb,storage_key,cover_storage_key,year,lyrics,visibility",
      )
      .eq("visibility", "public")
      .order("created_at", { ascending: true }),
    db
      .from("videos")
      .select(
        "id,title,artist,year,thumb_storage_key,storage_key,duration_seconds,resolution,codec,bitrate,size_mb,visibility",
      )
      .eq("visibility", "public")
      .order("year", { ascending: false }),
  ]);

  for (const result of [albums, tracks, videos]) {
    if (result.error) throw new Error(result.error.message);
  }

  const s3 = getS3ServerClient();
  const sign = async (key: string | null | undefined, inline = false) => {
    if (!key || typeof key !== "string" || !key.trim()) return undefined;
    const cleanKey = key.trim();
    if (cleanKey.startsWith("http://") || cleanKey.startsWith("https://")) {
      return cleanKey;
    }
    try {
      validateStorageKey(cleanKey);
      return await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: cleanKey,
          ...(inline ? { ResponseContentDisposition: "inline" } : {}),
        }),
        { expiresIn: 900 },
      );
    } catch (err) {
      console.warn(`[Duckroom Storage] Could not sign key: "${cleanKey}"`, err);
      return undefined;
    }
  };

  const albumRows = await Promise.all(
    (albums.data ?? []).map(async (a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      year: a.year,
      cover: (await sign(a.cover_storage_key)) ?? "",
      accent: a.accent,
      note: a.note,
    })),
  );

  const trackRows = await Promise.all(
    (tracks.data ?? []).map(async (t) => ({
      id: t.id,
      albumId: t.album_id ?? undefined,
      title: t.title,
      artist: t.artist,
      duration: t.duration_seconds,
      trackNo: t.track_no,
      format: t.format,
      bitDepth: t.bit_depth,
      sampleRate: t.sample_rate,
      sizeMB: Number(t.size_mb),
      src: (await sign(t.storage_key, true)) ?? "",
      cover: await sign(t.cover_storage_key),
      year: t.year ?? undefined,
      lyrics: t.lyrics ?? [],
    })),
  );

  const videoRows = await Promise.all(
    (videos.data ?? []).map(async (v) => ({
      id: v.id,
      title: v.title,
      artist: v.artist,
      year: v.year,
      thumb: (await sign(v.thumb_storage_key)) ?? "",
      duration: v.duration_seconds,
      resolution: v.resolution,
      codec: v.codec,
      bitrate: v.bitrate,
      sizeMB: Number(v.size_mb),
      src: (await sign(v.storage_key, true)) ?? "",
    })),
  );

  return { albums: albumRows, tracks: trackRows, videos: videoRows };
});
