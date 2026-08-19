import { createFileRoute } from "@tanstack/react-router";
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
  Loader2,
  ListMusic,
  Music,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  cleanupOrphanS3ObjectsServer,
  createBackupSnapshotServer,
  getOwnerAuditLogServer,
  getOwnerHealthServer,
  scanOrphanS3ObjectsServer,
} from "../lib/owner-data";
import { getOrphanPreviewUrlServer } from "../lib/s3-functions";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";

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

  const refresh = async () => {
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
    void refresh();
  }, []);

  const handleScanOrphans = async () => {
    setIsScanningOrphans(true);
    setError(null);
    try {
      const res = await scanOrphanS3ObjectsServer();
      setOrphanScanResult(res);
      setActionSuccess(`Đã quét xong: Tìm thấy ${res?.orphanKeys?.length ?? 0} file mồ côi trên S3.`);
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
      className="mx-auto max-w-7xl px-6 py-12"
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

      {loading && !health ? (
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
                    {orphanScanResult.orphanKeys.length === 0 ? (
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
  if (lower.match(/\.(jpg|jpeg|png|webp|gif|avif)$/) || lower.startsWith("artworks/")) {
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
