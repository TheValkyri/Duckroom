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
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { extractS3KeyFromUrl } from "./s3-key";

export const getOwnerHealthServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async () => {
    const db = getSupabaseAdmin();

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

    const audioCount = trackFiles.count ?? tracks.count ?? 0;
    const videoCount = videoFiles.count ?? videos.count ?? 0;
    const artworkCount = (albumCovers.count ?? 0) + (trackCovers.count ?? 0);
    const totalObjects = audioCount + videoCount + artworkCount;

    return {
      counts: {
        tracks: tracks.count ?? 0,
        albums: albums.count ?? 0,
        videos: videos.count ?? 0,
        users: profiles.count ?? 0,
        playlists: playlists.count ?? 0,
        favorites: favorites.count ?? 0,
        history: history.count ?? 0,
        objects: totalObjects,
      },
      storage: {
        audioObjects: audioCount,
        videoObjects: videoCount,
        artworkObjects: artworkCount,
        manifestPresent: true,
        s3Available: true,
        s3Error: null,
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
    const [allS3, tracks, albums, videos, liveSessions] = await Promise.all([
      listS3ObjectsInternal(),
      db.from("tracks").select("storage_key,cover_storage_key"),
      db.from("albums").select("cover_storage_key"),
      db.from("videos").select("storage_key,thumb_storage_key"),
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
    });

    (videos.data || []).forEach((v) => {
      if (v.storage_key) activeKeys.add(extractS3KeyFromUrl(v.storage_key) || v.storage_key);
      if (v.thumb_storage_key) activeKeys.add(extractS3KeyFromUrl(v.thumb_storage_key) || v.thumb_storage_key);
    });

    (liveSessions.data || []).forEach((s: any) => {
      if (s.staging_storage_key) {
        activeKeys.add(extractS3KeyFromUrl(s.staging_storage_key) || s.staging_storage_key);
      }
      if (s.artwork_staging_key) {
        activeKeys.add(extractS3KeyFromUrl(s.artwork_staging_key) || s.artwork_staging_key);
      }
    });

    const orphanKeys = allS3.filter((key) => !activeKeys.has(key));
    return {
      totalS3Objects: allS3.length,
      activeReferencedObjects: activeKeys.size,
      orphanKeys,
    };
  });

export const cleanupOrphanS3ObjectsServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
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

    try {
      await db.from("audit_logs").insert({
        actor_user_id: actorUserId ?? null,
        action: "storage.orphan_cleanup",
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
    } catch {
      // audit failure must not block cleanup reporting
    }

    return { success: true, deletedCount: deleted.length, failed, skippedStale };
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

    const saved = await saveLibraryManifestInternal(JSON.stringify(snapshot, null, 2));
    if (!saved) {
      throw new Error("Không thể ghi snapshot library_manifest.json lên S3");
    }

    return {
      success: true,
      createdAt: snapshot.createdAt,
      tracks: snapshot.tracks.length,
      albums: snapshot.albums.length,
      videos: snapshot.videos.length,
    };
  });

// ---------------------------------------------------------------------------
// Phase 10 — Owner Console completion (Master Plan §25)
// ---------------------------------------------------------------------------

export interface OwnerUserProfile {
  user_id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
}

export const getOwnerUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .handler(async (): Promise<{ users: OwnerUserProfile[] }> => {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("profiles")
      .select("user_id,email,role,display_name,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { users: (data ?? []) as OwnerUserProfile[] };
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

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "user.role_changed",
      resource_type: "profile",
      resource_id: data.userId,
      metadata: { from: target.role, to: data.role },
    });
  } catch {
    // audit failure không chặn mutation đã commit
  }
  return { success: true, userId: data.userId, role: data.role };
}

export const setUserRoleServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
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
  [...(trackFiles.data ?? []), ...(videoFiles.data ?? [])].forEach((f: any) => {
    if (f.track_id) trackIds.add(String(f.track_id));
    if (f.video_id) videoIds.add(String(f.video_id));
  });

  const trackTitles = new Map<string, string>();
  if (trackIds.size) {
    const { data } = await db
      .from("tracks")
      .select("id,title")
      .in("id", [...trackIds]);
    (data ?? []).forEach((t: any) => trackTitles.set(String(t.id), String(t.title ?? "")));
  }
  const videoTitles = new Map<string, string>();
  if (videoIds.size) {
    const { data } = await db
      .from("videos")
      .select("id,title")
      .in("id", [...videoIds]);
    (data ?? []).forEach((v: any) => videoTitles.set(String(v.id), String(v.title ?? "")));
  }

  const groups: DuplicateMasterGroup[] = [];
  const collect = (
    rows: any[] | null,
    kind: "track" | "video",
    idField: "track_id" | "video_id",
    titles: Map<string, string>,
  ) => {
    const byHash = new Map<string, any[]>();
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
    const shares: OwnerShareRow[] = (data ?? []).map((s: any) => ({
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
    }));
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

  try {
    await db.from("audit_logs").insert({
      actor_user_id: actorUserId ?? null,
      action: "share.revoked",
      resource_type: "share_links",
      resource_id: data.shareId,
      metadata: { via: "owner_console" },
    });
  } catch {
    // audit failure không chặn thu hồi
  }
  return { success: true, shareId: data.shareId };
}

export const revokeShareByIdServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
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
    (data ?? []).forEach((s: any) => {
      const key = String(s.status ?? "unknown");
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    });

    const nonTerminal = new Set(["created", "staged", "verifying", "approved", "committing"]);
    const stuckSessions = (data ?? [])
      .filter((s: any) => nonTerminal.has(String(s.status)))
      .slice(0, 20)
      .map((s: any) => ({
        id: String(s.id),
        expectedFilename: String(s.expected_filename ?? ""),
        status: String(s.status ?? ""),
        stage: String(s.stage ?? ""),
        updatedAt: (s.updated_at as string | null) ?? null,
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
