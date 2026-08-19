import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Disc3,
  HardDrive,
  Loader2,
  ListMusic,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Video,
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
  const [orphanScanResult, setOrphanScanResult] = useState<Awaited<ReturnType<typeof scanOrphanS3ObjectsServer>> | null>(null);
  const [isCleaningOrphans, setIsCleaningOrphans] = useState(false);

  // Snapshot Backup state
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, a] = await Promise.all([getOwnerHealthServer(), getOwnerAuditLogServer()]);
      setHealth(h);
      setAudit(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải Owner console.");
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
      setActionSuccess(`Đã quét xong: Tìm thấy ${res.orphanKeys.length} file mồ côi trên S3.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quét file mồ côi thất bại.");
    } finally {
      setIsScanningOrphans(false);
    }
  };

  const handleCleanOrphans = async () => {
    if (!orphanScanResult?.orphanKeys.length) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${orphanScanResult.orphanKeys.length} file rác trên S3 không?`)) {
      return;
    }
    setIsCleaningOrphans(true);
    setError(null);
    try {
      const res = await cleanupOrphanS3ObjectsServer({ data: { keys: orphanScanResult.orphanKeys } });
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
      setActionSuccess(`✅ Đã tạo bản sao lưu Snapshot S3 thành công (${res.tracks} bài hát, ${res.albums} album)!`);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo snapshot thất bại.");
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const statCards: StatCardItem[] = health
    ? [
        { label: "Tracks", value: health.counts.tracks, Icon: ListMusic },
        { label: "Albums", value: health.counts.albums, Icon: Disc3 },
        { label: "Videos", value: health.counts.videos, Icon: Video },
        { label: "Users", value: health.counts.users, Icon: Users },
        { label: "Playlists", value: health.counts.playlists, Icon: ListMusic },
        { label: "Favorites", value: health.counts.favorites, Icon: Activity },
        { label: "History", value: health.counts.history, Icon: Activity },
        { label: "S3 Objects", value: health.counts.objects, Icon: HardDrive },
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
                    <Metric label="Audio Objects" value={health.storage.audioObjects} />
                    <Metric label="Video Objects" value={health.storage.videoObjects} />
                    <Metric label="Artwork Covers" value={health.storage.artworkObjects} />
                    <Metric label="Backup Manifest" value={health.storage.manifestPresent ? "Sẵn sàng" : "Chưa có"} />
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
                          <span>{isCleaningOrphans ? "Đang dọn..." : `Xóa ${orphanScanResult.orphanKeys.length} file rác`}</span>
                        </motion.button>
                      )}
                    </div>
                    {orphanScanResult.orphanKeys.length === 0 ? (
                      <p className="text-xs text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                        <CheckCircle2 className="size-3.5" /> Kho lưu trữ S3 hoàn toàn sạch sẽ, không có file mồ côi!
                      </p>
                    ) : (
                      <div className="max-h-28 overflow-y-auto bg-black/40 p-2 rounded-xl text-[11px] font-mono text-amber-300 space-y-1">
                        {orphanScanResult.orphanKeys.map((k) => (
                          <div key={k} className="truncate">
                            ⚠️ {k}
                          </div>
                        ))}
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
                    🕒 <strong>Lần quét gần nhất:</strong> {new Date(health.generatedAt).toLocaleString("vi-VN")}
                  </p>
                </div>
              </div>
            </div>

            {/* Audit Logs */}
            <div className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Nhật ký hoạt động (Audit Logs)</h2>
                <span className="text-xs text-muted-foreground">{audit.length} hoạt động gần nhất</span>
              </div>
              <div className="border-border bg-card/40 mt-4 overflow-hidden rounded-3xl border shadow-sm">
                {audit.length ? (
                  audit.map((entry) => (
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
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border bg-background/50 rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1.5 font-semibold text-base tabular-nums">{value}</p>
    </div>
  );
}
