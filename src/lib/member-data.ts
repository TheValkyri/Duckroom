import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { requireMemberMiddleware, serverSecurityMiddleware } from "./auth-guard";

const memberMiddleware = [serverSecurityMiddleware, requireMemberMiddleware] as const;

function requireUserId(context: unknown): string {
  const userId = (context as { auth?: { userId?: string | null } })?.auth?.userId;
  if (!userId) throw new Response("Member session is required", { status: 401 });
  return userId;
}

export const listUserLibraryServer = createServerFn({ method: "GET" })
  .middleware(memberMiddleware)
  .handler(async ({ context }) => {
    const userId = requireUserId(context);
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
  });

export const toggleFavoriteServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ trackId: z.string().min(1), favorite: z.boolean() }))
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
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
  });

export const createPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    const db = getSupabaseAdmin();
    const { data: playlist, error } = await db
      .from("playlists")
      .insert({ user_id: userId, name: data.name, description: data.description ?? null })
      .select("id, name, description, is_public, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return playlist;
  });

export const deletePlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    const db = getSupabaseAdmin();
    const { error } = await db.from("playlists").delete().eq("id", data.playlistId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const addTrackToPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid(), trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
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
    const position = (last?.position ?? -1) + 1;
    const { error } = await db
      .from("playlist_tracks")
      .upsert(
        { playlist_id: data.playlistId, track_id: data.trackId, position },
        { onConflict: "playlist_id,track_id" },
      );
    if (error) throw new Error(error.message);
    return { success: true, position };
  });

export const removeTrackFromPlaylistServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(z.object({ playlistId: z.string().uuid(), trackId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
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
  });

export const savePlaybackStateServer = createServerFn({ method: "POST" })
  .middleware(memberMiddleware)
  .validator(
    z.object({
      trackId: z.string().nullable(),
      positionSeconds: z.number().finite().min(0),
    }),
  )
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
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
    }),
  )
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("playback_history")
      .insert({ user_id: userId, ...data, ended_at: data.endedAt ?? null });
    if (error) throw new Error(error.message);
    return { success: true };
  });
