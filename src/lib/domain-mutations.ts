import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { extractS3KeyFromUrl } from "./s3-key";

export class ConcurrencyConflictError extends Error {
  code = "STALE_REVISION" as const;
  status = 409;
  constructor(message = "Stale revision: Resource was modified by another session.") {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

export class ResourceNotFoundError extends Error {
  code = "RESOURCE_NOT_FOUND" as const;
  status = 404;
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class DomainValidationError extends Error {
  code = "INVALID_REVISION" as const;
  status = 400;
  constructor(message = "expectedVersion is mandatory for updates and must be a positive integer.") {
    super(message);
    this.name = "DomainValidationError";
  }
}

function keyFromValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const extracted = extractS3KeyFromUrl(value);
  if (extracted) return extracted;
  return value.startsWith("http") ? null : value;
}

const lyricLineSchema = z.object({ time: z.number().finite(), text: z.string() });

// ==========================================
// ALBUM DOMAIN MUTATIONS
// ==========================================

export interface CreateAlbumInput {
  id?: string | undefined;
  title: string;
  artist: string;
  year?: number | undefined;
  cover?: string | undefined;
  accent?: string | undefined;
  note?: string | undefined;
}

export interface UpdateAlbumInput {
  id: string;
  expectedVersion: number;
  title?: string | undefined;
  artist?: string | undefined;
  year?: number | undefined;
  cover?: string | undefined;
  accent?: string | undefined;
  note?: string | undefined;
}

export async function createAlbumDomainInternal(data: CreateAlbumInput, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const id = data.id || `album-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanCover = keyFromValue(data.cover) ?? data.cover ?? "";
  const row = {
    id,
    title: data.title.trim(),
    artist: data.artist.trim() || "Nghệ sĩ",
    year: data.year || new Date().getFullYear(),
    cover_storage_key: cleanCover,
    accent: data.accent || `oklch(0.${Math.floor(Math.random() * 3) + 3} 0.1 ${Math.floor(Math.random() * 360)})`,
    note: data.note ? data.note.trim() : "",
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await db.from("albums").insert(row).select().single();
  if (error) throw new Error(`Album creation failed: ${error.message}`);

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "album.create",
      resource_type: "album",
      resource_id: id,
      metadata: { title: row.title, artist: row.artist },
    });
  } catch {
    // Ignore audit log failure
  }

  return inserted;
}

export async function updateAlbumDomainInternal(data: UpdateAlbumInput, actorUserId?: string) {
  if (typeof data.expectedVersion !== "number" || !Number.isInteger(data.expectedVersion) || data.expectedVersion < 1) {
    throw new DomainValidationError("expectedVersion is mandatory for updateAlbum and must be an integer >= 1.");
  }

  const db = getSupabaseAdmin();

  const updates: Record<string, any> = {
    version: data.expectedVersion + 1,
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updates["title"] = data.title.trim();
  if (data.artist !== undefined) updates["artist"] = data.artist.trim();
  if (data.year !== undefined) updates["year"] = data.year;
  if (data.cover !== undefined) updates["cover_storage_key"] = keyFromValue(data.cover) ?? data.cover;
  if (data.accent !== undefined) updates["accent"] = data.accent;
  if (data.note !== undefined) updates["note"] = data.note.trim();

  const { data: updated, error } = await db
    .from("albums")
    .update(updates)
    .eq("id", data.id)
    .eq("version", data.expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Album update failed: ${error.message}`);

  if (!updated) {
    const { data: existing } = await db.from("albums").select("id, version").eq("id", data.id).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Album ${data.id} is at version ${existingVersion}, expected ${data.expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Album ${data.id} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "album.update",
      resource_type: "album",
      resource_id: data.id,
      metadata: { updates, newVersion: (updated as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return updated;
}

export async function trashAlbumDomainInternal(albumId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "trash",
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("albums").update(updates).eq("id", albumId).eq("version", expectedVersion);

  const { data: trashed, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Album trash failed: ${error.message}`);
  if (!trashed) {
    const { data: existing } = await db.from("albums").select("id, version").eq("id", albumId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Album ${albumId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Album ${albumId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "album.trash",
      resource_type: "album",
      resource_id: albumId,
      metadata: { status: "trash", version: (trashed as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return trashed;
}

export async function restoreAlbumDomainInternal(albumId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "active",
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("albums").update(updates).eq("id", albumId).eq("version", expectedVersion);

  const { data: restored, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Album restore failed: ${error.message}`);
  if (!restored) {
    const { data: existing } = await db.from("albums").select("id, version").eq("id", albumId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Album ${albumId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Album ${albumId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "album.restore",
      resource_type: "album",
      resource_id: albumId,
      metadata: { status: "active", version: (restored as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return restored;
}

// ==========================================
// TRACK DOMAIN MUTATIONS
// ==========================================

export interface CreateTrackInput {
  id?: string | undefined;
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
  lyrics?: { time: number; text: string }[] | undefined;
  lyricsSource?: string | null | undefined;
}

export interface UpdateTrackInput {
  id: string;
  expectedVersion: number;
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
  lyrics?: { time: number; text: string }[] | undefined;
  lyricsSource?: string | null | undefined;
}

export async function createTrackDomainInternal(data: CreateTrackInput, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const id = data.id || `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanSrc = keyFromValue(data.src) ?? data.src ?? "";
  const cleanCover = keyFromValue(data.cover) ?? data.cover ?? null;

  const row = {
    id,
    title: data.title.trim(),
    artist: data.artist.trim() || "Nghệ sĩ",
    album_id: data.albumId && data.albumId !== "singles" ? data.albumId : null,
    track_no: data.trackNo || 1,
    duration_seconds: Math.round(data.duration || 0),
    format: data.format || "UNKNOWN",
    bit_depth: Math.round(data.bitDepth || 0),
    sample_rate: data.sampleRate || 0,
    size_mb: data.sizeMB || 0,
    storage_key: cleanSrc,
    cover_storage_key: cleanCover,
    year: data.year ?? null,
    lyrics: data.lyrics || [],
    lyrics_source: data.lyricsSource ?? null,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await db.from("tracks").insert(row).select().single();
  if (error) throw new Error(`Track creation failed: ${error.message}`);

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "track.create",
      resource_type: "track",
      resource_id: id,
      metadata: { title: row.title, artist: row.artist, storage_key: cleanSrc },
    });
  } catch {
    // Ignore audit log failure
  }

  return inserted;
}

export async function updateTrackDomainInternal(data: UpdateTrackInput, actorUserId?: string) {
  if (typeof data.expectedVersion !== "number" || !Number.isInteger(data.expectedVersion) || data.expectedVersion < 1) {
    throw new DomainValidationError("expectedVersion is mandatory for updateTrack and must be an integer >= 1.");
  }

  const db = getSupabaseAdmin();

  const updates: Record<string, any> = {
    version: data.expectedVersion + 1,
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updates["title"] = data.title.trim();
  if (data.artist !== undefined) updates["artist"] = data.artist.trim();
  if (data.albumId !== undefined)
    updates["album_id"] = data.albumId && data.albumId !== "singles" ? data.albumId : null;
  if (data.trackNo !== undefined) updates["track_no"] = data.trackNo;
  if (data.duration !== undefined) updates["duration_seconds"] = Math.round(data.duration);
  if (data.format !== undefined) updates["format"] = data.format;
  if (data.bitDepth !== undefined) updates["bit_depth"] = Math.round(data.bitDepth);
  if (data.sampleRate !== undefined) updates["sample_rate"] = data.sampleRate;
  if (data.sizeMB !== undefined) updates["size_mb"] = data.sizeMB;
  if (data.src !== undefined) updates["storage_key"] = keyFromValue(data.src) ?? data.src;
  if (data.cover !== undefined) updates["cover_storage_key"] = keyFromValue(data.cover) ?? data.cover;
  if (data.year !== undefined) updates["year"] = data.year;
  if (data.lyrics !== undefined) updates["lyrics"] = data.lyrics;
  if (data.lyricsSource !== undefined) updates["lyrics_source"] = data.lyricsSource;

  const { data: updated, error } = await db
    .from("tracks")
    .update(updates)
    .eq("id", data.id)
    .eq("version", data.expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Track update failed: ${error.message}`);

  if (!updated) {
    const { data: existing } = await db.from("tracks").select("id, version").eq("id", data.id).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${data.id} is at version ${existingVersion}, expected ${data.expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${data.id} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "track.update",
      resource_type: "track",
      resource_id: data.id,
      metadata: { updates, newVersion: (updated as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return updated;
}

export async function trashTrackDomainInternal(trackId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "trash",
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("tracks").update(updates).eq("id", trackId).eq("version", expectedVersion);

  const { data: trashed, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Track trash failed: ${error.message}`);
  if (!trashed) {
    const { data: existing } = await db.from("tracks").select("id, version").eq("id", trackId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${trackId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${trackId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "track.trash",
      resource_type: "track",
      resource_id: trackId,
      metadata: { status: "trash", version: (trashed as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return trashed;
}

export async function restoreTrackDomainInternal(trackId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "active",
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("tracks").update(updates).eq("id", trackId).eq("version", expectedVersion);

  const { data: restored, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Track restore failed: ${error.message}`);
  if (!restored) {
    const { data: existing } = await db.from("tracks").select("id, version").eq("id", trackId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${trackId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${trackId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "track.restore",
      resource_type: "track",
      resource_id: trackId,
      metadata: { status: "active", version: (restored as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return restored;
}

// ==========================================
// VIDEO DOMAIN MUTATIONS
// ==========================================

export interface CreateVideoInput {
  id?: string | undefined;
  title: string;
  artist: string;
  year?: number | undefined;
  thumb?: string | undefined;
  duration?: number | undefined;
  resolution?: string | undefined;
  codec?: string | undefined;
  bitrate?: string | undefined;
  sizeMB?: number | undefined;
  src?: string | undefined;
}

export interface UpdateVideoInput {
  id: string;
  expectedVersion: number;
  title?: string | undefined;
  artist?: string | undefined;
  year?: number | undefined;
  thumb?: string | undefined;
  duration?: number | undefined;
  resolution?: string | undefined;
  codec?: string | undefined;
  bitrate?: string | undefined;
  sizeMB?: number | undefined;
  src?: string | undefined;
}

export async function createVideoDomainInternal(data: CreateVideoInput, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const id = data.id || `video-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanSrc = keyFromValue(data.src) ?? data.src ?? "";
  const cleanThumb = keyFromValue(data.thumb) ?? data.thumb ?? "";

  const row = {
    id,
    title: data.title.trim(),
    artist: data.artist.trim() || "Nghệ sĩ",
    year: data.year || new Date().getFullYear(),
    thumb_storage_key: cleanThumb,
    storage_key: cleanSrc,
    duration_seconds: Math.round(data.duration || 0),
    resolution: data.resolution || "UNKNOWN",
    codec: data.codec || "UNKNOWN",
    bitrate: data.bitrate || "UNKNOWN",
    size_mb: data.sizeMB || 0,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await db.from("videos").insert(row).select().single();
  if (error) throw new Error(`Video creation failed: ${error.message}`);

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "video.create",
      resource_type: "video",
      resource_id: id,
      metadata: { title: row.title, artist: row.artist },
    });
  } catch {
    // Ignore audit log failure
  }

  return inserted;
}

export async function updateVideoDomainInternal(data: UpdateVideoInput, actorUserId?: string) {
  if (typeof data.expectedVersion !== "number" || !Number.isInteger(data.expectedVersion) || data.expectedVersion < 1) {
    throw new DomainValidationError("expectedVersion is mandatory for updateVideo and must be an integer >= 1.");
  }

  const db = getSupabaseAdmin();

  const updates: Record<string, any> = {
    version: data.expectedVersion + 1,
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updates["title"] = data.title.trim();
  if (data.artist !== undefined) updates["artist"] = data.artist.trim();
  if (data.year !== undefined) updates["year"] = data.year;
  if (data.thumb !== undefined) updates["thumb_storage_key"] = keyFromValue(data.thumb) ?? data.thumb;
  if (data.duration !== undefined) updates["duration_seconds"] = Math.round(data.duration);
  if (data.resolution !== undefined) updates["resolution"] = data.resolution;
  if (data.codec !== undefined) updates["codec"] = data.codec;
  if (data.bitrate !== undefined) updates["bitrate"] = data.bitrate;
  if (data.sizeMB !== undefined) updates["size_mb"] = data.sizeMB;
  if (data.src !== undefined) updates["storage_key"] = keyFromValue(data.src) ?? data.src;

  const { data: updated, error } = await db
    .from("videos")
    .update(updates)
    .eq("id", data.id)
    .eq("version", data.expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Video update failed: ${error.message}`);

  if (!updated) {
    const { data: existing } = await db.from("videos").select("id, version").eq("id", data.id).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Video ${data.id} is at version ${existingVersion}, expected ${data.expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Video ${data.id} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "video.update",
      resource_type: "video",
      resource_id: data.id,
      metadata: { updates, newVersion: (updated as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return updated;
}

export async function trashVideoDomainInternal(videoId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "trash",
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("videos").update(updates).eq("id", videoId).eq("version", expectedVersion);

  const { data: trashed, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Video trash failed: ${error.message}`);
  if (!trashed) {
    const { data: existing } = await db.from("videos").select("id, version").eq("id", videoId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Video ${videoId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Video ${videoId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "video.trash",
      resource_type: "video",
      resource_id: videoId,
      metadata: { status: "trash", version: (trashed as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return trashed;
}

export async function restoreVideoDomainInternal(videoId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Record<string, any> = {
    status: "active",
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };

  updates["version"] = expectedVersion + 1;
  const query = db.from("videos").update(updates).eq("id", videoId).eq("version", expectedVersion);

  const { data: restored, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Video restore failed: ${error.message}`);
  if (!restored) {
    const { data: existing } = await db.from("videos").select("id, version").eq("id", videoId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Record<string, any>)["version"];
      throw new ConcurrencyConflictError(
        `Stale revision: Video ${videoId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Video ${videoId} not found.`);
  }

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actor ?? null,
      action: "video.restore",
      resource_type: "video",
      resource_id: videoId,
      metadata: { status: "active", version: (restored as Record<string, any>)["version"] },
    });
  } catch {
    // Ignore audit log failure
  }

  return restored;
}

// ==========================================
// SERVER RPC WRAPPERS (OWNER-ONLY)
// ==========================================

export const createAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      artist: z.string(),
      year: z.number().int().optional(),
      cover: z.string().optional(),
      accent: z.string().optional(),
      note: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await createAlbumDomainInternal(data, actorUserId);
  });

export const updateAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      expectedVersion: z.number().int().min(1),
      title: z.string().optional(),
      artist: z.string().optional(),
      year: z.number().int().optional(),
      cover: z.string().optional(),
      accent: z.string().optional(),
      note: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await updateAlbumDomainInternal(data, actorUserId);
  });

export const trashAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      albumId: z.string().min(1),
      expectedVersion: z.number().int().min(1),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await trashAlbumDomainInternal(data.albumId, data.expectedVersion, actorUserId);
  });

export const createTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      artist: z.string(),
      albumId: z.string().nullable().optional(),
      duration: z.number().finite().min(0),
      trackNo: z.number().int().min(0),
      format: z.string().optional(),
      bitDepth: z.number().finite().optional(),
      sampleRate: z.number().finite().optional(),
      sizeMB: z.number().finite().optional(),
      src: z.string().optional(),
      cover: z.string().optional(),
      year: z.number().int().nullable().optional(),
      lyrics: z.array(lyricLineSchema).optional(),
      lyricsSource: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await createTrackDomainInternal(data, actorUserId);
  });

export const updateTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      expectedVersion: z.number().int().min(1),
      title: z.string().optional(),
      artist: z.string().optional(),
      albumId: z.string().nullable().optional(),
      trackNo: z.number().int().optional(),
      duration: z.number().finite().optional(),
      format: z.string().optional(),
      bitDepth: z.number().finite().optional(),
      sampleRate: z.number().finite().optional(),
      sizeMB: z.number().finite().optional(),
      src: z.string().optional(),
      cover: z.string().optional(),
      year: z.number().int().nullable().optional(),
      lyrics: z.array(lyricLineSchema).optional(),
      lyricsSource: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await updateTrackDomainInternal(data, actorUserId);
  });

export const trashTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      trackId: z.string().min(1),
      expectedVersion: z.number().int().min(1),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await trashTrackDomainInternal(data.trackId, data.expectedVersion, actorUserId);
  });

export const createVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      artist: z.string(),
      year: z.number().int().optional(),
      thumb: z.string().optional(),
      duration: z.number().finite().optional(),
      resolution: z.string().optional(),
      codec: z.string().optional(),
      bitrate: z.string().optional(),
      sizeMB: z.number().finite().optional(),
      src: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await createVideoDomainInternal(data, actorUserId);
  });

export const updateVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      expectedVersion: z.number().int().min(1),
      title: z.string().optional(),
      artist: z.string().optional(),
      year: z.number().int().optional(),
      thumb: z.string().optional(),
      duration: z.number().finite().optional(),
      resolution: z.string().optional(),
      codec: z.string().optional(),
      bitrate: z.string().optional(),
      sizeMB: z.number().finite().optional(),
      src: z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await updateVideoDomainInternal(data, actorUserId);
  });

export const trashVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      videoId: z.string().min(1),
      expectedVersion: z.number().int().min(1),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await trashVideoDomainInternal(data.videoId, data.expectedVersion, actorUserId);
  });
