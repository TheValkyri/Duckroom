import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "./supabase";
import { deleteS3ObjectServer, listS3ObjectsServer, saveLibraryManifestServer } from "./s3-functions";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { extractS3KeyFromUrl } from "./s3-key";

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

export const scanOrphanS3ObjectsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const db = getSupabaseAdmin();
    const [allS3, tracks, albums, videos] = await Promise.all([
      listS3ObjectsServer(),
      db.from("tracks").select("storage_key,cover_storage_key"),
      db.from("albums").select("cover_storage_key"),
      db.from("videos").select("storage_key,thumb_storage_key"),
    ]);

    const activeKeys = new Set<string>();
    activeKeys.add("library_manifest.json");

    (tracks.data || []).forEach((t) => {
      if (t.storage_key) activeKeys.add(extractS3KeyFromUrl(t.storage_key) || t.storage_key);
      if (t.cover_storage_key) activeKeys.add(extractS3KeyFromUrl(t.cover_storage_key) || t.cover_storage_key);
    });

    (albums.data || []).forEach((a) => {
      if (a.cover_storage_key) activeKeys.add(extractS3KeyFromUrl(a.cover_storage_key) || a.cover_storage_key);
    });

    (videos.data || []).forEach((v) => {
      if (v.storage_key) activeKeys.add(extractS3KeyFromUrl(v.storage_key) || v.storage_key);
      if (v.thumb_storage_key) activeKeys.add(extractS3KeyFromUrl(v.thumb_storage_key) || v.thumb_storage_key);
    });

    const orphanKeys = allS3.keys.filter((key) => !activeKeys.has(key));
    return {
      totalS3Objects: allS3.keys.length,
      activeReferencedObjects: activeKeys.size,
      orphanKeys,
    };
  });

export const cleanupOrphanS3ObjectsServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ keys: z.array(z.string().min(1)) }))
  .handler(async ({ data }) => {
    const deleted: string[] = [];
    for (const key of data.keys) {
      if (key !== "library_manifest.json") {
        try {
          await deleteS3ObjectServer({ data: { key } });
          deleted.push(key);
        } catch (err) {
          console.warn(`Failed to delete orphan key: ${key}`, err);
        }
      }
    }
    return { success: true, deletedCount: deleted.length };
  });

export const createBackupSnapshotServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const db = getSupabaseAdmin();
    const [albums, tracks, videos] = await Promise.all([
      db.from("albums").select("*").order("year", { ascending: false }),
      db.from("tracks").select("*").order("created_at", { ascending: true }),
      db.from("videos").select("*").order("year", { ascending: false }),
    ]);

    const snapshot = {
      version: 2,
      createdAt: new Date().toISOString(),
      albums: albums.data || [],
      tracks: tracks.data || [],
      videos: videos.data || [],
    };

    await saveLibraryManifestServer({
      data: {
        jsonString: JSON.stringify(snapshot, null, 2),
      },
    });

    return {
      success: true,
      createdAt: snapshot.createdAt,
      tracks: snapshot.tracks.length,
      albums: snapshot.albums.length,
      videos: snapshot.videos.length,
    };
  });
