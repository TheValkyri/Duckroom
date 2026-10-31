import {
  getTrackPlaybackUrlServer,
  getVideoPlaybackUrlServer,
  getTrackArtworkUrlServer,
  getAlbumArtworkUrlServer,
  getVideoThumbnailUrlServer,
} from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";

export { BUCKET_NAME };

/**
 * Domain-authorized track playback URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed master URL.
 */
export async function fetchTrackPlaybackUrl(trackId: string): Promise<string> {
  if (!trackId?.trim()) return "";
  try {
    const res = await getTrackPlaybackUrlServer({ data: { trackId } });
    return res?.playbackUrl || "";
  } catch (err) {
    console.error("[Duckroom Audio] Failed to resolve playback URL for track:", trackId, err);
    return "";
  }
}

/**
 * Domain-authorized video playback URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed master URL.
 */
export async function fetchVideoPlaybackUrl(videoId: string): Promise<string> {
  if (!videoId?.trim()) return "";
  try {
    const res = await getVideoPlaybackUrlServer({ data: { videoId } });
    return res?.playbackUrl || "";
  } catch (err) {
    console.error("[Duckroom Video] Failed to resolve playback URL for video:", videoId, err);
    return "";
  }
}

interface CachedAsset {
  url: string;
  expiresAt: number;
}
const clientArtworkCache = new Map<string, CachedAsset>();
const MAX_CLIENT_CACHE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedArtwork(key: string): string | null {
  const item = clientArtworkCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    clientArtworkCache.delete(key);
    return null;
  }
  return item.url;
}

function setCachedArtwork(key: string, url: string): void {
  if (clientArtworkCache.size >= MAX_CLIENT_CACHE) {
    const oldest = clientArtworkCache.keys().next().value;
    if (oldest) clientArtworkCache.delete(oldest);
  }
  clientArtworkCache.set(key, { url, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Domain-authorized track artwork URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed cover URL.
 */
export async function fetchTrackArtworkUrl(trackId: string): Promise<string> {
  if (!trackId?.trim()) return "";
  const cacheKey = `track:${trackId}`;
  const hit = getCachedArtwork(cacheKey);
  if (hit) return hit;
  try {
    const res = await getTrackArtworkUrlServer({ data: { trackId } });
    const url = res?.assetUrl || "";
    if (url) setCachedArtwork(cacheKey, url);
    return url;
  } catch (err) {
    console.error("[Duckroom Artwork] Failed to resolve artwork URL for track:", trackId, err);
    return "";
  }
}

/**
 * Domain-authorized album artwork URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed cover URL.
 */
export async function fetchAlbumArtworkUrl(albumId: string): Promise<string> {
  if (!albumId?.trim()) return "";
  const cacheKey = `album:${albumId}`;
  const hit = getCachedArtwork(cacheKey);
  if (hit) return hit;
  try {
    const res = await getAlbumArtworkUrlServer({ data: { albumId } });
    const url = res?.assetUrl || "";
    if (url) setCachedArtwork(cacheKey, url);
    return url;
  } catch (err) {
    console.error("[Duckroom Artwork] Failed to resolve artwork URL for album:", albumId, err);
    return "";
  }
}

/**
 * Domain-authorized video thumbnail URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed thumbnail URL.
 */
export async function fetchVideoThumbnailUrl(videoId: string): Promise<string> {
  if (!videoId?.trim()) return "";
  const cacheKey = `video:${videoId}`;
  const hit = getCachedArtwork(cacheKey);
  if (hit) return hit;
  try {
    const res = await getVideoThumbnailUrlServer({ data: { videoId } });
    const url = res?.assetUrl || "";
    if (url) setCachedArtwork(cacheKey, url);
    return url;
  } catch (err) {
    console.error("[Duckroom Video] Failed to resolve thumbnail URL for video:", videoId, err);
    return "";
  }
}
