import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "../supabase";
import { requireFreshOwnerMiddleware, serverSecurityMiddleware } from "../auth-guard";
import {
  ConcurrencyConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  keyFromValue,
  lyricLineSchema,
  safeAuditLog,
} from "./common";
import type { TrackRow } from "../db-types";

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

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "track.create",
    resource_type: "track",
    resource_id: id,
    metadata: { title: row.title, artist: row.artist, storage_key: cleanSrc },
  });

  return inserted;
}

export async function updateTrackDomainInternal(data: UpdateTrackInput, actorUserId?: string) {
  if (typeof data.expectedVersion !== "number" || !Number.isInteger(data.expectedVersion) || data.expectedVersion < 1) {
    throw new DomainValidationError("expectedVersion is mandatory for updateTrack and must be an integer >= 1.");
  }

  const db = getSupabaseAdmin();

  const updates: Partial<TrackRow> = {
    version: data.expectedVersion + 1,
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updates.title = data.title.trim();
  if (data.artist !== undefined) updates.artist = data.artist.trim();
  if (data.albumId !== undefined) updates.album_id = data.albumId && data.albumId !== "singles" ? data.albumId : null;
  if (data.trackNo !== undefined) updates.track_no = data.trackNo;
  if (data.duration !== undefined) updates.duration_seconds = Math.round(data.duration);
  if (data.format !== undefined) updates.format = data.format;
  if (data.bitDepth !== undefined) updates.bit_depth = Math.round(data.bitDepth);
  if (data.sampleRate !== undefined) updates.sample_rate = data.sampleRate;
  if (data.sizeMB !== undefined) updates.size_mb = data.sizeMB;
  if (data.src !== undefined) updates.storage_key = keyFromValue(data.src) ?? data.src;
  if (data.cover !== undefined) updates.cover_storage_key = keyFromValue(data.cover) ?? data.cover;
  if (data.year !== undefined) updates.year = data.year;
  if (data.lyrics !== undefined) updates.lyrics = data.lyrics;
  if (data.lyricsSource !== undefined) updates.lyrics_source = data.lyricsSource;

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
      const existingVersion = (existing as Pick<TrackRow, "id" | "version">).version;
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${data.id} is at version ${existingVersion}, expected ${data.expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${data.id} not found.`);
  }

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "track.update",
    resource_type: "track",
    resource_id: data.id,
    metadata: { updates: updates as Record<string, unknown>, newVersion: (updated as TrackRow).version },
  });

  return updated;
}

export async function trashTrackDomainInternal(trackId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Partial<TrackRow> = {
    status: "trash",
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: expectedVersion + 1,
  };

  const query = db.from("tracks").update(updates).eq("id", trackId).eq("version", expectedVersion);

  const { data: trashed, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Track trash failed: ${error.message}`);
  if (!trashed) {
    const { data: existing } = await db.from("tracks").select("id, version").eq("id", trackId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Pick<TrackRow, "id" | "version">).version;
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${trackId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${trackId} not found.`);
  }

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "track.trash",
    resource_type: "track",
    resource_id: trackId,
    metadata: { status: "trash", version: (trashed as TrackRow).version },
  });

  return trashed;
}

export async function restoreTrackDomainInternal(trackId: string, expectedVersion: number, actorUserId?: string) {
  const actor = actorUserId;

  const db = getSupabaseAdmin();
  const updates: Partial<TrackRow> = {
    status: "active",
    deleted_at: null,
    updated_at: new Date().toISOString(),
    version: expectedVersion + 1,
  };

  const query = db.from("tracks").update(updates).eq("id", trackId).eq("version", expectedVersion);

  const { data: restored, error } = await query.select().maybeSingle();

  if (error) throw new Error(`Track restore failed: ${error.message}`);
  if (!restored) {
    const { data: existing } = await db.from("tracks").select("id, version").eq("id", trackId).maybeSingle();
    if (existing) {
      const existingVersion = (existing as Pick<TrackRow, "id" | "version">).version;
      throw new ConcurrencyConflictError(
        `Stale revision: Track ${trackId} is at version ${existingVersion}, expected ${expectedVersion}.`,
      );
    }
    throw new ResourceNotFoundError(`Track ${trackId} not found.`);
  }

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "track.restore",
    resource_type: "track",
    resource_id: trackId,
    metadata: { status: "active", version: (restored as TrackRow).version },
  });

  return restored;
}

// ==========================================
// SERVER RPC WRAPPERS (OWNER-ONLY)
// ==========================================

export const createTrackDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
