import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "../supabase";
import { requireFreshOwnerMiddleware, serverSecurityMiddleware } from "../auth-guard";
import {
  ConcurrencyConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  keyFromValue,
  safeAuditLog,
} from "./common";

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

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "video.create",
    resource_type: "video",
    resource_id: id,
    metadata: { title: row.title, artist: row.artist },
  });

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

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "video.update",
    resource_type: "video",
    resource_id: data.id,
    metadata: { updates, newVersion: (updated as Record<string, any>)["version"] },
  });

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

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "video.trash",
    resource_type: "video",
    resource_id: videoId,
    metadata: { status: "trash", version: (trashed as Record<string, any>)["version"] },
  });

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

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "video.restore",
    resource_type: "video",
    resource_id: videoId,
    metadata: { status: "active", version: (restored as Record<string, any>)["version"] },
  });

  return restored;
}

// ==========================================
// SERVER RPC WRAPPERS (OWNER-ONLY)
// ==========================================

export const createVideoDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
