import { createPresignedUrl } from "../lib/s3";
import {
  deleteS3ObjectServer,
  getLibraryManifestServer,
  listS3ObjectsServer,
  saveLibraryManifestServer,
} from "../lib/s3-functions";
import { extractS3KeyFromUrl } from "../lib/s3-key";
import { correctVietnameseLyrics } from "../lib/lyrics-formatter";

export type LyricLine = { time: number; text: string };

export type Track = {
  id: string;
  title: string;
  artist: string;
  albumId: string;
  duration: number; // seconds
  trackNo: number;
  format: "FLAC" | "ALAC" | "WAV";
  bitDepth: number;
  sampleRate: number; // kHz
  sizeMB: number;
  /** Nguồn phát gốc, không transcode. Trống = chưa upload. */
  src?: string;
  cover?: string;
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

export function loadStoredLibrary() {
  if (typeof window === "undefined") return;
  try {
    const storedTracks = localStorage.getItem(STORAGE_KEY_TRACKS);
    if (storedTracks) {
      const parsed: Track[] = JSON.parse(storedTracks);
      parsed.forEach((t) => {
        if (Array.isArray(t.lyrics)) {
          t.lyrics.forEach((l) => {
            if (l.text) l.text = correctVietnameseLyrics(l.text);
          });
        }
      });
      tracks.length = 0;
      tracks.push(...parsed);
    }
    const storedAlbums = localStorage.getItem(STORAGE_KEY_ALBUMS);
    if (storedAlbums) {
      const parsed: Album[] = JSON.parse(storedAlbums);
      albums.length = 0;
      albums.push(...parsed);
    }
    const storedVideos = localStorage.getItem(STORAGE_KEY_VIDEOS);
    if (storedVideos) {
      const parsed: Video[] = JSON.parse(storedVideos);
      videos.length = 0;
      videos.push(...parsed);
    }
    notifyLibrarySubscribers();
  } catch (e) {
    console.warn("Error loading stored library:", e);
  }
}

function isLoggedInClient(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const item = localStorage.getItem(key);
        if (item && item.includes("access_token")) return true;
      }
    }
  } catch (e) {}
  return false;
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStoredLibrary(immediate = false) {
  if (typeof window === "undefined") return;

  notifyLibrarySubscribers();

  if (!isLoggedInClient()) {
    return;
  }

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

  const persistManifest = () => {
    const manifest = { albums, tracks: cleanTracks, videos };
    void saveLibraryManifestServer({ data: { jsonString: JSON.stringify(manifest) } });
  };

  if (immediate) {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    persistManifest();
    return;
  }

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(persistManifest, 800);
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
  if (track && track.src) {
    const key = extractS3KeyFromUrl(track.src);
    if (key) {
      void deleteS3ObjectServer({ data: { key } });
    }
  }
  removeTrackFromLibrary(trackId);
}

export async function deleteVideo(videoId: string) {
  const idx = videos.findIndex((v) => v.id === videoId);
  if (idx >= 0) {
    const video = videos[idx];
    if (video?.src) {
      const key = extractS3KeyFromUrl(video.src);
      if (key) {
        void deleteS3ObjectServer({ data: { key } });
      }
    }
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
    // 1. Fetch S3 Cloud Manifest first for 100% exact metadata across all devices
    const { manifest } = await getLibraryManifestServer();

    if (manifest && Array.isArray(manifest.albums) && Array.isArray(manifest.tracks)) {
      if (manifest.albums.length > 0) {
        albums.length = 0;
        albums.push(...manifest.albums);
      }
      if (manifest.tracks.length > 0) {
        manifest.tracks.forEach((t: Track) => {
          if (Array.isArray(t.lyrics)) {
            t.lyrics.forEach((l) => {
              if (l.text) l.text = correctVietnameseLyrics(l.text);
            });
          }
        });
        tracks.length = 0;
        tracks.push(...manifest.tracks);
      }
      if (Array.isArray(manifest.videos) && manifest.videos.length > 0) {
        videos.length = 0;
        videos.push(...manifest.videos);
      }

      notifyLibrarySubscribers();

      // Ensure presigned URLs are fresh for audio and covers
      await Promise.all(
        tracks.map(async (track) => {
          if (!track.src) return;
          const key = extractS3KeyFromUrl(track.src);
          if (key && (!track.src.includes("X-Amz-Signature") || track.src.endsWith(key))) {
            const fresh = await createPresignedUrl(key);
            if (fresh) track.src = fresh;
          }
        })
      );
      return;
    }

    // 2. Fallback: If S3 manifest does not exist yet on S3, but local tab has data, push local library to S3 manifest!
    if (albums.length > 0 || tracks.length > 0) {
      saveStoredLibrary(true);
      return;
    }

    // 3. Last Fallback: S3 Object Key Auto-Discovery
    const { keys } = await listS3ObjectsServer();
    const s3KeySet = new Set(keys);

    const artworkMap: Record<string, string> = {};
    for (const key of keys) {
      if (key.startsWith("artworks/")) {
        const fileBasename = key.replace("artworks/", "").toLowerCase();
        artworkMap[fileBasename] = key;
      }
    }

    const validTracks = tracks.filter((track) => {
      if (!track.src) return true;
      const key = extractS3KeyFromUrl(track.src);
      if (key) {
        if (!s3KeySet.has(key)) return false;
      }
      return true;
    });

    const validVideos = videos.filter((video) => {
      if (!video.src) return true;
      const key = extractS3KeyFromUrl(video.src);
      if (key) {
        if (!s3KeySet.has(key)) return false;
      }
      return true;
    });

    const audioKeys = keys.filter(
      (k) =>
        /\.(flac|alac|wav|mp3|m4a)$/i.test(k) &&
        (k.startsWith("albums/") || k.startsWith("singles/"))
    );

    audioKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const missingKeys = audioKeys.filter((key) => {
      const parts = key.split("/");
      const filename = parts[parts.length - 1] || "";
      const cleanName = filename.replace(/\.[^/.]+$/, "");
      const trackNoMatch = cleanName.match(/^(\d+)/);
      const rawTitle = trackNoMatch ? cleanName.replace(/^(\d+)\s*[-._\s]+/, "").trim() : cleanName;
      const title = rawTitle.replace(/^RPT\s+MCK\s*-\s*/i, "").trim();

      return !validTracks.some(
        (t) =>
          t.title.toLowerCase() === title.toLowerCase() ||
          (t.src && (t.src.includes(encodeURIComponent(key)) || t.src.includes(key)))
      );
    });

    const presignedResults = await Promise.all(
      missingKeys.map(async (key) => {
        try {
          const url = await createPresignedUrl(key);
          return { key, url };
        } catch {
          return { key, url: "" };
        }
      })
    );
    const presignedMap = new Map(presignedResults.map((r) => [r.key, r.url]));

    const artworkResults = await Promise.all(
      missingKeys.map(async (key, idx) => {
        const parts = key.split("/");
        const filename = parts[parts.length - 1] || "";
        const cleanName = filename.replace(/\.[^/.]+$/, "");
        const trackNoMatch = cleanName.match(/^(\d+)/);
        const trackNo = trackNoMatch ? parseInt(trackNoMatch[1]!, 10) : idx + 1;
        const seqStr = trackNo.toString().padStart(2, "0");
        const rawTitle = cleanName.replace(/^(\d+)\s*[-._\s]+/, "").trim();
        const title = rawTitle.replace(/^RPT\s+MCK\s*-\s*/i, "").trim();

        const targetName = `${seqStr} - ${title}`.toLowerCase();
        const matchKeyName = Object.keys(artworkMap).find(
          (k) => k.includes(targetName) || k.includes(title.toLowerCase())
        );

        if (matchKeyName && artworkMap[matchKeyName]) {
          try {
            const url = await createPresignedUrl(artworkMap[matchKeyName]!);
            return { key, url };
          } catch {
            return { key, url: undefined };
          }
        }
        return { key, url: undefined };
      })
    );
    const artworkUrlMap = new Map(artworkResults.map((r) => [r.key, r.url]));

    for (let index = 0; index < audioKeys.length; index++) {
      const key = audioKeys[index]!;
      const parts = key.split("/");
      const isAlbum = key.startsWith("albums/");
      const albumName = isAlbum ? parts[1] || "HVL" : "Single Collection";
      const filename = parts[parts.length - 1] || "";
      const cleanName = filename.replace(/\.[^/.]+$/, "");

      const trackNoMatch = cleanName.match(/^(\d+)/);
      const trackNo = trackNoMatch ? parseInt(trackNoMatch[1]!, 10) : index + 1;
      const rawTitle = cleanName.replace(/^(\d+)\s*[-._\s]+/, "").trim();
      const title = rawTitle.replace(/^RPT\s+MCK\s*-\s*/i, "").trim();

      const existingAlbum = albums.find(
        (a) => a.title.toLowerCase() === albumName.toLowerCase() || a.id.toLowerCase() === albumName.toLowerCase()
      );
      const albumId = existingAlbum
        ? existingAlbum.id
        : isAlbum
          ? albumName.toLowerCase().replace(/\s+/g, "-")
          : "singles";

      const existingTrack = validTracks.find(
        (t) =>
          t.title.toLowerCase() === title.toLowerCase() ||
          (t.src && (t.src.includes(encodeURIComponent(key)) || t.src.includes(key)))
      );

      if (!existingTrack) {
        const presignedAudioUrl = presignedMap.get(key);
        const customCover = artworkUrlMap.get(key);

        if (presignedAudioUrl) {
          const newTrack: Track = {
            id: `s3-${albumId}-${trackNo}-${title.toLowerCase().replace(/\s+/g, "-")}`,
            title,
            artist: "MCK",
            albumId,
            duration: 180,
            trackNo,
            format: key.toLowerCase().endsWith(".flac") ? "FLAC" : "WAV",
            bitDepth: 24,
            sampleRate: 96,
            sizeMB: 26.5,
            src: presignedAudioUrl,
            cover: customCover,
            lyrics: [],
          };
          validTracks.push(newTrack);
        }
      } else {
        existingTrack.albumId = albumId;
        existingTrack.trackNo = trackNo;
      }

      if (isAlbum && !albums.some((a) => a.id === albumId || a.title.toLowerCase() === albumName.toLowerCase())) {
        const hvlCoverKey = Object.keys(artworkMap).find(
          (k) => k.includes("hvl") || k.includes("cover") || k.includes("poster")
        );
        const albumCoverKey = hvlCoverKey ? artworkMap[hvlCoverKey] : undefined;
        let albumCoverUrl = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80";

        if (albumCoverKey) {
          const presignedCover = await createPresignedUrl(albumCoverKey);
          if (presignedCover) albumCoverUrl = presignedCover;
        }

        albums.push({
          id: albumId,
          title: albumName,
          artist: "MCK",
          year: 2026,
          cover: albumCoverUrl,
          accent: "oklch(0.3 0.1 260)",
          note: "Album từ S3 Storage",
        });
      }
    }

    tracks.length = 0;
    tracks.push(...validTracks);

    videos.length = 0;
    videos.push(...validVideos);

    saveStoredLibrary(true);
  } catch (err) {
    console.error("S3 Sync error:", err);
  }
}

export function clearAllTracks() {
  for (const track of tracks) {
    if (track.src) {
      const key = extractS3KeyFromUrl(track.src);
      if (key) {
        void deleteS3ObjectServer({ data: { key } });
      }
    }
  }
  for (const video of videos) {
    if (video.src) {
      const key = extractS3KeyFromUrl(video.src);
      if (key) {
        void deleteS3ObjectServer({ data: { key } });
      }
    }
  }

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
  const cleanId = (id || "").toLowerCase();
  return (
    albums.find((a) => a.id === id) ||
    albums.find((a) => a.id.toLowerCase() === cleanId) ||
    albums.find((a) => a.title.toLowerCase() === cleanId) ||
    albums.find((a) => cleanId.includes(a.title.toLowerCase()) || a.title.toLowerCase().includes(cleanId))
  );
};
export const trackById = (id: string) => tracks.find((t) => t.id === id);
export const albumTracks = (id: string) => {
  const targetAlbum = albumById(id);
  const targetTitle = targetAlbum?.title.toLowerCase() || id.toLowerCase();
  const targetId = id.toLowerCase();

  const list = tracks.filter((t) => {
    const trackAlbum = (t.albumId || "").toLowerCase();
    return (
      trackAlbum === targetId ||
      trackAlbum === targetTitle ||
      (targetAlbum && (trackAlbum.includes(targetTitle) || targetTitle.includes(trackAlbum)))
    );
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
    cover:
      data.cover ||
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80",
    accent: `oklch(0.${Math.floor(Math.random() * 3) + 3} 0.1 ${Math.floor(
      Math.random() * 360
    )})`,
    note: data.note || "Album tự tạo",
  };
  albums.push(newAlbum);
  saveStoredLibrary(true);
  return newAlbum;
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