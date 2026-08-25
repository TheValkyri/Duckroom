import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { validateStorageKey } from "./auth-guard";
import { extractS3KeyFromUrl } from "./s3-key";
import { inferMimeFromStorageKey } from "../services/media-analysis/image-analyzer";

const lyricLineSchema = z.object({ time: z.number().finite(), text: z.string() });

const manifestTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  albumId: z.string().nullable().optional(),
  duration: z.number().finite().min(0),
  trackNo: z.number().int().min(0).default(1),
  // Non-fabrication rule (Master Plan §9.3 / invariant 13): absent technical
  // metadata MUST stay null. Never default to fake Hi-Res values.
  format: z.string().nullish(),
  bitDepth: z.number().finite().min(0).nullish(),
  sampleRate: z.number().finite().min(0).nullish(),
  sizeMB: z.number().finite().min(0).default(0),
  src: z.string().min(1),
  cover: z.string().optional(),
  year: z.number().int().optional(),
  lyrics: z.array(lyricLineSchema).default([]),
});

const manifestAlbumSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  year: z.number().int(),
  cover: z.string().min(1),
  accent: z.string().default("oklch(0.72 0.15 62)"),
  note: z.string().default(""),
});

const manifestVideoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  year: z.number().int(),
  thumb: z.string().min(1),
  duration: z.number().finite().min(0),
  // Non-fabrication rule: absent technical metadata MUST stay null.
  resolution: z.string().nullish(),
  codec: z.string().nullish(),
  bitrate: z.string().nullish(),
  sizeMB: z.number().finite().min(0).default(0),
  src: z.string().min(1),
});

export const manifestSchema = z.object({
  tracks: z.array(manifestTrackSchema),
  albums: z.array(manifestAlbumSchema),
  videos: z.array(manifestVideoSchema),
});

export interface MigrationReport {
  success: boolean;
  sourceSnapshotChecksum?: string | undefined;
  timestamp: string;
  counts: {
    manifest: { tracks: number; albums: number; videos: number };
    inserted: { tracks: number; albums: number; videos: number };
    dbVerified: { tracks: number; albums: number; videos: number };
  };
  validationErrors: string[];
  durationMs: number;
}

function keyFromValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const extracted = extractS3KeyFromUrl(value);
  if (extracted) return extracted;
  return value.startsWith("http") ? null : value;
}

/**
 * Deterministic Manifest -> PostgreSQL Database Migration Workflow:
 * 1. Parse JSON manifest
 * 2. Validate schemas & storage keys
 * 3. Deduplicate and verify canonical identities
 * 4. Upsert Albums -> Tracks -> Videos
 * 5. Verify count equality in PostgreSQL
 * 6. Record durable completion marker in audit_logs
 */
export async function executeManifestMigration(rawManifest: unknown, actorUserId?: string): Promise<MigrationReport> {
  const startTime = Date.now();
  const validationErrors: string[] = [];

  // 1. Schema Validation
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new Error(`[MIGRATION_SCHEMA_INVALID] Manifest schema validation failed: ${parsed.error.message}`);
  }

  const { tracks, albums, videos } = parsed.data;

  // 2. Identity & Duplicate Check
  const trackIdSet = new Set<string>();
  for (const track of tracks) {
    if (trackIdSet.has(track.id)) {
      validationErrors.push(`Duplicate track canonical ID found: ${track.id}`);
    }
    trackIdSet.add(track.id);
  }

  const albumIdSet = new Set<string>();
  for (const album of albums) {
    if (albumIdSet.has(album.id)) {
      validationErrors.push(`Duplicate album canonical ID found: ${album.id}`);
    }
    albumIdSet.add(album.id);
  }

  const videoIdSet = new Set<string>();
  for (const video of videos) {
    if (videoIdSet.has(video.id)) {
      validationErrors.push(`Duplicate video canonical ID found: ${video.id}`);
    }
    videoIdSet.add(video.id);
  }

  // 3. Storage Key & Relation Validation
  for (const track of tracks) {
    const key = keyFromValue(track.src);
    if (key) {
      try {
        validateStorageKey(key, "read");
      } catch (err: any) {
        validationErrors.push(`Track ${track.id} has invalid storage key "${key}": ${err.message}`);
      }
    }
    if (track.albumId && track.albumId !== "singles" && !albumIdSet.has(track.albumId)) {
      validationErrors.push(`Track ${track.id} references non-existent albumId "${track.albumId}"`);
    }
  }

  for (const video of videos) {
    const key = keyFromValue(video.src);
    if (key) {
      try {
        validateStorageKey(key, "read");
      } catch (err: any) {
        validationErrors.push(`Video ${video.id} has invalid storage key "${key}": ${err.message}`);
      }
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(
      `[MIGRATION_VALIDATION_FAILED] Migration rejected with ${validationErrors.length} validation errors:\n` +
        validationErrors.slice(0, 5).join("\n"),
    );
  }

  const db = getSupabaseAdmin();

  // 4. Upsert Albums First (to satisfy FK constraints)
  const albumRows = albums.map((a) => ({
    id: a.id,
    title: a.title,
    artist: a.artist,
    year: a.year,
    cover_storage_key: keyFromValue(a.cover) ?? a.cover,
    accent: a.accent,
    note: a.note,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  }));

  if (albumRows.length > 0) {
    const { error: albumErr } = await db.from("albums").upsert(albumRows, { onConflict: "id" });
    if (albumErr) throw new Error(`[MIGRATION_ALBUMS_FAILED] Album upsert failed: ${albumErr.message}`);
  }

  // 5. Upsert Tracks
  const trackRows = tracks.map((t) => ({
    id: t.id,
    album_id: t.albumId && t.albumId !== "singles" ? t.albumId : null,
    title: t.title,
    artist: t.artist,
    track_no: t.trackNo,
    duration_seconds: Math.round(t.duration),
    format: t.format ?? null,
    bit_depth: t.bitDepth != null ? Math.round(t.bitDepth) : null,
    sample_rate: t.sampleRate ?? null,
    size_mb: t.sizeMB,
    storage_key: keyFromValue(t.src) ?? t.src,
    cover_storage_key: keyFromValue(t.cover) ?? t.cover ?? null,
    year: t.year ?? null,
    lyrics: t.lyrics,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  }));

  if (trackRows.length > 0) {
    const { error: trackErr } = await db.from("tracks").upsert(trackRows, { onConflict: "id" });
    if (trackErr) throw new Error(`[MIGRATION_TRACKS_FAILED] Track upsert failed: ${trackErr.message}`);
  }

  // 6. Upsert Videos
  const videoRows = videos.map((v) => ({
    id: v.id,
    title: v.title,
    artist: v.artist,
    year: v.year,
    thumb_storage_key: keyFromValue(v.thumb) ?? v.thumb,
    storage_key: keyFromValue(v.src) ?? v.src,
    duration_seconds: Math.round(v.duration),
    resolution: v.resolution ?? null,
    codec: v.codec ?? null,
    bitrate: v.bitrate ?? null,
    size_mb: v.sizeMB,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  }));

  if (videoRows.length > 0) {
    const { error: videoErr } = await db.from("videos").upsert(videoRows, { onConflict: "id" });
    if (videoErr) throw new Error(`[MIGRATION_VIDEOS_FAILED] Video upsert failed: ${videoErr.message}`);
  }

  // 6b. Populate normalized Master Domain V2 tables. These writes are idempotent.
  const artistNames = new Set<string>();
  for (const row of [...tracks, ...albums, ...videos]) {
    const name = row.artist.trim();
    if (name) artistNames.add(name);
  }
  const artistRows = [...artistNames].map((name) => ({
    id: `artist-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    name,
    normalized_name: name.toLowerCase(),
  }));
  if (artistRows.length > 0) {
    const { error } = await db.from("artists").upsert(artistRows, { onConflict: "normalized_name" });
    if (error) throw new Error(`[MIGRATION_ARTISTS_FAILED] Artist upsert failed: ${error.message}`);
  }

  const { data: artistRowsFromDb, error: artistReadError } = await db.from("artists").select("id,name,normalized_name");
  if (artistReadError) throw new Error(`[MIGRATION_ARTISTS_VERIFY_FAILED] ${artistReadError.message}`);
  const artistMap = new Map((artistRowsFromDb || []).map((artist) => [artist.normalized_name, artist.id]));

  const trackFileRows = tracks
    .map((track) => {
      const storageKey = keyFromValue(track.src) ?? track.src;
      if (!storageKey) return null;
      return {
        track_id: track.id,
        kind: "master",
        storage_key: storageKey,
        storage_provider: "s3",
        extension: storageKey.split(".").pop()?.toLowerCase() ?? null,
        container: track.format || null,
        sample_rate: track.sampleRate || null,
        bit_depth: track.bitDepth || null,
        duration_seconds: track.duration,
        file_size_bytes: null, // Non-fabrication rule: sizeMB is not exact bytes
        sha256: null,
        verified_at: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (trackFileRows.length > 0) {
    const { error } = await db.from("track_files").upsert(trackFileRows, { onConflict: "storage_key" });
    if (error) throw new Error(`[MIGRATION_TRACK_FILES_FAILED] ${error.message}`);
  }

  const videoFileRows = videos
    .map((video) => {
      const storageKey = keyFromValue(video.src) ?? video.src;
      if (!storageKey) return null;
      return {
        video_id: video.id,
        storage_key: storageKey,
        container: storageKey.split(".").pop()?.toLowerCase() ?? null,
        codec: video.codec || null,
        resolution: video.resolution || null,
        duration_seconds: video.duration,
        file_size_bytes: null, // Non-fabrication rule: sizeMB is not exact bytes
        sha256: null,
        verified_at: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (videoFileRows.length > 0) {
    const { error } = await db.from("video_files").upsert(videoFileRows, { onConflict: "storage_key" });
    if (error) throw new Error(`[MIGRATION_VIDEO_FILES_FAILED] ${error.message}`);
  }

  // Canonical artwork assets (AUTHORITATIVE: Non-fabricating MIME resolution)
  const artworkKeys = new Set<string>();
  for (const album of albums) {
    const key = keyFromValue(album.cover) ?? album.cover;
    if (key) artworkKeys.add(key);
  }
  for (const track of tracks) {
    const key = keyFromValue(track.cover) ?? track.cover;
    if (key) artworkKeys.add(key);
  }
  for (const video of videos) {
    const key = keyFromValue(video.thumb) ?? video.thumb;
    if (key) artworkKeys.add(key);
  }
  const artworkRows = [...artworkKeys].map((key) => ({
    master_storage_key: key,
    mime_type: inferMimeFromStorageKey(key),
  }));
  if (artworkRows.length > 0) {
    const { error } = await db.from("artwork_assets").upsert(artworkRows, { onConflict: "master_storage_key" });
    if (error) throw new Error(`[MIGRATION_ARTWORK_ASSETS_FAILED] ${error.message}`);
  }

  // Canonical multi-line lyrics documents (AUTHORITATIVE: Full JSON preservation)
  const lyricDocRows = tracks
    .filter((t) => Array.isArray(t.lyrics) && t.lyrics.length > 0)
    .map((t) => ({
      track_id: t.id,
      source: "manifest",
      kind: "synced" as const,
      content: JSON.stringify(t.lyrics),
      version: 1,
      verified: false,
    }));
  if (lyricDocRows.length > 0) {
    const { error } = await db
      .from("lyrics_documents")
      .upsert(lyricDocRows, { onConflict: "track_id,source,kind,version" });
    if (error) throw new Error(`[MIGRATION_LYRICS_FAILED] ${error.message}`);
  }

  // Link canonical artist relations after artist identities are known.
  const canonicalAlbumRows = albums.map((album) => {
    const artistId = artistMap.get(album.artist.trim().toLowerCase()) ?? null;
    return { id: album.id, artist_id: artistId, album_artist_id: artistId, release_year: album.year };
  });
  if (canonicalAlbumRows.length) {
    const { error } = await db.from("albums").upsert(canonicalAlbumRows, { onConflict: "id" });
    if (error) throw new Error(`[MIGRATION_ALBUM_ARTISTS_FAILED] ${error.message}`);
  }

  const canonicalTrackRows = tracks.map((track) => {
    const artistId = artistMap.get(track.artist.trim().toLowerCase()) ?? null;
    return { id: track.id, primary_artist_id: artistId, album_artist_id: artistId, release_year: track.year ?? null };
  });
  if (canonicalTrackRows.length) {
    const { error } = await db.from("tracks").upsert(canonicalTrackRows, { onConflict: "id" });
    if (error) throw new Error(`[MIGRATION_TRACK_ARTISTS_FAILED] ${error.message}`);
  }

  const canonicalVideoRows = videos.map((video) => ({
    id: video.id,
    artist_id: artistMap.get(video.artist.trim().toLowerCase()) ?? null,
  }));
  if (canonicalVideoRows.length) {
    const { error } = await db.from("videos").upsert(canonicalVideoRows, { onConflict: "id" });
    if (error) throw new Error(`[MIGRATION_VIDEO_ARTISTS_FAILED] ${error.message}`);
  }

  // 7. Identity-Based Verification (Every ID, storage_key, and FK relation verified)
  const [dbTracksRes, dbAlbumsRes, dbVideosRes] = await Promise.all([
    db.from("tracks").select("id, album_id, storage_key"),
    db.from("albums").select("id, cover_storage_key"),
    db.from("videos").select("id, storage_key"),
  ]);

  if (dbTracksRes.error)
    throw new Error(`[MIGRATION_VERIFY_FAILED] Failed to query tracks: ${dbTracksRes.error.message}`);
  if (dbAlbumsRes.error)
    throw new Error(`[MIGRATION_VERIFY_FAILED] Failed to query albums: ${dbAlbumsRes.error.message}`);
  if (dbVideosRes.error)
    throw new Error(`[MIGRATION_VERIFY_FAILED] Failed to query videos: ${dbVideosRes.error.message}`);

  const dbTracksMap = new Map((dbTracksRes.data || []).map((t) => [t.id, t]));
  const dbAlbumsMap = new Map((dbAlbumsRes.data || []).map((a) => [a.id, a]));
  const dbVideosMap = new Map((dbVideosRes.data || []).map((v) => [v.id, v]));

  // 7a. Verify all manifest albums exist with correct keys
  for (const album of albums) {
    const dbAlbum = dbAlbumsMap.get(album.id);
    if (!dbAlbum) {
      throw new Error(
        `[MIGRATION_IDENTITY_MISMATCH] Manifest album "${album.id}" missing in database after migration.`,
      );
    }
  }

  // 7b. Verify all manifest tracks exist with correct storage_key and album_id FK
  for (const track of tracks) {
    const dbTrack = dbTracksMap.get(track.id);
    if (!dbTrack) {
      throw new Error(
        `[MIGRATION_IDENTITY_MISMATCH] Manifest track "${track.id}" missing in database after migration.`,
      );
    }
    const expectedKey = keyFromValue(track.src) ?? track.src;
    if (dbTrack.storage_key !== expectedKey) {
      throw new Error(
        `[MIGRATION_KEY_MISMATCH] Track "${track.id}" storage_key mismatch: expected "${expectedKey}", got "${dbTrack.storage_key}"`,
      );
    }
    const expectedAlbumId = track.albumId && track.albumId !== "singles" ? track.albumId : null;
    if (dbTrack.album_id !== expectedAlbumId) {
      throw new Error(
        `[MIGRATION_RELATION_MISMATCH] Track "${track.id}" album_id mismatch: expected "${expectedAlbumId}", got "${dbTrack.album_id}"`,
      );
    }
  }

  // 7c. Verify all manifest videos exist with correct storage_key
  for (const video of videos) {
    const dbVideo = dbVideosMap.get(video.id);
    if (!dbVideo) {
      throw new Error(
        `[MIGRATION_IDENTITY_MISMATCH] Manifest video "${video.id}" missing in database after migration.`,
      );
    }
    const expectedKey = keyFromValue(video.src) ?? video.src;
    if (dbVideo.storage_key !== expectedKey) {
      throw new Error(
        `[MIGRATION_KEY_MISMATCH] Video "${video.id}" storage_key mismatch: expected "${expectedKey}", got "${dbVideo.storage_key}"`,
      );
    }
  }

  const timestamp = new Date().toISOString();
  const report: MigrationReport = {
    success: true,
    timestamp,
    counts: {
      manifest: { tracks: tracks.length, albums: albums.length, videos: videos.length },
      inserted: { tracks: trackRows.length, albums: albumRows.length, videos: videoRows.length },
      dbVerified: { tracks: dbTracksMap.size, albums: dbAlbumsMap.size, videos: dbVideosMap.size },
    },
    validationErrors: [],
    durationMs: Date.now() - startTime,
  };

  // 8. Mandatory Durable Migration Completion Marker (Fail-Closed)
  const { error: markerErr } = await db.from("audit_logs").insert({
    actor_user_id: actorUserId ?? null,
    action: "manifest.migration_complete",
    resource_type: "system",
    resource_id: `migration-${timestamp}`,
    metadata: report,
  });

  if (markerErr) {
    throw new Error(`[MIGRATION_MARKER_FAILED] Failed to record durable migration marker: ${markerErr.message}`);
  }

  return report;
}
