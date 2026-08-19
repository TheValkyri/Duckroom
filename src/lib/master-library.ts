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

    const trackRows = data.tracks.map((track) => ({
      id: track.id,
      album_id: track.albumId && track.albumId !== "singles" ? track.albumId : null,
      title: track.title,
      artist: track.artist,
      track_no: track.trackNo,
      duration_seconds: Math.round(track.duration),
      format: track.format,
      bit_depth: Math.round(track.bitDepth),
      sample_rate: track.sampleRate,
      size_mb: track.sizeMB,
      storage_key: keyFromValue(track.src) ?? "",
      cover_storage_key: keyFromValue(track.cover),
      year: track.year ?? null,
      lyrics: track.lyrics,
    }));
    if (trackRows.length) {
      const { error } = await db.from("tracks").upsert(trackRows, { onConflict: "id" });
      if (error) throw new Error(`Track persistence failed: ${error.message}`);
    }

    const videoRows = data.videos.map((video) => ({
      id: video.id,
      title: video.title,
      artist: video.artist,
      year: video.year,
      thumb_storage_key: keyFromValue(video.thumb) ?? "",
      storage_key: keyFromValue(video.src) ?? "",
      duration_seconds: Math.round(video.duration),
      resolution: video.resolution,
      codec: video.codec,
      bitrate: video.bitrate,
      size_mb: video.sizeMB,
    }));
    if (videoRows.length) {
      const { error } = await db.from("videos").upsert(videoRows, { onConflict: "id" });
      if (error) throw new Error(`Video persistence failed: ${error.message}`);
    }

    return {
      success: true,
      persisted: { tracks: trackRows.length, albums: albumRows.length, videos: videoRows.length },
    };
  });

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
    if (!key) return undefined;
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
      title: t.title,
      artist: t.artist,
      albumId: t.album_id ?? "singles",
      duration: t.duration_seconds,
      trackNo: t.track_no,
      format: t.format as any,
      bitDepth: t.bit_depth,
      sampleRate: t.sample_rate,
      sizeMB: Number(t.size_mb),
      src: await sign(t.storage_key, true),
      cover: await sign(t.cover_storage_key),
      year: t.year ?? undefined,
      lyrics: (t.lyrics as any) ?? [],
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
      src: await sign(v.storage_key, true),
    })),
  );

  return { albums: albumRows, tracks: trackRows, videos: videoRows };
});
