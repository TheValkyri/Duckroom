import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { requireMemberMiddleware, serverSecurityMiddleware } from "./auth-guard";

const memberMiddleware = [serverSecurityMiddleware, requireMemberMiddleware] as const;

type MemberContext = { auth?: { userId?: string | null } | null };

function requireUserId(context: unknown): string {
  const userId = (context as MemberContext)?.auth?.userId;
  if (!userId) throw new Response("Member session is required", { status: 401 });
  return userId;
}

// ==========================================
// INTERNAL LOGIC (unit-testable)
// ==========================================

export async function listUserLibraryInternal(userId: string) {
  const db = getSupabaseAdmin();
  const [favorites, playlists, history, state] = await Promise.all([
    db
      .from("user_favorites")
      .select("track_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    db
      .from("playlists")
      .select(
        "id, name, description, cover_storage_key, is_public, created_at, updated_at, playlist_tracks(track_id, position, added_at)",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    db
      .from("playback_history")
      .select("id, track_id, started_at, ended_at, seconds_played, completed")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(50),
    db.from("playback_state").select("track_id, position_seconds, updated_at").eq("user_id", userId).maybeSingle(),
  ]);
  for (const result of [favorites, playlists, history, state]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    favorites: favorites.data ?? [],
    playlists: (playlists.data ?? []).map((playlist: any) => ({
      ...playlist,
      tracks: [...(playlist.playlist_tracks ?? [])].sort((a: any, b: any) => a.position - b.position),
      playlist_tracks: undefined,
    })),
    history: history.data ?? [],
    playbackState: state.data ?? null,
  };
}

export async function toggleFavoriteInternal(
  data: { trackId: string; favorite: boolean },
  userId: string,
): Promise<{ favorite: boolean }> {
  const db = getSupabaseAdmin();
  if (data.favorite) {
    const { error } = await db
      .from("user_favorites")
      .upsert({ user_id: userId, track_id: data.trackId }, { onConflict: "user_id,track_id" });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("user_favorites").delete().eq("user_id", userId).eq("track_id", data.trackId);
    if (error) throw new Error(error.message);
  }
  return { favorite: data.favorite };
}

export async function createPlaylistInternal(
  data: { name: string; description?: string | null | undefined },
  userId: string,
) {
  const db = getSupabaseAdmin();
  const { data: playlist, error } = await db
    .from("playlists")
    .insert({ user_id: userId, name: data.name, description: data.description ?? null })
    .select("id, name, description, is_public, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return playlist;
}

export async function deletePlaylistInternal(
  data: { playlistId: string },
  userId: string,
): Promise<{ success: boolean }> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("playlists").delete().eq("id", data.playlistId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { success: true };
}

/** §12.2 Rename — ownership enforced by the .eq("user_id") guard. */
export async function renamePlaylistInternal(
  data: { playlistId: string; name: string },
  userId: string,
): Promise<{ id: string; name: string }> {
  const db = getSupabaseAdmin();
  const { data: playlist, error } = await db
    .from("playlists")
    .update({ name: data.name.trim(), updated_at: new Date().toISOString() })
    .eq("id", data.playlistId)
    .eq("user_id", userId)
    .select("id, name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!playlist) throw new Error("Playlist không tồn tại hoặc bạn không có quyền.");
  return playlist;
}

export async function addTrackToPlaylistInternal(
  data: { playlistId: string; trackId: string },
  userId: string,
): Promise<{ success: boolean; position: number }> {
  const db = getSupabaseAdmin();
  const { data: playlist, error: playlistError } = await db
    .from("playlists")
    .select("id")
    .eq("id", data.playlistId)
    .eq("user_id", userId)
    .single();
  if (playlistError || !playlist) throw new Error("Playlist không tồn tại hoặc bạn không có quyền.");
  const { data: last } = await db
    .from("playlist_tracks")
    .select("position")
    .eq("playlist_id", data.playlistId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number | undefined) ?? -1) + 1;
  const { error } = await db
    .from("playlist_tracks")
    .upsert({ playlist_id: data.playlistId, track_id: data.trackId, position }, { onConflict: "playlist_id,track_id" });
  if (error) throw new Error(error.message);
  return { success: true, position };
}

export async function removeTrackFromPlaylistInternal(
  data: { playlistId: string; trackId: string },
  userId: string,
): Promise<{ success: boolean }> {
  const db = getSupabaseAdmin();
  const { data: playlist } = await db
    .from("playlists")
    .select("id")
    .eq("id", data.playlistId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!playlist) throw new Error("Playlist không tồn tại hoặc bạn không có quyền.");
  const { error } = await db
    .from("playlist_tracks")
    .delete()
    .eq("playlist_id", data.playlistId)
    .eq("track_id", data.trackId);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function savePlaybackStateInternal(
  data: { trackId: string | null; positionSeconds: number },
  userId: string,
): Promise<{ success: boolean }> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("playback_state").upsert(
    {
      user_id: userId,
      track_id: data.trackId,
      position_seconds: data.positionSeconds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * §12.3 History append — idempotent via client_event_id (audit fix #7).
 * Retries/duplicates of the same play event collapse to one row
 * (ON CONFLICT DO NOTHING). A missing eventId gets a server-generated one.
 */
export async function appendPlaybackHistoryInternal(
  data: {
    trackId: string;
    startedAt: string;
    endedAt?: string | null | undefined;
    secondsPlayed: number;
    completed: boolean;
    clientEventId?: string | null | undefined;
  },
  userId: string,
): Promise<{ success: boolean; duplicate: boolean }> {
  const db = getSupabaseAdmin();
  const clientEventId = data.clientEventId?.trim() || crypto.randomUUID();
  const { data: row, error } = await db
    .from("playback_history")
    .upsert(
      {
        user_id: userId,
        track_id: data.trackId,
        started_at: data.startedAt,
        ended_at: data.endedAt ?? null,
        seconds_played: data.secondsPlayed,
        completed: data.completed,
        client_event_id: clientEventId,
      },
      { onConflict: "client_event_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  return { success: true, duplicate: !row || row.length === 0 };
}

/**
 * §12.2 Reorder — atomic server-side rewrite via RPC (audit fix #6).
 * The SQL function validates ownership + exact membership and rewrites ALL
 * positions in ONE statement; a failure leaves the old ordering untouched.
 * Client-side guards below just fail fast with friendly messages.
 */
export async function reorderPlaylistInternal(
  data: { playlistId: string; orderedTrackIds: string[] },
  userId: string,
): Promise<{ success: true; count: number }> {
  const db = getSupabaseAdmin();

  if (data.orderedTrackIds.length === 0) {
    throw new Error("Danh sách thứ tự rỗng — không có gì để sắp xếp.");
  }
  const seen = new Set<string>();
  for (const id of data.orderedTrackIds) {
    if (!seen.has(id)) seen.add(id);
    else throw new Error("Danh sách thứ tự chứa bài hát bị lặp.");
  }

  const { data: count, error } = await db.rpc("reorder_playlist_tracks", {
    p_playlist_id: data.playlistId,
    p_ordered_track_ids: data.orderedTrackIds,
    p_actor: userId,
  });
  if (error) {
    const raw = typeof error.message === "string" ? error.message : "";
    if (raw.includes("PLAYLIST_NOT_FOUND")) throw new Error("Playlist không tồn tại hoặc bạn không có quyền.");
    if (raw.includes("FORBIDDEN")) throw new Error("Playlist không tồn tại hoặc bạn không có quyền.");
    if (raw.includes("MEMBERSHIP_MISMATCH"))
      throw new Error("Thứ tự gửi lên không khớp với nội dung hiện tại của playlist. Hãy tải lại trang.");
    throw new Error(raw || "Không sắp xếp được playlist.");
  }
  return { success: true, count: Number(count ?? 0) };
}

// ==========================================
// USER PREFERENCES (§5.2 / §12)
// ==========================================

export interface UserPreferences {
  theme: "dark" | "light";
  volume: number;
  crossfadeSeconds: number;
  replaygainMode: "off" | "track" | "album";
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "dark",
  volume: 1,
  crossfadeSeconds: 0,
  replaygainMode: "off",
};

export async function getUserPreferencesInternal(userId: string): Promise<UserPreferences> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("user_preferences")
    .select("theme,volume,crossfade_seconds,replaygain_mode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ...DEFAULT_USER_PREFERENCES };
  return {
    theme: data.theme === "light" ? "light" : "dark",
    volume: typeof data.volume === "number" && Number.isFinite(data.volume) ? Math.min(1, Math.max(0, data.volume)) : 1,
    crossfadeSeconds:
      typeof data.crossfade_seconds === "number" && Number.isFinite(data.crossfade_seconds)
        ? Math.min(10, Math.max(0, Math.round(data.crossfade_seconds)))
        : 0,
    replaygainMode: data.replaygain_mode === "track" || data.replaygain_mode === "album" ? data.replaygain_mode : "off",
  };
}

export async function saveUserPreferencesInternal(
  data: {
    theme?: "dark" | "light" | undefined;
    volume?: number | undefined;
    crossfadeSeconds?: number | undefined;
    replaygainMode?: "off" | "track" | "album" | undefined;
  },
  userId: string,
): Promise<{ success: boolean }> {
  const db = getSupabaseAdmin();
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (data.theme !== undefined) row["theme"] = data.theme;
  if (data.volume !== undefined) row["volume"] = Math.min(1, Math.max(0, data.volume));
  if (data.crossfadeSeconds !== undefined) row["crossfade_seconds"] = Math.round(data.crossfadeSeconds);
  if (data.replaygainMode !== undefined) row["replaygain_mode"] = data.replaygainMode;

  const { error } = await db.from("user_preferences").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { success: true };
}

// ==========================================
// SERVER FUNCTION WRAPPERS (member-scoped)
// ==========================================

export const listUserLibraryServer = createServerFn({ method: "GET" })
  .middleware(memberMiddleware)
  .handler(async ({ context }) => listUserLibraryInternal(requireUserId(context)));

export const toggleFavoriteServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ trackId: z.string().min(1), favorite: z.boolean() }))
  .handler(async ({ context, data }) => toggleFavoriteInternal(data, requireUserId(context)));

export const createPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => createPlaylistInternal(data, requireUserId(context)));

export const deletePlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid() }))
  .handler(async ({ context, data }) => deletePlaylistInternal(data, requireUserId(context)));

export const renamePlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      playlistId: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
    }),
  )
  .handler(async ({ context, data }) => renamePlaylistInternal(data, requireUserId(context)));

export const addTrackToPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid(), trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => addTrackToPlaylistInternal(data, requireUserId(context)));

export const removeTrackFromPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid(), trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => removeTrackFromPlaylistInternal(data, requireUserId(context)));

export const savePlaybackStateServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      trackId: z.string().nullable(),
      positionSeconds: z.number().finite().min(0),
    }),
  )
  .handler(async ({ context, data }) => savePlaybackStateInternal(data, requireUserId(context)));

/**
 * Lightweight reader for Continue-Listening restore (Phase 5.2).
 * Deliberately separate from listUserLibraryServer so the player can restore
 * state without paying for favorites/playlists/history.
 */
export const getPlaybackStateServer = createServerFn({ method: "GET" })
  .middleware(memberMiddleware)
  .handler(async ({ context }) => {
    const userId = requireUserId(context);
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("playback_state")
      .select("track_id, position_seconds, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      trackId: (data.track_id as string | null) ?? null,
      positionSeconds:
        typeof data.position_seconds === "number" && Number.isFinite(data.position_seconds) ? data.position_seconds : 0,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
    };
  });

export const appendPlaybackHistoryServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      trackId: z.string().min(1),
      startedAt: z.string().datetime(),
      endedAt: z.string().datetime().nullable().optional(),
      secondsPlayed: z.number().finite().min(0),
      completed: z.boolean(),
      clientEventId: z.string().min(8).max(128).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => appendPlaybackHistoryInternal(data, requireUserId(context)));

export const reorderPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      playlistId: z.string().uuid(),
      orderedTrackIds: z.array(z.string().min(1)).min(1).max(1000),
    }),
  )
  .handler(async ({ context, data }) => reorderPlaylistInternal(data, requireUserId(context)));

export const getUserPreferencesServer = createServerFn({ method: "GET" })
  .middleware(memberMiddleware)
  .handler(async ({ context }) => getUserPreferencesInternal(requireUserId(context)));

export const saveUserPreferencesServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      theme: z.enum(["dark", "light"]).optional(),
      volume: z.number().finite().min(0).max(1).optional(),
      crossfadeSeconds: z.number().int().min(0).max(10).optional(),
      replaygainMode: z.enum(["off", "track", "album"]).optional(),
    }),
  )
  .handler(async ({ context, data }) => saveUserPreferencesInternal(data, requireUserId(context)));
