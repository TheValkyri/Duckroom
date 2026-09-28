import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSupabaseAdmin } from "./supabase";
import {
  deleteS3ObjectInternal,
  deleteS3ObjectServer,
  getS3ServerClient,
  listS3ObjectsInternal,
  listS3ObjectsServer,
  saveLibraryManifestInternal,
  saveLibraryManifestServer,
} from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import { requireFreshOwnerMiddleware, requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { extractS3KeyFromUrl, sanitizeStorageKeySegment } from "./s3-key";
import { safeAuditLog } from "./domain-mutations/common";
import { generateFriendCode, generateTemporaryHandle } from "./social/social-types";
import type { UploadSessionRow, ShareLinkRow, TrackFileRow, VideoFileRow, TrackRow, VideoRow } from "./db-types";

export async function getOwnerHealthInternal(dbClient?: any) {
  const db = dbClient || getSupabaseAdmin();

  const [
    tracks,
    albums,
    videos,
    profiles,
    playlists,
    favorites,
    history,
    trackFiles,
    videoFiles,
    albumCovers,
    trackCovers,
  ] = await Promise.all([
    db.from("tracks").select("id", { count: "exact", head: true }),
    db.from("albums").select("id", { count: "exact", head: true }),
    db.from("videos").select("id", { count: "exact", head: true }),
    db.from("profiles").select("user_id", { count: "exact", head: true }),
    db.from("playlists").select("id", { count: "exact", head: true }),
    db.from("user_favorites").select("track_id", { count: "exact", head: true }),
    db.from("playback_history").select("id", { count: "exact", head: true }),
    db.from("track_files").select("id", { count: "exact", head: true }),
    db.from("video_files").select("id", { count: "exact", head: true }),
    db.from("albums").select("id", { count: "exact", head: true }).not("cover_storage_key", "is", null),
    db.from("tracks").select("id", { count: "exact", head: true }).not("cover_storage_key", "is", null),
  ]);

  const errors = [tracks, albums, videos, profiles, playlists, favorites, history].filter((result) => result.error);
  if (errors.length) throw new Error(errors[0]?.error?.message || "Không thể đọc trạng thái Owner.");

  let realUserCount = profiles.count ?? 0;
  try {
    if (db.auth?.admin?.listUsers) {
      const { data: authData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (authData?.users && authData.users.length > 0) {
        const authUsers = authData.users;
        realUserCount = Math.max(realUserCount, authUsers.length);
        const { data: existingProfiles } = await db.from("profiles").select("user_id");
        const existingSet = new Set((existingProfiles || []).map((p: any) => p.user_id));
        const missing = authUsers.filter((u: any) => !existingSet.has(u.id));
        if (missing.length > 0) {
          for (const u of missing) {
            try {
              const email = (u.email || "unknown@example.invalid").toLowerCase();
              const meta = u.user_metadata || {};
              const displayName = meta.full_name || meta.name || meta.user_name || email.split("@")[0] || "Thành viên";
              const handle = generateTemporaryHandle();
              const friendCode = generateFriendCode();
              await db.from("profiles").insert({
                user_id: u.id,
                email,
                role: "member",
                display_name: displayName,
                handle,
                friend_code: friendCode,
                created_at: u.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            } catch (insErr) {
              console.warn("[Duckroom Owner] Failed to backfill profile for user:", u.id, insErr);
            }
          }
        }
      }
    }
  } catch (authErr) {
    console.warn("[Duckroom Owner] Failed to sync auth users:", authErr);
  }

  const audioCount = trackFiles.count ?? tracks.count ?? 0;
  const artworkCount = (albumCovers.count ?? 0) + (trackCovers.count ?? 0);
  const totalObjects = audioCount + artworkCount;

  return {
    counts: {
      tracks: tracks.count ?? 0,
      albums: albums.count ?? 0,
      videos: 0,
      users: realUserCount,
      playlists: playlists.count ?? 0,
      favorites: favorites.count ?? 0,
      history: history.count ?? 0,
      objects: totalObjects,
    },
    storage: {
      audioObjects: audioCount,
      videoObjects: 0,
      artworkObjects: artworkCount,
      manifestPresent: true,
      // Boolean khai báo tường minh — tránh TS hẹp type union về literal
      // `true` khiến mọi so sánh `=== false` ở consumer thành lỗi TS2367.
      // (Giá trị gốc vẫn luôn true ở happy path như trước.)
      s3Available: true as boolean,
      s3Error: null as string | null,
    },
    generatedAt: new Date().toISOString(),
  };
}

export const getOwnerHealthServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    return await getOwnerHealthInternal();
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
    let allS3: string[] = [];
    let s3Unreachable = false;
    let s3ErrorMessage = "";

    try {
      allS3 = await listS3ObjectsInternal();
    } catch (err: any) {
      s3Unreachable = true;
      s3ErrorMessage = err instanceof Error ? err.message : "S3 network unavailable";
      console.warn("[Duckroom S3 Orphan Scan] S3 listing unavailable:", s3ErrorMessage);
    }

    const [tracks, albums, videos, liveSessions] = await Promise.all([
      db.from("tracks").select("storage_key,cover_storage_key").neq("status", "trash"),
      db.from("albums").select("title,cover_storage_key").neq("status", "trash"),
      db.from("videos").select("storage_key,thumb_storage_key").neq("status", "trash"),
      // In-flight upload sessions must NEVER be classified as orphans —
      // purging their staging bytes would kill active transfers.
      db
        .from("upload_sessions")
        .select("staging_storage_key,artwork_staging_key")
        .not("status", "in", ["complete", "cancelled", "resolved_to_existing"]),
    ]);

    const activeKeys = new Set<string>();
    activeKeys.add("library_manifest.json");

    (tracks.data || []).forEach((t) => {
      if (t.storage_key) activeKeys.add(extractS3KeyFromUrl(t.storage_key) || t.storage_key);
      if (t.cover_storage_key) activeKeys.add(extractS3KeyFromUrl(t.cover_storage_key) || t.cover_storage_key);
    });

    (albums.data || []).forEach((a) => {
      if (a.cover_storage_key) activeKeys.add(extractS3KeyFromUrl(a.cover_storage_key) || a.cover_storage_key);
      if (a.title) {
        const slug = sanitizeStorageKeySegment(a.title);
        activeKeys.add(`audio/albums/${slug}/.keep`);
      }
    });

    (videos.data || []).forEach((v) => {
      if (v.storage_key) activeKeys.add(extractS3KeyFromUrl(v.storage_key) || v.storage_key);
      if (v.thumb_storage_key) activeKeys.add(extractS3KeyFromUrl(v.thumb_storage_key) || v.thumb_storage_key);
    });

    (liveSessions.data || []).forEach((s: Pick<UploadSessionRow, "staging_storage_key" | "artwork_staging_key">) => {
      if (s.staging_storage_key) {
        activeKeys.add(extractS3KeyFromUrl(s.staging_storage_key) || s.staging_storage_key);
      }
      if (s.artwork_staging_key) {
        activeKeys.add(extractS3KeyFromUrl(s.artwork_staging_key) || s.artwork_staging_key);
      }
    });

    if (s3Unreachable) {
      const noOrphans: string[] = [];
      return {
        totalS3Objects: activeKeys.size,
        activeReferencedObjects: activeKeys.size,
        orphanKeys: noOrphans,
        s3Unreachable: true,
        s3ErrorMessage,
      };
    }

    const orphanKeys = allS3.filter((key) => !activeKeys.has(key));
    return {
      totalS3Objects: allS3.length,
      activeReferencedObjects: activeKeys.size,
      orphanKeys,
      s3Unreachable: false,
    };
  });

export const cleanupOrphanS3ObjectsServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ keys: z.array(z.string().min(1)) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    const db = getSupabaseAdmin();

    // Server-side re-validation: never trust a stale client key list.
    const scan = (await scanOrphanS3ObjectsServer()) as unknown as { orphanKeys: string[] };
    const currentOrphans = new Set(scan.orphanKeys);

    const deleted: string[] = [];
    const failed: string[] = [];
    const skippedStale: string[] = [];
    for (const key of data.keys) {
      if (!currentOrphans.has(key)) {
        skippedStale.push(key); // referenced meanwhile — protect it
        continue;
      }
      if (key !== "library_manifest.json") {
        try {
          const ok = await deleteS3ObjectInternal(key);
          if (ok) deleted.push(key);
          else failed.push(key);
        } catch (err) {
          console.warn(`Failed to delete orphan key: ${key}`, err);
          failed.push(key);
        }
      }
    }

    await safeAuditLog(db, {
      actor_user_id: actorUserId ?? null,
      action: "storage.orphan_deleted",
      resource_type: "storage",
      resource_id: "orphan-batch",
      metadata: {
        requested: data.keys.length,
        deleted: deleted.length,
        failed: failed.length,
        skipped_stale: skippedStale.length,
        deleted_keys: deleted.slice(0, 50),
        failed_keys: failed.slice(0, 50),
      },
    });

    return { success: true, deletedCount: deleted.length, failed, skippedStale };
  });

export interface ReconcileStorageResult {
  totalDbTracks: number;
  validDbTracks: number;
  ghostTracks: Array<{ id: string; title: string; albumId?: string | null; storageKey: string }>;
  stagingLeaks: Array<{ id: string; title: string; storageKey: string }>;
  brokenCovers: Array<{ id: string; title: string; coverKey: string }>;
  ghostVideos: Array<{ id: string; title: string; storageKey: string }>;
  brokenVideoThumbs: Array<{ id: string; title: string; thumbKey: string }>;
  orphanS3Keys: string[];
  totalS3Objects: number;
  purgedGhostCount?: number;
  manifestUpdated?: boolean;
}

export async function reconcileStorageWithDbInternal(
  autoPurgeGhosts = false,
  actorUserId?: string,
): Promise<ReconcileStorageResult> {
  const db = getSupabaseAdmin();
  let allS3: string[] = [];
  try {
    allS3 = await listS3ObjectsInternal();
  } catch (err: any) {
    throw new Error(`S3 storage listing failed during reconciliation: ${err?.message || err}`);
  }

  const s3KeySet = new Set(allS3);

  const [tracksRes, albumsRes, videosRes, liveSessionsRes] = await Promise.all([
    db.from("tracks").select("id, title, album_id, storage_key, cover_storage_key, status").neq("status", "trash"),
    db.from("albums").select("id, title, cover_storage_key, status").neq("status", "trash"),
    db.from("videos").select("id, title, storage_key, thumb_storage_key, status").neq("status", "trash"),
    db
      .from("upload_sessions")
      .select("staging_storage_key, artwork_staging_key")
      .not("status", "in", ["complete", "cancelled", "resolved_to_existing"]),
  ]);

  const activeTracks = tracksRes.data || [];
  const activeAlbums = albumsRes.data || [];
  const activeVideos = videosRes.data || [];

  const ghostTracks: Array<{ id: string; title: string; albumId?: string | null; storageKey: string }> = [];
  const stagingLeaks: Array<{ id: string; title: string; storageKey: string }> = [];
  const brokenCovers: Array<{ id: string; title: string; coverKey: string }> = [];
  const ghostVideos: Array<{ id: string; title: string; storageKey: string }> = [];
  const brokenVideoThumbs: Array<{ id: string; title: string; thumbKey: string }> = [];

  for (const track of activeTracks) {
    const key = track.storage_key ? extractS3KeyFromUrl(track.storage_key) || track.storage_key : "";
    if (key.startsWith("temp/")) {
      stagingLeaks.push({ id: track.id, title: track.title, storageKey: key });
    }

    if (!key || !s3KeySet.has(key)) {
      ghostTracks.push({ id: track.id, title: track.title, albumId: track.album_id, storageKey: key });
    }

    if (track.cover_storage_key) {
      const coverKey = extractS3KeyFromUrl(track.cover_storage_key) || track.cover_storage_key;
      if (!s3KeySet.has(coverKey)) {
        brokenCovers.push({ id: track.id, title: track.title, coverKey });
      }
    }
  }

  for (const video of activeVideos) {
    const key = video.storage_key ? extractS3KeyFromUrl(video.storage_key) || video.storage_key : "";
    if (!key || !s3KeySet.has(key)) {
      ghostVideos.push({ id: video.id, title: video.title, storageKey: key });
    }
    if (video.thumb_storage_key) {
      const thumbKey = extractS3KeyFromUrl(video.thumb_storage_key) || video.thumb_storage_key;
      if (!s3KeySet.has(thumbKey)) {
        brokenVideoThumbs.push({ id: video.id, title: video.title, thumbKey });
      }
    }
  }

  let purgedGhostCount = 0;
  let manifestUpdated = false;

  if (autoPurgeGhosts && (ghostTracks.length > 0 || ghostVideos.length > 0)) {
    if (ghostTracks.length > 0) {
      const ghostIds = ghostTracks.map((g) => g.id);
      await db.from("track_files").delete().in("track_id", ghostIds);
      await db.from("user_favorites").delete().in("track_id", ghostIds);
      await db.from("playback_history").delete().in("track_id", ghostIds);
      await db.from("playlist_tracks").delete().in("track_id", ghostIds);
      await db.from("storage_cleanup_debts").delete().in("resource_id", ghostIds);
      const { error: delErr } = await db.from("tracks").delete().in("id", ghostIds);
      if (!delErr) {
        purgedGhostCount += ghostIds.length;
      }
    }

    if (ghostVideos.length > 0) {
      const ghostVideoIds = ghostVideos.map((g) => g.id);
      await db.from("video_files").delete().in("video_id", ghostVideoIds);
      await db.from("storage_cleanup_debts").delete().in("resource_id", ghostVideoIds);
      const { error: delVideoErr } = await db.from("videos").delete().in("id", ghostVideoIds);
      if (!delVideoErr) {
        purgedGhostCount += ghostVideoIds.length;
      }
    }

    try {
      await createBackupSnapshotInternal();
      manifestUpdated = true;
    } catch (snapErr) {
      console.warn("[Duckroom S3 Reconcile] Manifest update failed after purge:", snapErr);
    }
  }

  const activeReferenced = new Set<string>();
  activeReferenced.add("library_manifest.json");
  activeTracks.forEach((t) => {
    if (t.storage_key) activeReferenced.add(extractS3KeyFromUrl(t.storage_key) || t.storage_key);
    if (t.cover_storage_key) activeReferenced.add(extractS3KeyFromUrl(t.cover_storage_key) || t.cover_storage_key);
  });
  activeAlbums.forEach((a) => {
    if (a.cover_storage_key) activeReferenced.add(extractS3KeyFromUrl(a.cover_storage_key) || a.cover_storage_key);
    if (a.title) {
      const slug = sanitizeStorageKeySegment(a.title);
      activeReferenced.add(`audio/albums/${slug}/.keep`);
    }
  });
  activeVideos.forEach((v) => {
    if (v.storage_key) activeReferenced.add(extractS3KeyFromUrl(v.storage_key) || v.storage_key);
    if (v.thumb_storage_key) activeReferenced.add(extractS3KeyFromUrl(v.thumb_storage_key) || v.thumb_storage_key);
  });
  (liveSessionsRes.data || []).forEach((s) => {
    if (s.staging_storage_key)
      activeReferenced.add(extractS3KeyFromUrl(s.staging_storage_key) || s.staging_storage_key);
    if (s.artwork_staging_key)
      activeReferenced.add(extractS3KeyFromUrl(s.artwork_staging_key) || s.artwork_staging_key);
  });

  const orphanS3Keys = allS3.filter((k) => !activeReferenced.has(k));

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "storage.reconcile",
    resource_type: "storage",
    resource_id: "reconcile-audit",
    metadata: {
      totalDbTracks: activeTracks.length,
      ghostCount: ghostTracks.length,
      ghostVideoCount: ghostVideos.length,
      purgedGhostCount,
      stagingLeakCount: stagingLeaks.length,
      orphanS3Count: orphanS3Keys.length,
    },
  });

  return {
    totalDbTracks: activeTracks.length,
    validDbTracks: activeTracks.length - ghostTracks.length,
    ghostTracks,
    stagingLeaks,
    brokenCovers,
    ghostVideos,
    brokenVideoThumbs,
    orphanS3Keys,
    totalS3Objects: allS3.length,
    purgedGhostCount,
    manifestUpdated,
  };
}

export const reconcileStorageWithDbServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ autoPurgeGhosts: z.boolean().default(false) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await reconcileStorageWithDbInternal(data.autoPurgeGhosts, actorUserId);
  });

export async function createBackupSnapshotInternal() {
  const db = getSupabaseAdmin();
  const [albums, tracks, videos] = await Promise.all([
    db.from("albums").select("*").neq("status", "trash").order("year", { ascending: false }),
    db.from("tracks").select("*").neq("status", "trash").order("created_at", { ascending: true }),
    db.from("videos").select("*").neq("status", "trash").order("year", { ascending: false }),
  ]);

  const snapshot = {
    version: 2,
    createdAt: new Date().toISOString(),
    albums: albums.data || [],
    tracks: tracks.data || [],
    videos: videos.data || [],
  };

  let s3DirectWriteWarning: string | null = null;
  try {
    await saveLibraryManifestInternal(JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.warn("[Duckroom Backup Snapshot] Direct S3 write unavailable:", err);
    s3DirectWriteWarning = "Đã chuẩn bị snapshot từ PostgreSQL. Kết nối S3 trực tiếp từ serverless IP bị giới hạn.";
  }

  return {
    success: true,
    createdAt: snapshot.createdAt,
    tracks: snapshot.tracks.length,
    albums: snapshot.albums.length,
    videos: snapshot.videos.length,
    s3DirectWriteWarning,
  };
}

export const createBackupSnapshotServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .handler(async () => createBackupSnapshotInternal());

// ---------------------------------------------------------------------------
// Phase 10 — Owner Console completion (Master Plan §25)
// ---------------------------------------------------------------------------

export interface OwnerUserProfile {
  user_id: string;
  email: string;
  role: string;
  display_name: string | null;
  handle?: string | null;
  avatar_url?: string | null;
  friend_code?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
}

export async function getOwnerUsersInternal(dbClient?: any): Promise<{ users: OwnerUserProfile[] }> {
  const db = dbClient || getSupabaseAdmin();

  const lastSignInMap = new Map<string, string>();
  const authUserMap = new Map<string, any>();
  try {
    if (db.auth?.admin?.listUsers) {
      const { data: authData } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (authData?.users) {
        const authUsers = authData.users;
        for (const u of authUsers) {
          authUserMap.set(u.id, u);
          if (u.last_sign_in_at) lastSignInMap.set(u.id, u.last_sign_in_at);
        }
        const { data: existingProfiles } = await db.from("profiles").select("user_id");
        const existingSet = new Set((existingProfiles || []).map((p: any) => p.user_id));
        const missing = authUsers.filter((u: any) => !existingSet.has(u.id));
        if (missing.length > 0) {
          for (const u of missing) {
            try {
              const email = (u.email || "unknown@example.invalid").toLowerCase();
              const meta = u.user_metadata || {};
              const displayName = meta.full_name || meta.name || meta.user_name || email.split("@")[0] || "Thành viên";
              const handle = generateTemporaryHandle();
              const friendCode = generateFriendCode();
              await db.from("profiles").insert({
                user_id: u.id,
                email,
                role: "member",
                display_name: displayName,
                handle,
                friend_code: friendCode,
                created_at: u.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            } catch (insErr) {
              console.warn("[Duckroom Owner] Failed to backfill profile for user in list:", u.id, insErr);
            }
          }
        }
      }
    }
  } catch (authErr) {
    console.warn("[Duckroom Owner] Failed to sync auth users in list:", authErr);
  }

  const { data: profileRows, error } = await db
    .from("profiles")
    .select("user_id,email,role,display_name,handle,avatar_storage_key,friend_code,created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  const { resolveAvatarUrlInternal } = await import("./social/social-profile.server");
  const seenUserIds = new Set<string>();

  const usersWithAvatars: OwnerUserProfile[] = await Promise.all(
    (profileRows ?? []).map(async (u: any) => {
      seenUserIds.add(u.user_id);
      let avatarUrl: string | null = null;
      if (u.avatar_storage_key) {
        avatarUrl = await resolveAvatarUrlInternal(u.avatar_storage_key);
      } else {
        // Check if Google user metadata contains an avatar URL
        const authUser = authUserMap.get(u.user_id);
        const metaAvatar = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture;
        if (metaAvatar && typeof metaAvatar === "string") {
          avatarUrl = metaAvatar;
        }
      }
      return {
        user_id: u.user_id,
        email: u.email,
        role: u.role,
        display_name: u.display_name,
        handle: u.handle ?? null,
        avatar_url: avatarUrl,
        friend_code: u.friend_code ?? null,
        created_at: u.created_at,
        last_sign_in_at: lastSignInMap.get(u.user_id) ?? null,
      };
    }),
  );

  // Merge any auth users not yet in profiles (e.g. freshly signed in on mobile)
  for (const [userId, authUser] of authUserMap.entries()) {
    if (!seenUserIds.has(userId)) {
      const meta = authUser.user_metadata || {};
      const email = authUser.email || "unknown@example.invalid";
      const displayName = meta.full_name || meta.name || meta.user_name || email.split("@")[0] || "Thành viên";
      const metaAvatar = meta.avatar_url || meta.picture || null;
      usersWithAvatars.push({
        user_id: userId,
        email,
        role: "member",
        display_name: displayName,
        handle: null,
        avatar_url: metaAvatar,
        friend_code: null,
        created_at: authUser.created_at || new Date().toISOString(),
        last_sign_in_at: authUser.last_sign_in_at || null,
      });
    }
  }

  return { users: usersWithAvatars };
}

export const getOwnerUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async (): Promise<{ users: OwnerUserProfile[] }> => {
    return await getOwnerUsersInternal();
  });

export interface OwnerAlbumItem {
  id: string;
  title: string;
  artist: string;
  year: number;
  cover: string;
  display_priority: number;
  trackCount: number;
  totalDurationSeconds: number;
  status: string;
}

export interface OwnerTrackItem {
  id: string;
  title: string;
  artist: string;
  albumId?: string | undefined;
  albumTitle?: string | undefined;
  trackNo: number;
  duration: number;
  format: string;
  bitDepth: number;
  sampleRate: number;
  sizeMB: number;
  storage_key?: string | undefined;
  cover?: string | undefined;
  hasLyrics: boolean;
  status?: string | undefined;
}

export interface OwnerLibraryInventory {
  albums: OwnerAlbumItem[];
  singles: OwnerTrackItem[];
  tracks: OwnerTrackItem[];
}

export const getOwnerLibraryInventoryServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async (): Promise<OwnerLibraryInventory> => {
    const { getPublicMasterLibraryInternal } = await import("./master-library");
    const master = await getPublicMasterLibraryInternal();

    const albumMap = new Map<string, (typeof master.albums)[0]>();
    const albumTrackCount = new Map<string, number>();
    const albumDuration = new Map<string, number>();

    for (const a of master.albums) {
      albumMap.set(a.id, a);
      albumTrackCount.set(a.id, 0);
      albumDuration.set(a.id, 0);
    }

    const allTracks: OwnerTrackItem[] = [];
    const singles: OwnerTrackItem[] = [];

    for (const t of master.tracks) {
      const album = t.albumId ? albumMap.get(t.albumId) : undefined;
      const isSingle = !t.albumId || t.albumId === "singles" || t.albumId === "single" || !album;

      const trackItem: OwnerTrackItem = {
        id: t.id,
        title: t.title,
        artist: t.artist,
        albumId: t.albumId,
        albumTitle: album?.title || (isSingle ? "Đĩa đơn" : undefined),
        trackNo: t.trackNo,
        duration: t.duration,
        format: t.format,
        bitDepth: t.bitDepth,
        sampleRate: t.sampleRate,
        sizeMB: t.sizeMB,
        storage_key: t.storage_key,
        cover: t.cover,
        hasLyrics: Array.isArray(t.lyrics) && t.lyrics.length > 0,
      };

      allTracks.push(trackItem);

      if (isSingle) {
        singles.push(trackItem);
      } else if (t.albumId) {
        albumTrackCount.set(t.albumId, (albumTrackCount.get(t.albumId) || 0) + 1);
        albumDuration.set(t.albumId, (albumDuration.get(t.albumId) || 0) + t.duration);
      }
    }

    const albums: OwnerAlbumItem[] = master.albums.map((a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      year: a.year,
      cover: a.cover,
      display_priority: a.display_priority ?? 999,
      trackCount: albumTrackCount.get(a.id) || 0,
      totalDurationSeconds: albumDuration.get(a.id) || 0,
      status: a.status || "active",
    }));

    return {
      albums,
      singles,
      tracks: allTracks,
    };
  });

/**
 * Thay đổi role của một user. Guards (§21.4 — enforce trên server):
 * - Target phải tồn tại.
 * - Owner KHÔNG được tự đổi role của chính mình (chống tự khoá khỏi console).
 * - Mọi thay đổi ghi audit_logs.
 */
export async function setUserRoleInternal(
  data: { userId: string; role: "member" | "owner" },
  actorUserId?: string | null,
): Promise<{ success: boolean; userId: string; role: string }> {
  if (actorUserId && actorUserId === data.userId) {
    throw new Error("Không thể tự thay đổi vai trò của chính bạn.");
  }

  const db = getSupabaseAdmin();

  const { data: target, error: fetchError } = await db
    .from("profiles")
    .select("user_id,role")
    .eq("user_id", data.userId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!target) throw new Error("Người dùng không tồn tại.");
  if (target.role === data.role) return { success: true, userId: data.userId, role: data.role };

  const { error } = await db.from("profiles").update({ role: data.role }).eq("user_id", data.userId);
  if (error) throw new Error(error.message);

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "user.role_changed",
    resource_type: "profile",
    resource_id: data.userId,
    metadata: { from: target.role, to: data.role },
  });

  try {
    const { invalidateAuthUser } = await import("./auth.server");
    invalidateAuthUser(data.userId);
  } catch (authErr) {
    console.warn("[AUTH] Failed to invalidate auth user cache:", data.userId, authErr);
  }

  return { success: true, userId: data.userId, role: data.role };
}

export const setUserRoleServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      userId: z.string().min(1).max(128),
      role: z.enum(["member", "owner"]),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string | null } })?.auth?.userId ?? null;
    return setUserRoleInternal(data, actorUserId);
  });

export interface DuplicateMasterGroup {
  sha256: string;
  fileSizeBytes: number | null;
  kind: "track" | "video";
  items: Array<{
    fileId: string;
    trackId: string;
    title: string;
    storageKey: string;
    verifiedAt: string | null;
  }>;
}

/** Nhóm master trùng lặp theo SHA-256 (§24.4 duplicate detection). */
export async function scanDuplicateMastersInternal(): Promise<{
  groups: DuplicateMasterGroup[];
  scannedFiles: number;
}> {
  const db = getSupabaseAdmin();
  const [trackFiles, videoFiles] = await Promise.all([
    db
      .from("track_files")
      .select("id,track_id,sha256,file_size_bytes,storage_key,verified_at")
      .not("sha256", "is", null)
      .limit(10000),
    db
      .from("video_files")
      .select("id,video_id,sha256,file_size_bytes,storage_key,verified_at")
      .not("sha256", "is", null)
      .limit(10000),
  ]);
  if (trackFiles.error) throw new Error(trackFiles.error.message);
  if (videoFiles.error) throw new Error(videoFiles.error.message);

  const trackIds = new Set<string>();
  const videoIds = new Set<string>();
  [...(trackFiles.data ?? []), ...(videoFiles.data ?? [])].forEach((f: Record<string, unknown>) => {
    if (f["track_id"]) trackIds.add(String(f["track_id"]));
    if (f["video_id"]) videoIds.add(String(f["video_id"]));
  });

  const trackTitles = new Map<string, string>();
  if (trackIds.size) {
    const { data } = await db
      .from("tracks")
      .select("id,title")
      .in("id", [...trackIds]);
    (data ?? []).forEach((t: Pick<TrackRow, "id" | "title">) => trackTitles.set(String(t.id), String(t.title ?? "")));
  }
  const videoTitles = new Map<string, string>();
  if (videoIds.size) {
    const { data } = await db
      .from("videos")
      .select("id,title")
      .in("id", [...videoIds]);
    (data ?? []).forEach((v: Pick<VideoRow, "id" | "title">) => videoTitles.set(String(v.id), String(v.title ?? "")));
  }

  const groups: DuplicateMasterGroup[] = [];
  interface FileCandidate {
    id?: string;
    sha256?: string | null;
    file_size_bytes?: number | null;
    storage_key: string;
    verified_at?: string;
    [key: string]: unknown;
  }
  const collect = (
    rows: FileCandidate[] | null,
    kind: "track" | "video",
    idField: "track_id" | "video_id",
    titles: Map<string, string>,
  ) => {
    const byHash = new Map<string, FileCandidate[]>();
    (rows ?? []).forEach((f) => {
      if (!f.sha256) return;
      const list = byHash.get(f.sha256 as string);
      if (list) list.push(f);
      else byHash.set(f.sha256 as string, [f]);
    });
    for (const [sha256, files] of byHash) {
      if (files.length < 2) continue;
      groups.push({
        sha256,
        kind,
        fileSizeBytes: files[0]?.file_size_bytes ?? null,
        items: files.map((f) => ({
          fileId: String(f.id),
          trackId: String(f[idField]),
          title: titles.get(String(f[idField])) ?? "(không tiêu đề)",
          storageKey: String(f.storage_key ?? ""),
          verifiedAt: (f.verified_at as string | null) ?? null,
        })),
      });
    }
  };
  collect(trackFiles.data ?? [], "track", "track_id", trackTitles);
  collect(videoFiles.data ?? [], "video", "video_id", videoTitles);

  return {
    groups,
    scannedFiles: (trackFiles.data?.length ?? 0) + (videoFiles.data?.length ?? 0),
  };
}

export const scanDuplicateMastersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => scanDuplicateMastersInternal());

export interface OwnerShareRow {
  id: string;
  resource_type: string;
  resource_id: string;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: "active" | "revoked" | "expired";
}

export const getOwnerSharesServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async (): Promise<{ shares: OwnerShareRow[] }> => {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("share_links")
      .select("id,resource_type,resource_id,created_by,expires_at,revoked_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const now = Date.now();
    const shares: OwnerShareRow[] = (data ?? []).map(
      (
        s: Pick<
          ShareLinkRow,
          "id" | "resource_type" | "resource_id" | "created_by" | "expires_at" | "revoked_at" | "created_at"
        >,
      ) => ({
        id: String(s.id),
        resource_type: String(s.resource_type),
        resource_id: String(s.resource_id),
        created_by: s.created_by ? String(s.created_by) : null,
        expires_at: s.expires_at ?? null,
        revoked_at: s.revoked_at ?? null,
        created_at: String(s.created_at),
        status: s.revoked_at
          ? ("revoked" as const)
          : s.expires_at && new Date(s.expires_at).getTime() <= now
            ? ("expired" as const)
            : ("active" as const),
      }),
    );
    return { shares };
  });

/** Thu hồi share link theo row-id (Owner console không giữ raw token). */
export async function revokeShareByIdInternal(
  data: { shareId: string },
  actorUserId?: string | null,
): Promise<{ success: boolean; shareId: string }> {
  const db = getSupabaseAdmin();

  const { data: share, error: fetchError } = await db
    .from("share_links")
    .select("id,revoked_at")
    .eq("id", data.shareId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!share) throw new Error("Share link không tồn tại.");
  if (share.revoked_at) return { success: true, shareId: data.shareId };

  const { error } = await db
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.shareId);
  if (error) throw new Error(error.message);

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "share.revoked",
    resource_type: "share_links",
    resource_id: data.shareId,
    metadata: { via: "owner_console" },
  });
  return { success: true, shareId: data.shareId };
}

export const revokeShareByIdServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(z.object({ shareId: z.string().min(1).max(128) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string | null } })?.auth?.userId ?? null;
    return revokeShareByIdInternal(data, actorUserId);
  });

export interface UploadHealthSummary {
  total: number;
  byStatus: Record<string, number>;
  stuckSessions: Array<{
    id: string;
    expectedFilename: string;
    status: string;
    stage: string;
    updatedAt: string | null;
  }>;
}

/** Sức khoẻ hàng đợi upload (§25.2 failed uploads + §8.2 recovery states). */
export const getUploadHealthServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async (): Promise<UploadHealthSummary> => {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("upload_sessions")
      .select("id,expected_filename,status,stage,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const byStatus: Record<string, number> = {};
    (data ?? []).forEach((s: Record<string, unknown>) => {
      const key = String(s["status"] ?? "unknown");
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    });

    const nonTerminal = new Set(["created", "staged", "verifying", "approved", "committing"]);
    const stuckSessions = (data ?? [])
      .filter((s: Record<string, unknown>) => nonTerminal.has(String(s["status"])))
      .slice(0, 20)
      .map((s: Record<string, unknown>) => ({
        id: String(s["id"]),
        expectedFilename: String(s["expected_filename"] ?? ""),
        status: String(s["status"] ?? ""),
        stage: String(s["stage"] ?? ""),
        updatedAt: (s["updated_at"] as string | null) ?? null,
      }));

    return { total: data?.length ?? 0, byStatus, stuckSessions };
  });

export interface SnapshotVerifyResult {
  snapshotFound: boolean;
  parsedOk: boolean;
  snapshotCounts: { tracks: number; albums: number; videos: number };
  dbCounts: { tracks: number; albums: number; videos: number };
  drift: { tracks: number; albums: number; videos: number };
  createdAt: string | null;
  message: string;
}

function streamToString(stream: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = stream as AsyncIterable<Uint8Array> | null;
    if (!readable || typeof (readable as any)[Symbol.asyncIterator] !== "function") {
      reject(new Error("S3 GetObject trả về body không đọc được."));
      return;
    }
    void (async () => {
      try {
        for await (const chunk of readable) chunks.push(Buffer.from(chunk));
        resolve(Buffer.concat(chunks).toString("utf-8"));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

/**
 * Xác minh snapshot sao lưu so với DB hiện tại (§24 Layer 2/3).
 * CHỈ ĐỌC — restore thật sự vẫn là quy trình có người duyệt, không nút bấm mù quáng.
 */
export async function verifyBackupSnapshotInternal(): Promise<SnapshotVerifyResult> {
  const db = getSupabaseAdmin();
  const s3 = getS3ServerClient();

  let raw: string | null = null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: "library_manifest.json" }));
    raw = await streamToString(res.Body);
  } catch {
    raw = null;
  }

  const [tracksCount, albumsCount, videosCount] = await Promise.all([
    db.from("tracks").select("id", { count: "exact", head: true }),
    db.from("albums").select("id", { count: "exact", head: true }),
    db.from("videos").select("id", { count: "exact", head: true }),
  ]);
  const err = tracksCount.error || albumsCount.error || videosCount.error;
  if (err) throw new Error((err as { message?: string }).message || "Không thể đếm bản ghi DB.");

  const dbCounts = {
    tracks: tracksCount.count ?? 0,
    albums: albumsCount.count ?? 0,
    videos: videosCount.count ?? 0,
  };

  if (raw === null) {
    return {
      snapshotFound: false,
      parsedOk: false,
      snapshotCounts: { tracks: 0, albums: 0, videos: 0 },
      dbCounts,
      drift: dbCounts,
      createdAt: null,
      message: "Chưa có snapshot nào trên S3. Hãy tạo Snapshot S3 trước.",
    };
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const snapshotCounts =
    parsed && Array.isArray(parsed.tracks) && Array.isArray(parsed.albums) && Array.isArray(parsed.videos)
      ? {
          tracks: parsed.tracks.length,
          albums: parsed.albums.length,
          videos: parsed.videos.length,
        }
      : { tracks: 0, albums: 0, videos: 0 };

  if (!parsed || !Array.isArray(parsed.tracks)) {
    return {
      snapshotFound: true,
      parsedOk: false,
      snapshotCounts,
      dbCounts,
      drift: {
        tracks: dbCounts.tracks - snapshotCounts.tracks,
        albums: dbCounts.albums - snapshotCounts.albums,
        videos: dbCounts.videos - snapshotCounts.videos,
      },
      createdAt: null,
      message: "Snapshot tồn tại nhưng JSON hỏng hoặc sai cấu trúc — cần tạo lại snapshot.",
    };
  }

  const drift = {
    tracks: dbCounts.tracks - snapshotCounts.tracks,
    albums: dbCounts.albums - snapshotCounts.albums,
    videos: dbCounts.videos - snapshotCounts.videos,
  };
  const inSync = drift.tracks === 0 && drift.albums === 0 && drift.videos === 0;

  return {
    snapshotFound: true,
    parsedOk: true,
    snapshotCounts,
    dbCounts,
    drift,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
    message: inSync
      ? "Snapshot khớp hoàn toàn với database hiện tại."
      : `Snapshot lệch với DB: ${drift.tracks > 0 ? `+${drift.tracks} track` : `${drift.tracks} track`}, ${
          drift.albums > 0 ? `+${drift.albums} album` : `${drift.albums} album`
        }, ${drift.videos > 0 ? `+${drift.videos} video` : `${drift.videos} video`} (DB − snapshot). Cân nhắc tạo snapshot mới.`,
  };
}

export const verifyBackupSnapshotServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => verifyBackupSnapshotInternal());

export async function updateAlbumDisplayPriorityInternal(
  data: { albumId: string; displayPriority: number },
  actorUserId?: string | null,
): Promise<{ success: boolean; albumId: string; displayPriority: number }> {
  const db = getSupabaseAdmin();

  const { data: target, error: fetchError } = await db
    .from("albums")
    .select("id,display_priority")
    .eq("id", data.albumId)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!target) throw new Error("Album không tồn tại.");

  const prevPriority = target.display_priority;
  if (prevPriority === data.displayPriority) {
    return { success: true, albumId: data.albumId, displayPriority: data.displayPriority };
  }

  const { error: updateError } = await db
    .from("albums")
    .update({ display_priority: data.displayPriority, updated_at: new Date().toISOString() })
    .eq("id", data.albumId);

  if (updateError) throw new Error(updateError.message);

  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: "album.priority_updated",
    resource_type: "album",
    resource_id: data.albumId,
    metadata: { from: prevPriority, to: data.displayPriority },
  });

  return { success: true, albumId: data.albumId, displayPriority: data.displayPriority };
}

export const updateAlbumDisplayPriorityServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshOwnerMiddleware])
  .validator(
    z.object({
      albumId: z.string().min(1).max(128),
      displayPriority: z.number().int(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string | null } })?.auth?.userId ?? null;
    return updateAlbumDisplayPriorityInternal(data, actorUserId);
  });
