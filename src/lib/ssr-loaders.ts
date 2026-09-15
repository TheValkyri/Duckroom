import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { getS3ServerClient } from "./s3-functions";
import { ARTWORK_URL_TTL_SECONDS, BUCKET_NAME } from "./s3-constants";
import { serverSecurityMiddleware, validateVisualAssetKey } from "./auth-guard";
import { getPublicMasterLibraryInternal } from "./master-library";
import type { Album, Track, Video } from "../data/library";

const ssrArtworkCache = new Map<string, { url: string; expiresAt: number }>();
export const MAX_SSR_CACHE_ENTRIES = 1000;
export const SSR_QUERY_TIMEOUT_MS = 6000;

export function clearSsrArtworkCache() {
  ssrArtworkCache.clear();
}

export function getSsrArtworkCacheSize() {
  return ssrArtworkCache.size;
}

function pruneSsrArtworkCache() {
  const now = Date.now();
  for (const [k, v] of ssrArtworkCache.entries()) {
    if (v.expiresAt <= now + 60_000) {
      ssrArtworkCache.delete(k);
    }
  }
  if (ssrArtworkCache.size >= MAX_SSR_CACHE_ENTRIES) {
    const toDelete = Math.floor(MAX_SSR_CACHE_ENTRIES * 0.2);
    let count = 0;
    for (const k of ssrArtworkCache.keys()) {
      ssrArtworkCache.delete(k);
      if (++count >= toDelete) break;
    }
  }
}

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, operationName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[Duckroom SSR] ${operationName} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Signs visual artwork/thumbnail keys for SSR with 21600s (6h) TTL and a 5-hour in-memory cache.
 * Fails safely to empty string if S3 is unreachable or key is invalid.
 */
export async function signArtworkUrl(key: string | null | undefined): Promise<string> {
  if (!key || typeof key !== "string" || !key.trim()) return "";
  const cleanKey = key.trim();
  if (cleanKey.startsWith("http://") || cleanKey.startsWith("https://")) {
    return cleanKey;
  }
  const hit = ssrArtworkCache.get(cleanKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) {
    return hit.url;
  }
  try {
    validateVisualAssetKey(cleanKey);
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
      ResponseContentDisposition: "inline",
    });
    const signed = await getSignedUrl(s3, command, { expiresIn: ARTWORK_URL_TTL_SECONDS });
    if (signed) {
      if (ssrArtworkCache.size >= MAX_SSR_CACHE_ENTRIES) {
        pruneSsrArtworkCache();
      }
      ssrArtworkCache.set(cleanKey, { url: signed, expiresAt: Date.now() + 5 * 3600 * 1000 });
      return signed;
    }
    return "";
  } catch (err) {
    console.warn(`[Duckroom SSR] Failed to sign artwork key "${cleanKey}":`, err);
    return "";
  }
}

export interface AlbumSsrData {
  album: Album;
  tracks: Track[];
}

/**
 * Domain helper to fetch a single album and its tracks directly from Supabase for SSR.
 * Does NOT sign audio playback URLs (lazy on-demand signing, src: "").
 */
export async function getAlbumByIdSsrInternal(albumId: string): Promise<AlbumSsrData | null> {
  if (!albumId?.trim()) return null;
  const db = getSupabaseAdmin();
  const cleanId = albumId.trim();

  const [albumRes, tracksRes] = await withTimeout(
    Promise.all([
      db
        .from("albums")
        .select("id,title,artist,year,cover_storage_key,accent,note,visibility,version,updated_at,status")
        .eq("id", cleanId)
        .neq("status", "trash")
        .maybeSingle(),
      db
        .from("tracks")
        .select(
          "id,title,artist,album_id,track_no,duration_seconds,format,bit_depth,sample_rate,size_mb,storage_key,cover_storage_key,year,lyrics,lyrics_source,visibility,version,updated_at,status,track_files(file_size_bytes,sha256,sample_rate,bit_depth,container,codec,duration_seconds,waveform_peaks,verified_at)",
        )
        .eq("album_id", cleanId)
        .neq("status", "trash")
        .order("track_no", { ascending: true }),
    ]),
    SSR_QUERY_TIMEOUT_MS,
    `Album query "${cleanId}"`,
  );

  if (albumRes.error) {
    throw new Error(`[Duckroom SSR] Album query failed: ${albumRes.error.message}`);
  }
  if (tracksRes.error) {
    throw new Error(`[Duckroom SSR] Album tracks query failed: ${tracksRes.error.message}`);
  }

  const a = albumRes.data;
  if (!a) return null;
  if (a.visibility && a.visibility !== "public") return null;

  const coverUrl = await signArtworkUrl(a.cover_storage_key);

  const album: Album = {
    id: a.id,
    title: a.title,
    artist: a.artist,
    year: a.year,
    cover: coverUrl,
    accent: a.accent || "oklch(0.65 0.15 240)",
    note: a.note || "",
    version: a.version,
    updated_at: a.updated_at,
    status: a.status,
  };

  const rawTracks = tracksRes.data || [];
  const tracks: Track[] = await Promise.all(
    rawTracks
      .filter((t: any) => !t.visibility || t.visibility === "public")
      .map(async (t: any) => {
        const files = Array.isArray(t.track_files) ? t.track_files : t.track_files ? [t.track_files] : [];
        const masterFile = files.find((f: any) => f.verified_at) ?? files[0];

        const format = masterFile?.container ?? masterFile?.codec ?? t.format;
        const bitDepth = masterFile?.bit_depth ?? t.bit_depth;
        const sampleRate = masterFile?.sample_rate ?? t.sample_rate;
        const duration = masterFile?.duration_seconds ?? t.duration_seconds;
        const sizeMB =
          masterFile?.file_size_bytes != null
            ? parseFloat((masterFile.file_size_bytes / (1024 * 1024)).toFixed(2))
            : Number(t.size_mb);

        const trackCover = t.cover_storage_key ? await signArtworkUrl(t.cover_storage_key) : coverUrl;

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
          src: "",
          cover: trackCover,
          year: t.year ?? undefined,
          lyrics: t.lyrics ?? [],
          lyricsSource: (t.lyrics_source as string | null) ?? null,
          waveformPeaks:
            Array.isArray(masterFile?.waveform_peaks) && masterFile.waveform_peaks.length > 0
              ? masterFile.waveform_peaks
              : undefined,
          version: t.version,
          updated_at: t.updated_at,
          status: t.status,
        };
      }),
  );

  return { album, tracks };
}

/**
 * Domain helper to fetch a single video directly from Supabase for SSR.
 * Does NOT sign video playback URLs (lazy on-demand signing, src: "").
 */
export async function getVideoByIdSsrInternal(videoId: string): Promise<Video | null> {
  if (!videoId?.trim()) return null;
  const db = getSupabaseAdmin();
  const cleanId = videoId.trim();

  const { data: v, error } = await withTimeout(
    Promise.resolve(
      db
        .from("videos")
        .select(
          "id,title,artist,year,thumb_storage_key,storage_key,duration_seconds,resolution,codec,bitrate,size_mb,visibility,version,updated_at,status,video_files(file_size_bytes,sha256,codec,resolution,duration_seconds,verified_at)",
        )
        .eq("id", cleanId)
        .neq("status", "trash")
        .maybeSingle(),
    ),
    SSR_QUERY_TIMEOUT_MS,
    `Video query "${cleanId}"`,
  );

  if (error) {
    throw new Error(`[Duckroom SSR] Video query failed: ${error.message}`);
  }

  if (!v) return null;
  if (v.visibility && v.visibility !== "public") return null;

  const files = Array.isArray(v.video_files) ? v.video_files : v.video_files ? [v.video_files] : [];
  const masterFile = files.find((f: any) => f.verified_at) ?? files[0];

  const resolution = masterFile?.resolution ?? v.resolution;
  const codec = masterFile?.codec ?? v.codec;
  const duration = masterFile?.duration_seconds ?? v.duration_seconds;
  const sizeMB =
    masterFile?.file_size_bytes != null
      ? parseFloat((masterFile.file_size_bytes / (1024 * 1024)).toFixed(2))
      : Number(v.size_mb);

  const thumbUrl = await signArtworkUrl(v.thumb_storage_key);

  return {
    id: v.id,
    title: v.title,
    artist: v.artist,
    year: v.year,
    thumb: thumbUrl,
    duration,
    resolution,
    codec,
    bitrate: v.bitrate,
    sizeMB,
    src: "",
    version: v.version,
    updated_at: v.updated_at,
    status: v.status,
  };
}

export interface PublicLibrarySummary {
  albums: Album[];
  tracks: Track[];
  videos: Video[];
  totalAlbums: number;
  totalTracks: number;
  totalVideos: number;
  totalSingles: number;
  primaryCover: string;
}

/**
 * Domain helper to fetch public library summary metadata for SSR routes (index, albums, videos, singles).
 * Leverages getPublicMasterLibraryInternal cache and signs only artwork.
 */
export async function getPublicLibrarySummaryInternal(): Promise<PublicLibrarySummary> {
  const lib = await withTimeout(
    getPublicMasterLibraryInternal(),
    SSR_QUERY_TIMEOUT_MS,
    "Public master library summary",
  );
  const singles = lib.tracks.filter(
    (t) => !t.albumId || t.albumId === "singles" || t.albumId === "single" || t.albumId === "single-collection",
  );
  const primaryCover =
    lib.albums[0]?.cover || lib.tracks.find((t) => t.cover)?.cover || "https://duckroom.vercel.app/og-image.jpg";

  return {
    albums: lib.albums,
    tracks: lib.tracks,
    videos: lib.videos,
    totalAlbums: lib.albums.length,
    totalTracks: lib.tracks.length,
    totalVideos: lib.videos.length,
    totalSingles: singles.length,
    primaryCover,
  };
}

/**
 * Server function RPC: Single album by ID for SSR with OpenGraph support.
 */
export const getAlbumByIdSsrServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .validator(z.object({ albumId: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await getAlbumByIdSsrInternal(data.albumId);
  });

/**
 * Server function RPC: Single video by ID for SSR with OpenGraph support.
 */
export const getVideoByIdSsrServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .validator(z.object({ videoId: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await getVideoByIdSsrInternal(data.videoId);
  });

/**
 * Server function RPC: Public library summary metadata for SSR route loaders.
 */
export const getPublicLibrarySummaryServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .handler(async () => {
    return await getPublicLibrarySummaryInternal();
  });
