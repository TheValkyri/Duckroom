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

export interface CreateAlbumInput {
  id?: string | undefined;
  title: string;
  artist: string;
  year?: number | undefined;
  cover?: string | undefined;
  accent?: string | undefined;
  note?: string | undefined;
  displayPriority?: number | undefined;
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
  displayPriority?: number | undefined;
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
    display_priority: data.displayPriority ?? 999,
    version: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await db.from("albums").insert(row).select().single();
  if (error) throw new Error(`Album creation failed: ${error.message}`);

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "album.create",
    resource_type: "album",
    resource_id: id,
    metadata: { title: row.title, artist: row.artist },
  });

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
  if (data.displayPriority !== undefined) updates["display_priority"] = data.displayPriority;

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

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "album.update",
    resource_type: "album",
    resource_id: data.id,
    metadata: { updates, newVersion: (updated as Record<string, any>)["version"] },
  });

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

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "album.trash",
    resource_type: "album",
    resource_id: albumId,
    metadata: { status: "trash", version: (trashed as Record<string, any>)["version"] },
  });

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

  await safeAuditLog(db, {
    actor_user_id: actor ?? null,
    action: "album.restore",
    resource_type: "album",
    resource_id: albumId,
    metadata: { status: "active", version: (restored as Record<string, any>)["version"] },
  });

  return restored;
}

// ==========================================
// SERVER RPC WRAPPERS (OWNER-ONLY)
// ==========================================

export const createAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      artist: z.string(),
      year: z.number().int().optional(),
      cover: z.string().optional(),
      accent: z.string().optional(),
      note: z.string().optional(),
      displayPriority: z.number().int().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await createAlbumDomainInternal(data, actorUserId);
  });

export const updateAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
      displayPriority: z.number().int().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await updateAlbumDomainInternal(data, actorUserId);
  });

export const trashAlbumDomainServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
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
