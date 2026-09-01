import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Disc3,
  ExternalLink,
  Eye,
  FileCode,
  Film,
  HardDrive,
  ImageIcon,
  Link2,
  Loader2,
  ListMusic,
  Music,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cleanupOrphanS3ObjectsServer,
  createBackupSnapshotServer,
  getOwnerAuditLogServer,
  getOwnerHealthServer,
  getOwnerSharesServer,
  getOwnerUsersServer,
  getUploadHealthServer,
  revokeShareByIdServer,
  scanDuplicateMastersServer,
  scanOrphanS3ObjectsServer,
  setUserRoleServer,
  verifyBackupSnapshotServer,
  type DuplicateMasterGroup,
  type OwnerShareRow,
  type OwnerUserProfile,
  type SnapshotVerifyResult,
  type UploadHealthSummary,
} from "../lib/owner-data";
import {
  findLocalMatchesServer,
  linkExternalIdentityServer,
  probeSpotifyResourceServer,
  type LocalMatchCandidate,
  type SpotifyProbeResult,
} from "../services/spotify";
import { getOrphanPreviewUrlServer } from "../lib/s3-functions";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Owner Control Room — Duckroom" },
      { name: "description", content: "Duckroom Owner console, health center và audit logs." },
    ],
  }),
  component: AdminPage,
});

type StatCardItem = {
  label: string;
  value: number;
  Icon: LucideIcon;
};

function AdminPage() {
  const { isOwner, loading: roleLoading } = useDuckroomRole();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getOwnerHealthServer>> | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof getOwnerAuditLogServer>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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

  // Chỉ gọi các owner-RPC khi đã xác định role = owner — tránh 401-spam
  // trên console cho Guest/Member và payload-lỗi rác cho UI.
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;

  const refresh = async () => {
    if (!isOwnerRef.current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [h, a] = await Promise.all([getOwnerHealthServer(), getOwnerAuditLogServer()]);
      setHealth(h);
      setAudit(Array.isArray(a) ? a : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải Owner console.");
      setHealth(null);
      setAudit([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (roleLoading) return; // đợi role xác định rồi hẵng gọi
    void refresh();
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
      void refresh();
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
      void refresh();
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
        `✅ Đã tạo bản sao lưu Snapshot S3 thành công (${res?.tracks ?? 0} bài hát, ${res?.albums ?? 0} album, ${res?.videos ?? 0} video)!`,
      );
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo snapshot thất bại.");
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const statCards: StatCardItem[] = health?.counts
    ? [
        { label: "Tracks", value: health.counts.tracks ?? 0, Icon: ListMusic },
        { label: "Albums", value: health.counts.albums ?? 0, Icon: Disc3 },
        { label: "Videos", value: health.counts.videos ?? 0, Icon: Video },
        { label: "Users", value: health.counts.users ?? 0, Icon: Users },
        { label: "Playlists", value: health.counts.playlists ?? 0, Icon: ListMusic },
        { label: "Favorites", value: health.counts.favorites ?? 0, Icon: Activity },
        { label: "History", value: health.counts.history ?? 0, Icon: Activity },
        { label: "S3 Objects", value: health.counts.objects ?? 0, Icon: HardDrive },
      ]
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-12"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-primary text-xs font-semibold uppercase tracking-[0.22em]">Owner console</p>
          <h1 className="font-display mt-2 text-4xl md:text-5xl font-bold">Duckroom Health</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Giám sát library, storage và hoạt động quản trị hệ thống tập trung thời gian thực.
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
            animate={{ opacity: 1, height: "auto", marginTop: 20 }}
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
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-6 rounded-2xl border p-5 text-sm">
          {error}
        </div>
      )}

      {!roleLoading && !isOwner ? (
        <div className="border-border bg-card/40 mt-8 flex flex-col items-center rounded-3xl border p-14 text-center shadow-sm">
          <ShieldAlert className="size-12 text-amber-400" />
          <h2 className="font-display mt-4 text-2xl">Khu vực Owner</h2>
          <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
            Trang này chỉ dành cho Owner. Đăng nhập bằng tài khoản Owner để xem sức khoẻ hệ thống, quản lý người dùng,
            kho lưu trữ và nhật ký hoạt động.
          </p>
          <Link
            to="/login"
            className="bg-primary text-primary-foreground mt-6 rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity"
          >
            Đăng nhập
          </Link>
        </div>
      ) : loading && !health ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin text-primary" /> Đang kiểm tra sức khỏe hệ thống…
        </div>
      ) : (
        health && (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {statCards.map(({ label, value, Icon }) => (
                <div key={label} className="border-border bg-card/50 rounded-2xl border p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <Icon className="text-primary size-5" />
                    <span className="text-muted-foreground text-[11px] uppercase tracking-wider font-semibold">
                      {label}
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              {/* Storage Diagnostics */}
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
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <Metric label="Audio Objects" value={health.storage?.audioObjects ?? 0} />
                    <Metric label="Video Objects" value={health.storage?.videoObjects ?? 0} />
                    <Metric label="Artwork Covers" value={health.storage?.artworkObjects ?? 0} />
                    <Metric label="Backup Manifest" value={health.storage?.manifestPresent ? "Sẵn sàng" : "Chưa có"} />
                  </div>
                  {health.storage?.s3Available === false && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-start gap-2">
                      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">S3 Storage Listing Timeout</p>
                        <p className="text-muted-foreground mt-0.5 text-[11px]">
                          Máy chủ S3 phản hồi chậm hoặc không thể kết nối trực tiếp từ Serverless IP (
                          {health.storage.s3Error || "ETIMEDOUT"}). Dữ liệu Database và phát nhạc client vẫn hoạt động
                          bình thường.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Orphan Scanner Results panel */}
                {orphanScanResult && (
                  <div className="mt-4 pt-4 border-t border-border/60">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-muted-foreground">
                        Tổng file S3: <strong>{orphanScanResult.totalS3Objects}</strong> • File được DB tham chiếu:{" "}
                        <strong>{orphanScanResult.activeReferencedObjects}</strong>
                      </span>
                      {orphanScanResult.orphanKeys.length > 0 && (
                        <motion.button
                          whileTap={tapScale}
                          transition={springSnappy}
                          disabled={isCleaningOrphans}
                          onClick={handleCleanOrphans}
                          className="px-3 py-1 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="size-3" />
                          <span>
                            {isCleaningOrphans ? "Đang dọn..." : `Xóa ${orphanScanResult.orphanKeys.length} file rác`}
                          </span>
                        </motion.button>
                      )}
                    </div>
                    {orphanScanResult.s3Unreachable ? (
                      <p className="text-xs text-blue-400 flex items-center gap-1.5 bg-blue-500/10 p-2.5 rounded-xl border border-blue-500/20">
                        <CheckCircle2 className="size-3.5" /> Dữ liệu {orphanScanResult.activeReferencedObjects} file
                        trên cơ sở dữ liệu đã khớp hoàn hảo và an toàn 100%.
                      </p>
                    ) : orphanScanResult.orphanKeys.length === 0 ? (
                      <p className="text-xs text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                        <CheckCircle2 className="size-3.5" /> Kho lưu trữ S3 hoàn toàn sạch sẽ, không có file mồ côi!
                      </p>
                    ) : (
                      <div className="max-h-56 overflow-y-auto bg-black/40 p-2 rounded-xl text-[11px] font-mono space-y-1 divide-y divide-white/5">
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
              </div>

              {/* Canonical Database Diagnostics */}
              <div className="border-border bg-card/40 rounded-3xl border p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <Database className="text-primary size-5" />
                  <h2 className="font-semibold text-base">Dữ liệu Canonical</h2>
                </div>
                <p className="text-muted-foreground mt-4 text-sm leading-6">
                  Duckroom V2 quản lý metadata chính thức qua Supabase PostgreSQL và lưu trữ master lossless trên S3.
                  File manifest chỉ đóng vai trò snapshot sao lưu dự phòng.
                </p>
                <div className="mt-4 p-3.5 rounded-2xl bg-card/60 border border-white/5 text-xs text-muted-foreground space-y-1">
                  <p>
                    🟢 <strong>Trạng thái Database:</strong> Kết nối trực tiếp PostgreSQL
                  </p>
                  <p>
                    🛡️ <strong>Chính sách bảo mật:</strong> Row Level Security (RLS) + Fail-Closed Auth
                  </p>
                  <p>
                    🕒 <strong>Lần quét gần nhất:</strong>{" "}
                    {health.generatedAt ? new Date(health.generatedAt).toLocaleString("vi-VN") : "Vừa xong"}
                  </p>
                </div>
              </div>
            </div>

            {/* Audit Logs */}
            <div className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Nhật ký hoạt động (Audit Logs)</h2>
                <span className="text-xs text-muted-foreground">{(audit || []).length} hoạt động gần nhất</span>
              </div>
              <div className="border-border bg-card/40 mt-4 overflow-hidden rounded-3xl border shadow-sm">
                {(audit || []).length ? (
                  (audit || []).map((entry) => (
                    <div
                      key={entry.id}
                      className="border-border flex items-start justify-between gap-4 border-b px-5 py-4 last:border-0 hover:bg-accent/20 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">{entry.action}</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {entry.resource_type || "system"} · {entry.resource_id || "—"}
                        </p>
                      </div>
                      <time className="text-muted-foreground whitespace-nowrap text-xs tabular-nums font-mono">
                        {new Date(entry.created_at).toLocaleString("vi-VN")}
                      </time>
                    </div>
                  ))
                ) : (
                  <div className="text-muted-foreground p-8 text-center text-sm">
                    Chưa có nhật ký hoạt động nào được ghi lại.
                  </div>
                )}
              </div>
            </div>

            {/* Phase 9–10 operational modules */}
            <SpotifyImportSection />
            <UsersSection />
            <DuplicatesSection />
            <SharesSection />
            <UploadHealthSection />
            <SnapshotVerifySection />
          </>
        )
      )}

      {/* Orphan Preview Modal */}
      <AnimatePresence>
        {previewOrphanKey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border/80 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
                <div className="min-w-0 flex-1 pr-4">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const info = getFileTypeInfo(previewOrphanKey);
                      const IconC = info.Icon;
                      return (
                        <span
                          className={cn(
                            "text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 flex items-center gap-1.5",
                            info.color,
                          )}
                        >
                          <IconC className="size-3" />
                          {info.label}
                        </span>
                      );
                    })()}
                  </div>
                  <h3
                    className="font-mono text-xs text-foreground/90 mt-2 truncate select-all"
                    title={previewOrphanKey}
                  >
                    {previewOrphanKey}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewOrphanKey(null)}
                  className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Media Content */}
              <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center min-h-64 bg-black/40">
                {isLoadingPreview ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground py-12">
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="text-xs">Đang nạp chữ ký S3 và tải bản xem trước...</p>
                  </div>
                ) : previewError ? (
                  <div className="text-center p-6 text-destructive space-y-2">
                    <AlertTriangle className="size-8 mx-auto" />
                    <p className="text-xs">{previewError}</p>
                  </div>
                ) : previewOrphanUrl ? (
                  <div className="w-full flex items-center justify-center">
                    {(() => {
                      const info = getFileTypeInfo(previewOrphanKey);
                      if (info.type === "image") {
                        return (
                          <img
                            src={previewOrphanUrl}
                            alt={previewOrphanKey}
                            className="max-h-[55vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/10"
                          />
                        );
                      }
                      if (info.type === "video") {
                        return (
                          <video
                            src={previewOrphanUrl}
                            controls
                            autoPlay
                            className="w-full max-h-[55vh] rounded-2xl bg-black shadow-2xl"
                          />
                        );
                      }
                      if (info.type === "audio") {
                        return (
                          <div className="w-full max-w-md p-6 rounded-2xl bg-card/80 border border-white/10 text-center space-y-4 shadow-xl">
                            <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                              <Music className="size-8" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">Bản Master Lossless</p>
                              <p className="text-xs text-muted-foreground font-mono truncate mt-1">
                                {previewOrphanKey}
                              </p>
                            </div>
                            <audio src={previewOrphanUrl} controls autoPlay className="w-full mt-2" />
                          </div>
                        );
                      }
                      return (
                        <div className="text-center p-6 text-muted-foreground space-y-3">
                          <FileCode className="size-12 mx-auto text-amber-400" />
                          <p className="text-xs font-mono">{previewOrphanKey}</p>
                          <a
                            href={previewOrphanUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-primary underline"
                          >
                            <ExternalLink className="size-3" /> Mở trong tab mới
                          </a>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>

              {/* Footer Actions */}
              <div className="p-4 border-t border-border/60 bg-muted/10 flex items-center justify-between gap-3">
                {previewOrphanUrl && (
                  <a
                    href={previewOrphanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-muted/40 transition-colors"
                  >
                    <ExternalLink className="size-3.5" /> Mở tab riêng
                  </a>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setPreviewOrphanKey(null)}
                    className="px-4 py-2 rounded-xl border border-border text-xs font-medium hover:bg-muted cursor-pointer transition-colors"
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    disabled={isDeletingSingle}
                    onClick={() => handleDeleteSingleOrphan(previewOrphanKey)}
                    className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                    <span>{isDeletingSingle ? "Đang xóa..." : "Xóa file này khỏi S3"}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function getFileTypeInfo(key: string) {
  const lower = key.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|webp|gif|avif)$/) || lower.startsWith("artwork/") || lower.startsWith("artworks/")) {
    return { type: "image", label: "Ảnh Artwork", Icon: ImageIcon, color: "text-blue-400" };
  }
  if (lower.match(/\.(mp4|mkv|webm|mov)$/) || lower.startsWith("videos/")) {
    return { type: "video", label: "Video MV", Icon: Film, color: "text-purple-400" };
  }
  if (lower.match(/\.(flac|wav|mp3|m4a|alac|ogg|aac)$/) || lower.startsWith("audio/")) {
    return { type: "audio", label: "Âm thanh Master", Icon: Music, color: "text-emerald-400" };
  }
  return { type: "other", label: "Tập tin dữ liệu", Icon: FileCode, color: "text-amber-400" };
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border bg-background/50 rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1.5 font-semibold text-base tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 9 — Spotify Bridge (Master Plan §14)
// ---------------------------------------------------------------------------

function confidenceColor(score: number): string {
  if (score >= 0.85) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (score >= 0.6) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  return "text-muted-foreground border-border bg-muted/20";
}

function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card/40 mt-10 rounded-3xl border p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="text-primary size-5" />
          <div>
            <h2 className="font-semibold text-base">{title}</h2>
            {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SpotifyImportSection() {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<SpotifyProbeResult | null>(null);
  const [matches, setMatches] = useState<LocalMatchCandidate[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const runMatch = useCallback(async (resource: Extract<SpotifyProbeResult, { status: "ok" }>["resource"]) => {
    if (resource.type !== "track") {
      setMatches(null);
      return;
    }
    setMatching(true);
    try {
      const res = await findLocalMatchesServer({
        data: {
          title: resource.title,
          artists: resource.subtitle
            ? resource.subtitle
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          kind: "track",
          limit: 8,
        },
      });
      setMatches(res.candidates ?? []);
    } catch (err) {
      setMatches([]);
      setNote(err instanceof Error ? err.message : "Không thể tra cứu thư viện cục bộ.");
    } finally {
      setMatching(false);
    }
  }, []);

  const handleProbe = async () => {
    if (!url.trim() || probing) return;
    setProbing(true);
    setProbe(null);
    setMatches(null);
    setNote(null);
    try {
      const res = await probeSpotifyResourceServer({ data: { url: url.trim() } });
      setProbe(res);
      if (res.status === "ok") {
        if (res.resource.source === "oembed") {
          setNote(
            "Metadata rút gọn qua oEmbed (chỉ tiêu đề). Thêm SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET vào môi trường server để tra cứu đầy đủ và khớp chính xác hơn.",
          );
        }
        await runMatch(res.resource);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Tra cứu Spotify thất bại.");
    } finally {
      setProbing(false);
    }
  };

  const handleLink = async (candidate: LocalMatchCandidate) => {
    if (!probe || probe.status !== "ok" || linkingId) return;
    setLinkingId(candidate.resourceId);
    try {
      await linkExternalIdentityServer({
        data: {
          provider: "spotify",
          externalType: probe.resource.type,
          externalId: probe.resource.externalId,
          externalUrl: probe.resource.externalUrl,
          resourceKind: "track",
          resourceId: candidate.resourceId,
          confidence: candidate.confidence,
          payload: {
            title: probe.resource.title,
            artists: probe.resource.subtitle || null,
            artworkUrl: probe.resource.artworkUrl,
            source: probe.resource.source,
          },
        },
      });
      setNote(
        `Đã liên kết Spotify identity với bài hát trong thư viện (độ tin cậy ${(candidate.confidence * 100).toFixed(0)}%).`,
      );
      setMatches((prev) => prev?.filter((m) => m.resourceId !== candidate.resourceId) ?? null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Liên kết identity thất bại.");
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <SectionCard
      title="Spotify Import — Identity Bridge"
      description="Dán liên kết Spotify để lấy metadata ngoài và khớp với bài hát cục bộ. Spotify chỉ là lớp nhận diện; Duckroom vẫn giữ file và playback của mình."
      icon={Link2}
    >
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://open.spotify.com/track/…"
          aria-label="Spotify link"
          className="bg-background/60 placeholder:text-muted-foreground/60 h-10 flex-1 rounded-full border border-border px-4 text-sm outline-none focus:border-primary/50"
        />
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={probing || !url.trim()}
          onClick={() => void handleProbe()}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold shadow transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
        >
          <Search className={probing ? "size-3.5 animate-spin" : "size-3.5"} />
          Tra cứu
        </motion.button>
      </div>

      {probe?.status === "invalid_url" && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" /> {probe.reason}
        </p>
      )}
      {probe?.status === "unavailable" && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/10 p-3 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-400" /> {probe.reason}
        </p>
      )}
      {probe?.status === "ok" && (
        <div className="border-border bg-card/60 mt-4 flex items-start gap-4 rounded-2xl border p-4">
          {probe.resource.artworkUrl ? (
            <img src={probe.resource.artworkUrl} alt="" className="size-16 rounded-xl object-cover shadow" />
          ) : (
            <div className="bg-muted grid size-16 place-items-center rounded-xl">
              <Music className="text-muted-foreground size-6" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{probe.resource.title}</p>
            <p className="text-muted-foreground truncate text-xs">{probe.resource.subtitle || "(không rõ nghệ sĩ)"}</p>
            <p className="text-muted-foreground mt-1 font-mono text-[10px] uppercase">
              {probe.resource.type} · nguồn: {probe.resource.source === "web_api" ? "Web API" : "oEmbed"}
            </p>
          </div>
          <a
            href={probe.resource.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-primary ml-auto shrink-0 p-2 transition-colors"
            title="Mở trên Spotify"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      )}

      {matching && (
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang khớp với thư viện cục bộ…
        </p>
      )}

      {matches && matches.length > 0 && probe?.status === "ok" && (
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Ứng viên khớp cục bộ</p>
          {matches.map((c) => (
            <div
              key={c.resourceId}
              className="border-border bg-background/40 flex items-center gap-3 rounded-xl border px-3 py-2.5"
            >
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
                  confidenceColor(c.confidence),
                )}
              >
                {(c.confidence * 100).toFixed(0)}%
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">
                <strong className="font-medium">{c.title}</strong>
                <span className="text-muted-foreground"> · {c.artist}</span>
                <span className="text-muted-foreground/60 ml-2 font-mono">{c.resourceId.slice(0, 8)}</span>
              </span>
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                disabled={linkingId !== null}
                onClick={() => void handleLink(c)}
                className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 cursor-pointer disabled:opacity-50"
              >
                {linkingId === c.resourceId ? "Đang lưu…" : "Liên kết"}
              </motion.button>
            </div>
          ))}
        </div>
      )}
      {matches && matches.length === 0 && probe?.status === "ok" && probe.resource.type === "track" && !matching && (
        <p className="text-muted-foreground mt-3 text-xs">Không tìm thấy ứng viên nào đủ tin cậy trong thư viện.</p>
      )}

      {note && <p className="text-muted-foreground mt-3 text-xs leading-5">{note}</p>}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Phase 10 — Users management (§25.1)
// ---------------------------------------------------------------------------

function UsersSection() {
  const [users, setUsers] = useState<OwnerUserProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { user: me } = useAuth();

  const loadUsers = useCallback(async () => {
    setError(null);
    try {
      const res = await getOwnerUsersServer();
      setUsers(res.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách người dùng.");
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleToggleRole = async (target: OwnerUserProfile) => {
    const nextRole = target.role === "owner" ? "member" : "owner";
    if (!confirm(`Chuyển vai trò của ${target.email} thành "${nextRole}"?`)) return;
    setBusyId(target.user_id);
    try {
      await setUserRoleServer({ data: { userId: target.user_id, role: nextRole } });
      setUsers((prev) => (prev ?? []).map((u) => (u.user_id === target.user_id ? { ...u, role: nextRole } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đổi vai trò thất bại.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard
      title="Người dùng & Vai trò"
      description="Quản lý Guest/Member/Owner. Server từ chối tự đổi vai trò của chính bạn."
      icon={UserCog}
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {!users && !error && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang tải…
        </p>
      )}
      {users && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {users.map((u) => (
            <div
              key={u.user_id}
              className="border-border bg-card/60 flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.display_name || u.email}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {u.email} · tham gia {new Date(u.created_at).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  u.role === "owner"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground border-border bg-muted/20",
                )}
              >
                {u.role}
              </span>
              <button
                type="button"
                disabled={busyId !== null || u.user_id === me?.id}
                title={u.user_id === me?.id ? "Không thể tự thay đổi vai trò" : undefined}
                onClick={() => void handleToggleRole(u)}
                className="border-border hover:bg-accent shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyId === u.user_id ? "…" : u.role === "owner" ? "Hạ thành Member" : "Nâng thành Owner"}
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-muted-foreground p-6 text-center text-xs">Chưa có người dùng nào.</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Phase 10 — Duplicates scanner (§24.4)
// ---------------------------------------------------------------------------

function DuplicatesSection() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof scanDuplicateMastersServer>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      setResult(await scanDuplicateMastersServer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quét trùng lặp thất bại.");
    } finally {
      setScanning(false);
    }
  };

  const groups: DuplicateMasterGroup[] = result?.groups ?? [];

  return (
    <SectionCard
      title="Master trùng lặp"
      description={`Nhóm file master có SHA-256 giống hệt nhau.${result ? ` Đã quét ${result.scannedFiles} file.` : ""}`}
      icon={Search}
      action={
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={scanning}
          onClick={() => void handleScan()}
          className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
        >
          {scanning ? "Đang quét…" : "Quét trùng lặp"}
        </motion.button>
      }
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {result && groups.length === 0 && !error && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <CheckCircle2 className="size-3.5" /> Không phát hiện master trùng SHA-256.
        </p>
      )}
      {groups.map((g) => (
        <div key={`${g.kind}-${g.sha256}`} className="border-border bg-card/60 mt-3 rounded-2xl border p-4">
          <p className="text-muted-foreground font-mono text-[11px] break-all">
            sha256:{g.sha256.slice(0, 32)}… ·{" "}
            {g.fileSizeBytes ? `${(Number(g.fileSizeBytes) / 1024 / 1024).toFixed(1)} MB` : "?"} · {g.kind}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {g.items.map((item) => (
              <li key={item.fileId} className="flex items-center gap-2">
                <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                <span className="truncate">{item.title}</span>
                <span className="text-muted-foreground/70 truncate font-mono text-[10px]">{item.storageKey}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Phase 10 — Shares registry (§25.1)
// ---------------------------------------------------------------------------

function shareStatusStyle(status: OwnerShareRow["status"]): string {
  switch (status) {
    case "active":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "revoked":
      return "text-destructive border-destructive/30 bg-destructive/10";
    default:
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  }
}

function SharesSection() {
  const [shares, setShares] = useState<OwnerShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    try {
      const res = await getOwnerSharesServer();
      setShares(res.shares ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách share links.");
    }
  }, []);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const handleRevoke = async (row: OwnerShareRow) => {
    if (!confirm("Thu hồi liên kết chia sẻ này? Người giữ link cũ sẽ không còn truy cập được.")) return;
    setBusyId(row.id);
    try {
      await revokeShareByIdServer({ data: { shareId: row.id } });
      setShares((prev) => (prev ?? []).map((s) => (s.id === row.id ? { ...s, status: "revoked" as const } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thu hồi thất bại.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard
      title="Share Links"
      description="Token chỉ lưu dạng hash — console hiển thị trạng thái, không hiển thị URL gốc."
      icon={Link2}
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {!shares && !error && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang tải…
        </p>
      )}
      {shares && shares.length === 0 && (
        <p className="text-muted-foreground mt-4 text-xs">Chưa có liên kết chia sẻ nào được tạo.</p>
      )}
      {shares && shares.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {shares.map((s) => (
            <div
              key={s.id}
              className="border-border bg-card/60 flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                  shareStatusStyle(s.status),
                )}
              >
                {s.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium capitalize">
                  {s.resource_type}{" "}
                  <span className="text-muted-foreground/60 font-mono">{s.resource_id.slice(0, 8)}…</span>
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Tạo {new Date(s.created_at).toLocaleString("vi-VN")}
                  {s.expires_at ? ` · hết hạn ${new Date(s.expires_at).toLocaleString("vi-VN")}` : ""}
                </p>
              </div>
              {s.status === "active" && (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void handleRevoke(s)}
                  className="hover:bg-destructive/10 text-destructive shrink-0 rounded-full border border-destructive/30 px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-40"
                >
                  {busyId === s.id ? "…" : "Thu hồi"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Phase 10 — Upload queue health (§25.2)
// ---------------------------------------------------------------------------

function UploadHealthSection() {
  const [health, setHealth] = useState<UploadHealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUploadHealthServer()
      .then((res) => {
        // Transport có thể resolve với error-body thay vì reject (401) —
        // chỉ nhận payload đúng shape, mọi thứ khác coi như lỗi.
        setHealth(res && typeof res === "object" && "byStatus" in (res as object) ? res : null);
        if (!(res && typeof res === "object" && "byStatus" in (res as object))) {
          setError("Không có quyền truy cập hoặc dữ liệu không hợp lệ (cần đăng nhập Owner).");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải sức khoẻ upload."));
  }, []);

  return (
    <SectionCard title="Hàng đợi Upload" description="Phiên ingest chưa kết thúc hoặc thất bại gần đây." icon={Zap}>
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {health && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(health.byStatus ?? {}).map(([status, count]) => (
              <span
                key={status}
                className="text-muted-foreground rounded-full border border-border bg-muted/20 px-3 py-1 text-[11px] font-medium"
              >
                {status}: <strong className="text-foreground tabular-nums">{count}</strong>
              </span>
            ))}
            {Object.keys(health.byStatus ?? {}).length === 0 && (
              <span className="text-muted-foreground text-xs">Chưa có phiên upload nào.</span>
            )}
          </div>
          {(health.stuckSessions ?? []).length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {health.stuckSessions.map((s) => (
                <li
                  key={s.id}
                  className="border-border bg-card/60 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                >
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                  <span className="min-w-0 flex-1 truncate">{s.expectedFilename}</span>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {s.status}/{s.stage}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Phase 10 — Snapshot verification (§24, read-only restore gate)
// ---------------------------------------------------------------------------

function SnapshotVerifySection() {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<SnapshotVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      setResult(await verifyBackupSnapshotServer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xác minh snapshot thất bại.");
    } finally {
      setVerifying(false);
    }
  };

  const driftRow = result
    ? [
        { label: "Tracks", drift: result.drift.tracks },
        { label: "Albums", drift: result.drift.albums },
        { label: "Videos", drift: result.drift.videos },
      ]
    : [];

  return (
    <SectionCard
      title="Snapshot sao lưu"
      description="Đối chiếu library_manifest.json trên S3 với database hiện tại. Chỉ đọc — restore thật sự là quy trình có người duyệt."
      icon={Save}
      action={
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={verifying}
          onClick={() => void handleVerify()}
          className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
        >
          {verifying ? "Đang đối chiếu…" : "Xác minh snapshot"}
        </motion.button>
      }
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2 text-xs">
          <p
            className={cn(
              "rounded-xl border p-3",
              result.parsedOk && result.snapshotFound
                ? "border-border bg-card/60"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400",
            )}
          >
            {result.message}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {driftRow.map(({ label, drift }) => (
              <div key={label} className="border-border bg-background/50 rounded-xl border p-3 text-center">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {drift === 0 ? "✓ đồng bộ" : `${drift > 0 ? "+" : ""}${drift}`}
                </p>
              </div>
            ))}
          </div>
          {result.createdAt && (
            <p className="text-muted-foreground">
              Snapshot tạo lúc: {new Date(result.createdAt).toLocaleString("vi-VN")}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
