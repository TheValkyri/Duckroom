import { deleteTrackDomainServer, deleteVideoDomainServer } from "../lib/s3-functions";
import { getPublicMasterLibraryServer } from "../lib/master-library";
import {
  createAlbumDomainServer,
  updateAlbumDomainServer,
  trashAlbumDomainServer,
  createTrackDomainServer,
  updateTrackDomainServer,
} from "../lib/domain-mutations";

export type LyricLine = { time: number; text: string };

export type Track = {
  id: string;
  title: string;
  artist: string;
  albumId: string;
  duration: number; // seconds
  trackNo: number;
  format: "FLAC" | "ALAC" | "WAV" | "MP3" | "M4A" | "UNKNOWN";
  bitDepth: number;
  sampleRate: number; // kHz
  sizeMB: number;
  /** Nguồn phát gốc, không transcode. Trống = chưa upload. */
  src?: string | undefined;
  cover?: string | undefined;
  year?: number | undefined;
  lyrics: LyricLine[];
  /** Provider attribution (Master Plan §10.2) — e.g. "LRCLIB", "Lyrics.ovh". */
  lyricsSource?: string | null | undefined;
  /** ReplayGain track gain (dB) from authoritative server analysis; undefined = unknown. */
  rgTrackDb?: number | undefined;
  /** ReplayGain album gain (dB) from authoritative server analysis; undefined = unknown. */
  rgAlbumDb?: number | undefined;
  version?: number | undefined;
  updated_at?: string | undefined;
  status?: ("active" | "trash" | "archived") | undefined;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  cover: string;
  accent: string; // oklch, dùng cho nền động
  note: string;
  version?: number | undefined;
  updated_at?: string | undefined;
  status?: ("active" | "trash" | "archived") | undefined;
};

export type Video = {
  id: string;
  title: string;
  artist: string;
  year: number;
  thumb: string;
  duration: number;
  resolution: string;
  codec: string;
  bitrate: string;
  sizeMB: number;
  src?: string | undefined;
  version?: number | undefined;
  updated_at?: string | undefined;
  status?: ("active" | "trash" | "archived") | undefined;
};

// ==========================================
// CLIENT CACHE STRUCTURES
// Pure in-memory client cache hydrated solely from PostgreSQL.
// Cache mutation != canonical persistence.
// ==========================================
export const albums: Album[] = [];
export const tracks: Track[] = [];
export const videos: Video[] = [];

// Reactive subscriber set for useLibrary hook
const librarySubscribers = new Set<() => void>();

export function subscribeLibrary(callback: () => void): () => void {
  librarySubscribers.add(callback);
  return () => librarySubscribers.delete(callback);
}

export function notifyLibrarySubscribers() {
  librarySubscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error("Library subscriber error:", err);
    }
  });
}

// Explicit sync & stale state tracking
export type LibrarySyncStatus = "idle" | "syncing" | "ready" | "error";
export let librarySyncStatus: LibrarySyncStatus = "idle";
export let librarySyncError: string | null = null;
export let isLibraryStale = false;

export function getAlbumPriority(album: { id?: string | undefined; title?: string | undefined }): number {
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

export function sortAlbumsDeterministically(albumList: Album[]): Album[] {
  return [...albumList].sort((a, b) => {
    const pA = getAlbumPriority(a);
    const pB = getAlbumPriority(b);
    if (pA !== pB) return pA - pB;
    return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);
  });
}

let lastSyncTime = 0;

/**
 * Hydrates client cache strictly from Supabase PostgreSQL canonical store.
 * Distinguishes canonical DB failure from empty library.
 * Throws on failure to prevent false-success stale state.
 */
export async function syncLibraryWithS3(force = false): Promise<{ albums: Album[]; tracks: Track[]; videos: Video[] }> {
  const now = Date.now();
  if (!force && now - lastSyncTime < 30000 && tracks.length > 0 && librarySyncStatus === "ready") {
    return { albums, tracks, videos };
  }
  lastSyncTime = now;
  librarySyncStatus = "syncing";
  notifyLibrarySubscribers();

  try {
    const canonical = await getPublicMasterLibraryServer();
    // Empty array is a valid library state - do NOT treat as error
    albums.length = 0;
    albums.push(...sortAlbumsDeterministically((canonical.albums as Album[]) || []));
    tracks.length = 0;
    tracks.push(...((canonical.tracks as unknown as Track[]) || []));
    videos.length = 0;
    videos.push(...((canonical.videos as unknown as Video[]) || []));

    librarySyncStatus = "ready";
    librarySyncError = null;
    isLibraryStale = false;
    notifyLibrarySubscribers();
    return { albums, tracks, videos };
  } catch (canonicalError: any) {
    const msg = canonicalError instanceof Error ? canonicalError.message : String(canonicalError);
    librarySyncStatus = "error";
    librarySyncError = msg;
    isLibraryStale = albums.length > 0 || tracks.length > 0 || videos.length > 0;
    notifyLibrarySubscribers();
    console.error("[Duckroom Library] Canonical library fetch failed:", canonicalError);
    throw new Error(`[Duckroom Library] Synchronizing canonical library failed: ${msg}`);
  }
}

export function removeTrackFromLibrary(id: string) {
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tracks.splice(idx, 1);
    notifyLibrarySubscribers();
  }
}

export async function deleteTrack(trackId: string) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return false;
  if (typeof track.version !== "number") throw new Error("Cannot delete track without a current revision");
  const result = await deleteTrackDomainServer({ data: { trackId, expectedVersion: track.version } });
  if (!result.success) throw new Error("Domain track delete failed");
  removeTrackFromLibrary(trackId);
  return true;
}

export async function deleteVideo(videoId: string) {
  const idx = videos.findIndex((v) => v.id === videoId);
  if (idx >= 0) {
    const video = videos[idx];
    if (!video || typeof video.version !== "number") throw new Error("Cannot delete video without a current revision");
    const result = await deleteVideoDomainServer({ data: { videoId, expectedVersion: video.version } });
    if (!result.success) throw new Error("Domain video delete failed");
    videos.splice(idx, 1);
    notifyLibrarySubscribers();
  }
}

export function clearAllTracks() {
  tracks.length = 0;
  albums.length = 0;
  videos.length = 0;
  notifyLibrarySubscribers();
}

export const albumById = (id: string) => {
  if (!id) return undefined;
  const cleanId = id.toLowerCase().trim();
  return (
    albums.find((a) => a.id === id) ||
    albums.find((a) => a.id.toLowerCase().trim() === cleanId) ||
    albums.find((a) => a.title.toLowerCase().trim() === cleanId)
  );
};

export const trackById = (id: string) => tracks.find((t) => t.id === id);

export const albumTracks = (id: string) => {
  const targetAlbum = albumById(id);
  if (!targetAlbum) return [];

  const targetId = targetAlbum.id.toLowerCase().trim();
  const targetTitle = targetAlbum.title.toLowerCase().trim();

  const list = tracks.filter((t) => {
    if (!t.albumId) return false;
    const trackAlbum = t.albumId.toLowerCase().trim();
    if (!trackAlbum || trackAlbum === "singles" || trackAlbum === "single" || trackAlbum === "single-collection") {
      return false;
    }

    return trackAlbum === targetId || trackAlbum === targetTitle;
  });

  const hasDistinctTrackNos = new Set(list.map((t) => t.trackNo)).size > 1;
  if (hasDistinctTrackNos) {
    return list.sort((a, b) => (a.trackNo || 0) - (b.trackNo || 0));
  }

  return list;
};

export const videoById = (id: string) => videos.find((v) => v.id === id);

// ==========================================
// CANONICAL DOMAIN MUTATION WRAPPERS (CLIENT)
// ==========================================

export async function createAlbum(data: {
  title: string;
  artist: string;
  year?: number | undefined;
  cover?: string | undefined;
  accent?: string | undefined;
  note?: string | undefined;
}): Promise<Album> {
  const created = await createAlbumDomainServer({ data });
  const newAlbum: Album = {
    id: created.id,
    title: created.title,
    artist: created.artist,
    year: created.year,
    cover: created.cover_storage_key || "",
    accent: created.accent,
    note: created.note || "",
    version: created.version,
    updated_at: created.updated_at,
    status: created.status as any,
  };
  albums.push(newAlbum);
  notifyLibrarySubscribers();
  return newAlbum;
}

export async function updateAlbum(
  albumId: string,
  data: {
    expectedVersion?: number | undefined;
    title?: string | undefined;
    artist?: string | undefined;
    year?: number | undefined;
    cover?: string | undefined;
    accent?: string | undefined;
    note?: string | undefined;
  },
): Promise<Album> {
  const current = albums.find((a) => a.id === albumId);
  const versionToUse = data.expectedVersion ?? current?.version ?? 1;

  const updated = await updateAlbumDomainServer({
    data: {
      id: albumId,
      ...data,
      expectedVersion: versionToUse,
    },
  });
  const idx = albums.findIndex((a) => a.id === albumId);
  const mappedAlbum: Album = {
    id: updated.id,
    title: updated.title,
    artist: updated.artist,
    year: updated.year,
    cover: updated.cover_storage_key || "",
    accent: updated.accent,
    note: updated.note || "",
    version: updated.version,
    updated_at: updated.updated_at,
    status: updated.status as any,
  };
  if (idx >= 0) {
    albums[idx] = mappedAlbum;
  } else {
    albums.push(mappedAlbum);
  }
  notifyLibrarySubscribers();
  return mappedAlbum;
}

export async function deleteAlbum(albumId: string): Promise<boolean> {
  const album = albums.find((item) => item.id === albumId);
  if (!album || typeof album.version !== "number") throw new Error("Cannot delete album without a current revision");
  await trashAlbumDomainServer({ data: { albumId, expectedVersion: album.version } });
  const idx = albums.findIndex((a) => a.id === albumId);
  if (idx >= 0) {
    albums.splice(idx, 1);
    notifyLibrarySubscribers();
  }
  return true;
}

export async function createTrack(data: {
  title: string;
  artist: string;
  albumId?: string | null | undefined;
  duration: number;
  trackNo: number;
  format?: string | undefined;
  bitDepth?: number | undefined;
  sampleRate?: number | undefined;
  sizeMB?: number | undefined;
  src?: string | undefined;
  cover?: string | undefined;
  year?: number | null | undefined;
  lyrics?: LyricLine[] | undefined;
}): Promise<Track> {
  const created = await createTrackDomainServer({ data });
  const newTrack: Track = {
    id: created.id,
    title: created.title,
    artist: created.artist,
    albumId: created.album_id || "singles",
    duration: created.duration_seconds,
    trackNo: created.track_no,
    format: (created.format as any) || "UNKNOWN",
    bitDepth: created.bit_depth,
    sampleRate: created.sample_rate,
    sizeMB: Number(created.size_mb) || 0,
    src: created.storage_key,
    cover: created.cover_storage_key || undefined,
    year: created.year ?? undefined,
    lyrics: (created.lyrics as LyricLine[]) || [],
    version: created.version,
    updated_at: created.updated_at,
    status: created.status as any,
  };
  tracks.push(newTrack);
  notifyLibrarySubscribers();
  return newTrack;
}

export async function updateTrack(
  trackId: string,
  data: {
    expectedVersion?: number | undefined;
    title?: string | undefined;
    artist?: string | undefined;
    albumId?: string | null | undefined;
    trackNo?: number | undefined;
    duration?: number | undefined;
    format?: string | undefined;
    bitDepth?: number | undefined;
    sampleRate?: number | undefined;
    sizeMB?: number | undefined;
    src?: string | undefined;
    cover?: string | undefined;
    year?: number | null | undefined;
    lyrics?: LyricLine[] | undefined;
    lyricsSource?: string | null | undefined;
  },
): Promise<Track> {
  const current = tracks.find((t) => t.id === trackId);
  const versionToUse = data.expectedVersion ?? current?.version ?? 1;

  const updated = await updateTrackDomainServer({
    data: {
      id: trackId,
      ...data,
      expectedVersion: versionToUse,
    },
  });
  const idx = tracks.findIndex((t) => t.id === trackId);
  const mappedTrack: Track = {
    id: updated.id,
    title: updated.title,
    artist: updated.artist,
    albumId: updated.album_id || "singles",
    duration: updated.duration_seconds,
    trackNo: updated.track_no,
    format: (updated.format as any) || "UNKNOWN",
    bitDepth: updated.bit_depth,
    sampleRate: updated.sample_rate,
    sizeMB: Number(updated.size_mb) || 0,
    src: updated.storage_key,
    cover: updated.cover_storage_key || undefined,
    year: updated.year ?? undefined,
    lyrics: (updated.lyrics as LyricLine[]) || [],
    lyricsSource: (updated.lyrics_source as string | null) ?? null,
    version: updated.version,
    updated_at: updated.updated_at,
    status: updated.status as any,
  };
  if (idx >= 0) {
    tracks[idx] = mappedTrack;
  } else {
    tracks.push(mappedTrack);
  }
  notifyLibrarySubscribers();
  return mappedTrack;
}

export async function addTracksToAlbum(albumId: string, trackIds: string[]): Promise<void> {
  await Promise.all(
    trackIds.map(async (tid) => {
      const track = tracks.find((t) => t.id === tid);
      await updateTrack(tid, {
        expectedVersion: track?.version,
        albumId,
      });
    }),
  );
}

export async function removeTrackFromAlbum(trackId: string): Promise<void> {
  const track = tracks.find((t) => t.id === trackId);
  await updateTrack(trackId, {
    expectedVersion: track?.version,
    albumId: null,
  });
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
