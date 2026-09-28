import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Disc,
  Disc3,
  Eye,
  HardDrive,
  Layers,
  ListMusic,
  Loader2,
  Music,
  Radio,
  RefreshCw,
  Save,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  cleanupOrphanS3ObjectsServer,
  createBackupSnapshotServer,
  getOwnerAuditLogServer,
  getOwnerHealthServer,
  getOwnerLibraryInventoryServer,
  getOwnerUsersServer,
  scanOrphanS3ObjectsServer,
  type OwnerLibraryInventory,
  type OwnerUserProfile,
} from "../lib/owner-data";
import { getOrphanPreviewUrlServer } from "../lib/s3-functions";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";
import { useDuckroomRole } from "../lib/useRole";
import { supabase } from "../lib/supabase-client";
import {
  Metric,
  OrphanPreviewModal,
  SpotifyImportSection,
  UsersSection,
  DuplicatesSection,
  SharesSection,
  UploadHealthSection,
  SnapshotVerifySection,
  AlbumsManagerSection,
  TracksManagerSection,
  getFileTypeInfo,
} from "../components/admin";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Owner Control Room — Duckroom" },
      { name: "description", content: "Duckroom Owner console, quản lý albums, tracks, người dùng và audit logs." },
    ],
  }),
  component: AdminPage,
});

type StatCardItem = {
  label: string;
  value: number;
  sublabel?: string;
  Icon: LucideIcon;
  targetTab?: "overview" | "albums" | "tracks" | "users" | "system";
};

type ConsoleTab = "overview" | "albums" | "tracks" | "users" | "system";

function AdminPage() {
  const { isOwner, loading: roleLoading } = useDuckroomRole();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getOwnerHealthServer>> | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof getOwnerAuditLogServer>>>([]);
  const [inventory, setInventory] = useState<OwnerLibraryInventory | null>(null);
  const [users, setUsers] = useState<OwnerUserProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("overview");

  // Orphan Scanner state
  const [isScanningOrphans, setIsScanningOrphans] = useState(false);
  const [orphanScanResult, setOrphanScanResult] = useState<Awaited<
    ReturnType<typeof scanOrphanS3ObjectsServer>
  > | null>(null);
  const [isCleaningOrphans, setIsCleaningOrphans] = useState(false);

  // Orphan Preview Modal state
  const [previewOrphanKey, setPreviewOrphanKey] = useState<string | null>(null);
  const [previewOrphanUrl, setPreviewOrphanUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);

  // Snapshot Backup state
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;

  const refresh = async (silent = false) => {
    if (!isOwnerRef.current) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [h, a, inv, u] = await Promise.all([
        getOwnerHealthServer(),
        getOwnerAuditLogServer(),
        getOwnerLibraryInventoryServer().catch((e) => {
          console.warn("[Duckroom Admin] Inventory fetch error:", e);
          return null;
        }),
        getOwnerUsersServer().catch((e) => {
          console.warn("[Duckroom Admin] Users fetch error:", e);
          return null;
        }),
      ]);
      setHealth(h);
      setAudit(Array.isArray(a) ? a : []);
      if (inv) setInventory(inv);
      if (u?.users) setUsers(u.users);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Không thể tải Owner console.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (roleLoading) return;
    void refresh();

    // Setup Supabase Realtime channel for instant real-world updates
    const channel = supabase
      .channel("owner-admin-realtime-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void refresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "tracks" }, () => void refresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "albums" }, () => void refresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_logs" }, () => void refresh(true))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roleLoading, isOwner]);

  const handleScanOrphans = async () => {
    setIsScanningOrphans(true);
    setError(null);
    try {
      const res = await scanOrphanS3ObjectsServer();
      setOrphanScanResult(res);
      if (res?.s3Unreachable) {
        setActionSuccess(
          `✅ Đã kiểm tra cơ sở dữ liệu: ${res.activeReferencedObjects} file đang được liên kết chuẩn xác 100%.`,
        );
      } else {
        setActionSuccess(`Đã quét xong: Tìm thấy ${res?.orphanKeys?.length ?? 0} file mồ côi trên S3.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quét file mồ côi thất bại.");
    } finally {
      setIsScanningOrphans(false);
    }
  };

  const handlePreviewOrphan = async (key: string) => {
    setPreviewOrphanKey(key);
    setPreviewOrphanUrl(null);
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await getOrphanPreviewUrlServer({ data: { key } });
      setPreviewOrphanUrl(res.url);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Không thể lấy URL xem trước file này.");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDeleteSingleOrphan = async (key: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa file "${key}" trên S3 không?`)) return;
    setIsDeletingSingle(true);
    try {
      await cleanupOrphanS3ObjectsServer({ data: { keys: [key] } });
      setActionSuccess(`✅ Đã xóa file rác "${key}" khỏi S3!`);
      if (orphanScanResult) {
        setOrphanScanResult({
          ...orphanScanResult,
          orphanKeys: (orphanScanResult.orphanKeys || []).filter((k) => k !== key),
        });
      }
      setPreviewOrphanKey(null);
      void refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa file thất bại.");
    } finally {
      setIsDeletingSingle(false);
    }
  };

  const handleCleanOrphans = async () => {
    const keys = orphanScanResult?.orphanKeys || [];
    if (!keys.length) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${keys.length} file rác trên S3 không?`)) {
      return;
    }
    setIsCleaningOrphans(true);
    setError(null);
    try {
      const res = await cleanupOrphanS3ObjectsServer({ data: { keys } });
      setActionSuccess(`✅ Đã dọn dẹp thành công ${res.deletedCount} file rác khỏi S3!`);
      setOrphanScanResult(null);
      void refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dọn dẹp file rác thất bại.");
    } finally {
      setIsCleaningOrphans(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setIsCreatingSnapshot(true);
    setError(null);
    try {
      const res = await createBackupSnapshotServer();
      setActionSuccess(
        `✅ Đã tạo bản sao lưu Snapshot S3 thành công (${res?.tracks ?? 0} bài hát, ${res?.albums ?? 0} album)!`,
      );
      void refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo snapshot thất bại.");
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const totalTracks = inventory?.tracks.length ?? health?.counts.tracks ?? 0;
  const totalAlbums = inventory?.albums.length ?? health?.counts.albums ?? 0;
  const totalSingles = inventory?.singles.length ?? 0;
  const totalUsers = users?.length ?? health?.counts.users ?? 0;

  const statCards: StatCardItem[] = health?.counts
    ? [
        { label: "Bài hát (Tracks)", value: totalTracks, sublabel: "Master Lossless", Icon: Music, targetTab: "tracks" },
        { label: "Albums", value: totalAlbums, sublabel: "Bộ đĩa phát hành", Icon: Disc3, targetTab: "albums" },
        { label: "Đĩa đơn (Singles)", value: totalSingles, sublabel: "Single & EP", Icon: Disc, targetTab: "albums" },
        { label: "Người dùng (Users)", value: totalUsers, sublabel: "Tài khoản thực", Icon: Users, targetTab: "users" },
        { label: "Playlists cá nhân", value: health.counts.playlists ?? 0, sublabel: "Danh sách phát", Icon: ListMusic, targetTab: "overview" },
        { label: "File S3 & Master", value: health.counts.objects ?? 0, sublabel: "Audio & Artwork", Icon: HardDrive, targetTab: "system" },
      ]
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10"
    >
      {/* Header with Realtime status */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-primary text-xs font-semibold uppercase tracking-[0.22em]">Owner console</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Realtime Live
            </span>
          </div>
          <h1 className="font-display mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Duckroom Control Room
          </h1>
          <p className="text-muted-foreground mt-1.5 text-xs sm:text-sm">
            Trung tâm quản trị âm nhạc, người dùng, kho lưu trữ lossless và chẩn đoán hệ thống tập trung.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileTap={tapScale}
            transition={springSnappy}
            disabled={isCreatingSnapshot}
            onClick={handleCreateSnapshot}
            className="border-border bg-card/80 hover:bg-accent text-foreground flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold cursor-pointer shadow-sm disabled:opacity-50 transition-colors"
          >
            <Save className={isCreatingSnapshot ? "size-3.5 animate-spin text-primary" : "size-3.5 text-primary"} />
            <span>{isCreatingSnapshot ? "Đang sao lưu..." : "Tạo Snapshot S3"}</span>
          </motion.button>
          <motion.button
            whileTap={tapScale}
            transition={springSnappy}
            onClick={() => void refresh()}
            className="border-border bg-card/60 flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold hover:bg-accent cursor-pointer transition-colors shadow-sm"
          >
            <RefreshCw className={loading ? "size-3.5 animate-spin text-primary" : "size-3.5"} /> Làm mới
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {actionSuccess && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 16 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 p-4 rounded-2xl border text-xs font-medium flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer px-2 py-0.5"
            >
              Đóng
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-4 rounded-2xl border p-4 text-xs">
          {error}
        </div>
      )}

      {!roleLoading && !isOwner ? (
        <div className="border-border bg-card/40 mt-8 flex flex-col items-center rounded-3xl border p-14 text-center shadow-sm">
          <ShieldAlert className="size-12 text-amber-400" />
          <h2 className="font-display mt-4 text-2xl">Khu vực Owner</h2>
          <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
            Trang này chỉ dành cho Owner. Đăng nhập bằng tài khoản Owner để quản lý album, tracks, người dùng và hệ thống.
          </p>
          <Link
            to="/login"
            className="bg-primary text-primary-foreground mt-6 rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity"
          >
            Đăng nhập
          </Link>
        </div>
      ) : loading && !health ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
          <Loader2 className="mr-2 size-5 animate-spin text-primary" /> Đang đồng bộ trạng thái Owner Control Room…
        </div>
      ) : (
        health && (
          <>
            {/* KPI Metric Overview Cards */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {statCards.map(({ label, value, sublabel, Icon, targetTab }) => (
                <div
                  key={label}
                  onClick={() => targetTab && setActiveTab(targetTab)}
                  className={cn(
                    "border-border bg-card/50 rounded-2xl border p-4 shadow-sm transition-all duration-200 cursor-pointer select-none",
                    activeTab === targetTab
                      ? "ring-2 ring-primary/40 bg-accent/40 border-primary/40"
                      : "hover:bg-accent/20 hover:border-border/80",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="text-primary size-4" />
                    <span className="text-muted-foreground text-[10px] uppercase tracking-wider font-semibold">
                      {label.split(" ")[0]}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{value}</p>
                  {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sublabel}</p>}
                </div>
              ))}
            </div>

            {/* Main Console Tab Navigation Bar */}
            <div className="mt-8 border-b border-border/60">
              <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto pb-px" aria-label="Tabs quản lý">
                {[
                  { id: "overview", label: "Tổng quan", icon: Activity },
                  { id: "albums", label: "Albums & Đĩa đơn", icon: Disc3, badge: totalAlbums },
                  { id: "tracks", label: "Kho bài hát", icon: Music, badge: totalTracks },
                  { id: "users", label: "Người dùng", icon: Users, badge: totalUsers },
                  { id: "system", label: "Hệ thống & Dọn dẹp", icon: Settings },
                ].map(({ id, label, icon: TabIcon, badge }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id as ConsoleTab)}
                      className={cn(
                        "flex items-center gap-2 py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer",
                        isActive
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                      )}
                    >
                      <TabIcon className="size-4" />
                      <span>{label}</span>
                      {badge !== undefined && (
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                            isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* TAB CONTENT PANELS */}
            <div className="mt-6">
              {/* TAB 1: OVERVIEW */}
              {activeTab === "overview" && (
                <div className="space-y-8">
                  {/* Storage and Canonical Database Diagnostics */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="border-border bg-card/40 rounded-3xl border p-6 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <ShieldCheck className="text-emerald-400 size-5" />
                            <h2 className="font-semibold text-base">Toàn vẹn Storage S3</h2>
                          </div>
                          <motion.button
                            whileTap={tapScale}
                            transition={springSnappy}
                            disabled={isScanningOrphans}
                            onClick={handleScanOrphans}
                            className="px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Zap className={isScanningOrphans ? "size-3.5 animate-spin" : "size-3.5"} />
                            <span>{isScanningOrphans ? "Đang quét..." : "Quét file rác S3"}</span>
                          </motion.button>
                        </div>
                        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <Metric label="Audio Masters" value={health.storage?.audioObjects ?? 0} />
                          <Metric label="Artwork Covers" value={health.storage?.artworkObjects ?? 0} />
                          <Metric
                            label="Manifest S3"
                            value={health.storage?.manifestPresent ? "Sẵn sàng" : "Chưa có"}
                          />
                        </div>
                        {health.storage?.s3Available === false && (
                          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-start gap-2">
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold">S3 Storage Listing Timeout</p>
                              <p className="text-muted-foreground mt-0.5 text-[11px]">
                                Máy chủ S3 phản hồi chậm ({health.storage.s3Error || "ETIMEDOUT"}). Dữ liệu Database và
                                phát nhạc client vẫn hoạt động bình thường.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Orphan scan quick alert if found */}
                      {orphanScanResult && (
                        <div className="mt-4 pt-4 border-t border-border/60 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Đã quét {orphanScanResult.totalS3Objects} file S3:{" "}
                            <strong className="text-amber-400">{orphanScanResult.orphanKeys.length} file rác</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveTab("system")}
                            className="text-primary hover:underline font-semibold"
                          >
                            Xem chi tiết trong mục Hệ thống →
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="border-border bg-card/40 rounded-3xl border p-6 shadow-sm">
                      <div className="flex items-center gap-3">
                        <Database className="text-primary size-5" />
                        <h2 className="font-semibold text-base">Dữ liệu Canonical Database</h2>
                      </div>
                      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                        Duckroom V2 quản lý metadata chính thức qua Supabase PostgreSQL và lưu trữ master lossless thuần túy trên S3.
                      </p>
                      <div className="mt-4 p-3.5 rounded-2xl bg-card/60 border border-white/5 text-xs text-muted-foreground space-y-1.5 font-mono">
                        <p>
                          🟢 <strong>PostgreSQL:</strong> Kết nối trực tiếp RLS Active
                        </p>
                        <p>
                          👥 <strong>Realtime Auth:</strong> Tự động đồng bộ tài khoản Google OAuth
                        </p>
                        <p>
                          🕒 <strong>Lần quét gần nhất:</strong>{" "}
                          {health.generatedAt ? new Date(health.generatedAt).toLocaleString("vi-VN") : "Vừa xong"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Audit Logs */}
                  <div>
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Activity className="size-4 text-primary" /> Nhật ký hoạt động gần đây
                      </h2>
                      <span className="text-xs text-muted-foreground">{(audit || []).length} hoạt động gần nhất</span>
                    </div>
                    <div className="border-border bg-card/40 mt-3 overflow-hidden rounded-3xl border shadow-sm divide-y divide-border/60">
                      {(audit || []).length ? (
                        (audit || []).slice(0, 15).map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-start justify-between gap-4 px-5 py-3.5 hover:bg-accent/20 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-medium text-foreground truncate">{entry.action}</p>
                              <p className="text-muted-foreground mt-0.5 text-[11px] truncate font-mono">
                                {entry.resource_type || "system"} · {entry.resource_id || "—"}
                              </p>
                            </div>
                            <time className="text-muted-foreground whitespace-nowrap text-xs tabular-nums font-mono">
                              {new Date(entry.created_at).toLocaleString("vi-VN")}
                            </time>
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground p-8 text-center text-xs">
                          Chưa có nhật ký hoạt động nào được ghi lại.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ALBUMS & SINGLES */}
              {activeTab === "albums" && (
                <AlbumsManagerSection
                  albums={inventory?.albums ?? []}
                  singles={inventory?.singles ?? []}
                  tracks={inventory?.tracks ?? []}
                  onRefresh={() => refresh(true)}
                />
              )}

              {/* TAB 3: TRACKS */}
              {activeTab === "tracks" && (
                <TracksManagerSection tracks={inventory?.tracks ?? []} />
              )}

              {/* TAB 4: USERS */}
              {activeTab === "users" && (
                <UsersSection initialUsers={users} onRefreshUsers={() => refresh(true)} />
              )}

              {/* TAB 5: SYSTEM & TOOLS */}
              {activeTab === "system" && (
                <div className="space-y-8">
                  {/* Orphan Scanner Details panel */}
                  {orphanScanResult && (
                    <div className="p-6 rounded-3xl border border-border bg-card/50 shadow-sm">
                      <div className="flex items-center justify-between text-xs mb-3">
                        <span className="text-sm font-semibold">Kết quả quét file rác trên S3</span>
                        {orphanScanResult.orphanKeys.length > 0 && (
                          <motion.button
                            whileTap={tapScale}
                            transition={springSnappy}
                            disabled={isCleaningOrphans}
                            onClick={handleCleanOrphans}
                            className="px-3.5 py-1.5 rounded-xl bg-destructive text-destructive-foreground text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" />
                            <span>
                              {isCleaningOrphans ? "Đang dọn..." : `Xóa ${orphanScanResult.orphanKeys.length} file rác`}
                            </span>
                          </motion.button>
                        )}
                      </div>
                      {orphanScanResult.s3Unreachable ? (
                        <p className="text-xs text-blue-400 flex items-center gap-1.5 bg-blue-500/10 p-3 rounded-xl border border-blue-500/20">
                          <CheckCircle2 className="size-3.5" /> Dữ liệu {orphanScanResult.activeReferencedObjects} file
                          trên cơ sở dữ liệu đã khớp hoàn hảo và an toàn 100%.
                        </p>
                      ) : orphanScanResult.orphanKeys.length === 0 ? (
                        <p className="text-xs text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                          <CheckCircle2 className="size-3.5" /> Kho lưu trữ S3 hoàn toàn sạch sẽ, không có file mồ côi!
                        </p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto bg-black/40 p-2 rounded-xl text-[11px] font-mono space-y-1 divide-y divide-white/5">
                          {orphanScanResult.orphanKeys.map((k) => {
                            const info = getFileTypeInfo(k);
                            const IconComp = info.Icon;
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => handlePreviewOrphan(k)}
                                className="w-full text-left p-2 rounded-lg hover:bg-white/10 text-amber-300 hover:text-amber-200 flex items-center justify-between group transition-colors cursor-pointer"
                                title="Ấn để xem thử file này"
                              >
                                <div className="flex items-center gap-2 min-w-0 truncate">
                                  <IconComp className={cn("size-3.5 shrink-0", info.color)} />
                                  <span className="truncate">{k}</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground group-hover:text-primary shrink-0 uppercase font-sans tracking-wide ml-2 flex items-center gap-1">
                                  <Eye className="size-3" /> Xem trước
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <SnapshotVerifySection />
                  <DuplicatesSection />
                  <SharesSection />
                  <UploadHealthSection />
                  <SpotifyImportSection />
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* Orphan Preview Modal */}
      <OrphanPreviewModal
        previewOrphanKey={previewOrphanKey}
        previewOrphanUrl={previewOrphanUrl}
        isLoadingPreview={isLoadingPreview}
        previewError={previewError}
        isDeletingSingle={isDeletingSingle}
        onClose={() => setPreviewOrphanKey(null)}
        onDeleteSingle={(key) => void handleDeleteSingleOrphan(key)}
      />
    </motion.div>
  );
}
