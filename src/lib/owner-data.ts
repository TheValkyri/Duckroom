import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./supabase";
import { listS3ObjectsServer } from "./s3-functions";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";

export const getOwnerHealthServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const db = getSupabaseAdmin();
    const [tracks, albums, videos, profiles, playlists, favorites, history, orphanStorage] = await Promise.all([
      db.from("tracks").select("id", { count: "exact", head: true }),
      db.from("albums").select("id", { count: "exact", head: true }),
      db.from("videos").select("id", { count: "exact", head: true }),
      db.from("profiles").select("user_id", { count: "exact", head: true }),
      db.from("playlists").select("id", { count: "exact", head: true }),
      db.from("user_favorites").select("track_id", { count: "exact", head: true }),
      db.from("playback_history").select("id", { count: "exact", head: true }),
      listS3ObjectsServer(),
    ]);
    const errors = [tracks, albums, videos, profiles, playlists, favorites, history].filter((result) => result.error);
    if (errors.length) throw new Error(errors[0]?.error?.message || "Không thể đọc trạng thái Owner.");
    const keys = orphanStorage.keys;
    return {
      counts: {
        tracks: tracks.count ?? 0,
        albums: albums.count ?? 0,
        videos: videos.count ?? 0,
        users: profiles.count ?? 0,
        playlists: playlists.count ?? 0,
        favorites: favorites.count ?? 0,
        history: history.count ?? 0,
        objects: keys.length,
      },
      storage: {
        audioObjects: keys.filter((key) => /\.(flac|wav|alac|mp3|m4a)$/i.test(key)).length,
        videoObjects: keys.filter((key) => /\.(mp4|mkv|webm|mov)$/i.test(key)).length,
        artworkObjects: keys.filter((key) => key.startsWith("artworks/")).length,
        manifestPresent: keys.includes("library_manifest.json"),
      },
      generatedAt: new Date().toISOString(),
    };
  });

export const getOwnerAuditLogServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("audit_logs")
      .select("id,actor_user_id,action,resource_type,resource_id,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
