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

/**
 * Domain-authorized track artwork URL resolver:
 * Queries canonical database, verifies visibility against caller role, and retrieves signed cover URL.
 */
export async function fetchTrackArtworkUrl(trackId: string): Promise<string> {
  if (!trackId?.trim()) return "";
  try {
    const res = await getTrackArtworkUrlServer({ data: { trackId } });
    return res?.assetUrl || "";
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
  try {
    const res = await getAlbumArtworkUrlServer({ data: { albumId } });
    return res?.assetUrl || "";
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
  try {
    const res = await getVideoThumbnailUrlServer({ data: { videoId } });
    return res?.assetUrl || "";
  } catch (err) {
    console.error("[Duckroom Video] Failed to resolve thumbnail URL for video:", videoId, err);
    return "";
  }
}
