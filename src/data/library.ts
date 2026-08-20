import { createPresignedUrl } from "../lib/s3";
import {
  deleteTrackDomainServer,
  deleteVideoDomainServer,
  getLibraryManifestServer,
  saveLibraryManifestServer,
} from "../lib/s3-functions";
import { extractS3KeyFromUrl } from "../lib/s3-key";
import { getPublicMasterLibraryServer, replaceMasterLibraryServer } from "../lib/master-library";

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
  src?: string;
  cover?: string;
  year?: number;
  lyrics: LyricLine[];
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  cover: string;
  accent: string; // oklch, dùng cho nền động
  note: string;
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
  src?: string;
};

export const albums: Album[] = [];
export const tracks: Track[] = [];
export const videos: Video[] = [];

const STORAGE_KEY_TRACKS = "duckroom_tracks_v1";
const STORAGE_KEY_ALBUMS = "duckroom_albums_v1";
const STORAGE_KEY_VIDEOS = "duckroom_videos_v1";

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

export function getAlbumPriority(album: { id?: string; title?: string }): number {
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

export function loadStoredLibrary() {
  if (typeof window === "undefined") return;
  try {
    const storedTracks = localStorage.getItem(STORAGE_KEY_TRACKS);
    if (storedTracks) {
      const parsed: Track[] = JSON.parse(storedTracks);
      parsed.forEach((t) => {
        if (t.cover?.startsWith("blob:")) {
          delete t.cover;
        }
      });
      tracks.length = 0;
      tracks.push(...parsed);
    }
    const storedAlbums = localStorage.getItem(STORAGE_KEY_ALBUMS);
    if (storedAlbums) {
      const parsed: Album[] = JSON.parse(storedAlbums);
      parsed.forEach((a) => {
        if (a.cover?.startsWith("blob:") || a.cover?.includes("fbcdn.net")) {
          a.cover = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80";
        }
      });
      albums.length = 0;
      albums.push(...sortAlbumsDeterministically(parsed));
    }
    const storedVideos = localStorage.getItem(STORAGE_KEY_VIDEOS);
    if (storedVideos) {
      const parsed: Video[] = JSON.parse(storedVideos);
      parsed.forEach((v) => {
        if (v.thumb?.startsWith("blob:") || v.thumb?.includes("fbcdn.net")) {
          v.thumb = "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80";
        }
      });
      videos.length = 0;
      videos.push(...parsed);
    }
    notifyLibrarySubscribers();
  } catch (e) {
    console.warn("Error loading stored library:", e);
  }
}

async function canPersistMasterLibrary(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { supabase } = await import("../lib/supabase-client");
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user);
  } catch {
    return false;
  }
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStoredLibrary(immediate = false) {
  if (typeof window === "undefined") return;

  // Strip signed URL query params before saving to localStorage and manifest
  const cleanTracks = tracks.map((t) => {
    if (!t.src) return t;
    const key = extractS3KeyFromUrl(t.src);
    return key ? { ...t, src: key } : t;
  });

  try {
    localStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(cleanTracks));
    localStorage.setItem(STORAGE_KEY_ALBUMS, JSON.stringify(albums));
    localStorage.setItem(STORAGE_KEY_VIDEOS, JSON.stringify(videos));
  } catch (e) {
    console.warn("Error saving library to localStorage:", e);
  }

  const persistManifest = async () => {
    if (!(await canPersistMasterLibrary())) return;
    const manifest = { albums, tracks: cleanTracks, videos };
    try {
      const canonical = await replaceMasterLibraryServer({ data: { albums, tracks: cleanTracks, videos } });
      if (!canonical.success) console.error("Failed to persist canonical library");
    } catch (error) {
      console.error("Canonical library persistence failed:", error);
    }
    try {
      const result = await saveLibraryManifestServer({ data: { jsonString: JSON.stringify(manifest) } });
      if (!result.success) console.error("Failed to persist recovery manifest");
    } catch (error) {
      console.error("Recovery manifest persistence failed:", error);
    }
  };

  if (immediate) {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    void persistManifest();
    return;
  }

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    void persistManifest();
  }, 800);
}

export function removeTrackFromLibrary(id: string) {
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tracks.splice(idx, 1);
    saveStoredLibrary(true);
  }
}

export async function deleteTrack(trackId: string) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return false;
  const result = await deleteTrackDomainServer({ data: { trackId } });
  if (!result.success) throw new Error("Domain track delete failed");
  removeTrackFromLibrary(trackId);
  return true;
}

export async function deleteVideo(videoId: string) {
  const idx = videos.findIndex((v) => v.id === videoId);
  if (idx >= 0) {
    const result = await deleteVideoDomainServer({ data: { videoId } });
    if (!result.success) throw new Error("Domain video delete failed");
    videos.splice(idx, 1);
    saveStoredLibrary(true);
  }
}

let lastSyncTime = 0;

export async function syncLibraryWithS3(force = false) {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (!force && now - lastSyncTime < 30000 && tracks.length > 0) {
    return;
  }
  lastSyncTime = now;

  try {
    // V2 canonical path: Supabase PostgreSQL is the singular source of truth.
    try {
      const canonical = await getPublicMasterLibraryServer();
      // Empty array is a valid library state - do NOT treat as error or fallback to manifest
      albums.length = 0;
      albums.push(...sortAlbumsDeterministically((canonical.albums as Album[]) || []));
      tracks.length = 0;
      tracks.push(...(canonical.tracks as Track[]));
      videos.length = 0;
      videos.push(...(canonical.videos as Video[]));
      notifyLibrarySubscribers();
      return;
    } catch (canonicalError) {
      console.warn(
        "Canonical library unavailable (offline/network); checking recovery manifest fallback",
        canonicalError,
      );
    }

    // Legacy recovery path. Do not treat it as the long-term source of truth.
    const { manifest } = await getLibraryManifestServer();

    if (manifest && Array.isArray(manifest.albums) && Array.isArray(manifest.tracks)) {
      if (manifest.albums.length > 0) {
        manifest.albums.forEach((a: Album) => {
          if (a.cover?.startsWith("blob:") || a.cover?.includes("fbcdn.net")) {
            a.cover = "artworks/31-1786731489463-2rml2-HVL.jpg";
          }
        });
        albums.length = 0;
        albums.push(...manifest.albums);
      }
      if (manifest.tracks.length > 0) {
        manifest.tracks.forEach((t: Track) => {
          if (t.cover?.startsWith("blob:")) {
            delete t.cover;
          }
        });
        tracks.length = 0;
        tracks.push(...manifest.tracks);
      }
      if (Array.isArray(manifest.videos) && manifest.videos.length > 0) {
        manifest.videos.forEach((v: Video) => {
          if (v.thumb?.startsWith("blob:") || v.thumb?.includes("fbcdn.net")) {
            v.thumb = "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80";
          }
        });
        videos.length = 0;
        videos.push(...manifest.videos);
      }

      notifyLibrarySubscribers();

      // Ensure presigned URLs are fresh for audio, track covers, album covers, and video thumbs
      await Promise.all([
        ...tracks.map(async (track) => {
          if (track.src) {
            const key = extractS3KeyFromUrl(track.src);
            if (key) {
              const fresh = await createPresignedUrl(key);
              if (fresh) track.src = fresh;
            }
          }
          if (
            track.cover &&
            (track.cover.startsWith("artworks/") ||
              track.cover.startsWith("covers/") ||
              track.cover.includes("s3.pikamc.vn") ||
              track.cover.includes("pikamc"))
          ) {
            const key = extractS3KeyFromUrl(track.cover);
            if (key) {
              const fresh = await createPresignedUrl(key);
              if (fresh) track.cover = fresh;
            }
          }
        }),
        ...albums.map(async (album) => {
          if (
            album.cover &&
            (album.cover.startsWith("artworks/") ||
              album.cover.startsWith("covers/") ||
              album.cover.includes("s3.pikamc.vn") ||
              album.cover.includes("pikamc") ||
              album.cover.includes("HVL") ||
              album.title.toLowerCase() === "hvl")
          ) {
            const key =
              extractS3KeyFromUrl(album.cover) ||
              (album.title.toLowerCase() === "hvl" ? "artworks/31-1786731489463-2rml2-HVL.jpg" : null);
            if (key) {
              const fresh = await createPresignedUrl(key);
              if (fresh) album.cover = fresh;
            }
          }
        }),
        ...videos.map(async (video) => {
          if (video.src) {
            const key = extractS3KeyFromUrl(video.src);
            if (key) {
              const fresh = await createPresignedUrl(key);
              if (fresh) video.src = fresh;
            }
          }
          if (
            video.thumb &&
            (video.thumb.startsWith("artworks/") ||
              video.thumb.startsWith("covers/") ||
              video.thumb.includes("s3.pikamc.vn") ||
              video.thumb.includes("pikamc"))
          ) {
            const key = extractS3KeyFromUrl(video.thumb);
            if (key) {
              const fresh = await createPresignedUrl(key);
              if (fresh) video.thumb = fresh;
            }
          }
        }),
      ]);
      notifyLibrarySubscribers();
      return;
    }
  } catch (err) {
    console.error("Master library sync error:", err);
  }
}

export function clearAllTracks() {
  tracks.length = 0;
  albums.length = 0;
  videos.length = 0;
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY_TRACKS);
    localStorage.removeItem(STORAGE_KEY_ALBUMS);
    localStorage.removeItem(STORAGE_KEY_VIDEOS);
  }
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

export function createAlbum(data: {
  title: string;
  artist: string;
  year?: number;
  cover?: string;
  note?: string;
}): Album {
  const id = `album-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newAlbum: Album = {
    id,
    title: data.title.trim(),
    artist: data.artist.trim() || "Nghệ sĩ",
    year: data.year || new Date().getFullYear(),
    cover: data.cover || "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80",
    accent: `oklch(0.${Math.floor(Math.random() * 3) + 3} 0.1 ${Math.floor(Math.random() * 360)})`,
    note: data.note || "Album tự tạo",
  };
  albums.push(newAlbum);
  saveStoredLibrary(true);
  return newAlbum;
}

export function updateAlbum(
  albumId: string,
  data: {
    title?: string;
    artist?: string;
    year?: number;
    cover?: string;
    note?: string;
  },
): Album | null {
  const album = albums.find((a) => a.id === albumId);
  if (!album) return null;

  if (data.title !== undefined) album.title = data.title.trim();
  if (data.artist !== undefined) album.artist = data.artist.trim();
  if (data.year !== undefined) album.year = data.year;
  if (data.cover !== undefined) album.cover = data.cover;
  if (data.note !== undefined) album.note = data.note.trim();

  saveStoredLibrary(true);
  notifyLibrarySubscribers();
  return album;
}

export function deleteAlbum(albumId: string) {
  const idx = albums.findIndex((a) => a.id === albumId);
  if (idx >= 0) {
    albums.splice(idx, 1);
    for (const t of tracks) {
      if (t.albumId === albumId) {
        t.albumId = "singles";
      }
    }
    saveStoredLibrary(true);
  }
}

export function addTracksToAlbum(albumId: string, trackIds: string[]) {
  for (const tid of trackIds) {
    const t = tracks.find((x) => x.id === tid);
    if (t) t.albumId = albumId;
  }
  saveStoredLibrary(true);
}

export function removeTrackFromAlbum(trackId: string) {
  const t = tracks.find((x) => x.id === trackId);
  if (t) {
    t.albumId = "singles";
    saveStoredLibrary(true);
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
