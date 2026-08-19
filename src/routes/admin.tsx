import { createFileRoute } from "@tanstack/react-router";
import { Activity, Database, Disc3, HardDrive, Loader2, ListMusic, RefreshCw, ShieldCheck, Users, Video, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { getOwnerAuditLogServer, getOwnerHealthServer } from "../lib/owner-data";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";

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
          <h1 className="font-display mt-2 text-4xl md:text-5xl">Duckroom Health</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Giám sát library, storage và hoạt động quản trị hệ thống tập trung.
          </p>
        </div>
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          onClick={() => void refresh()}
          className="border-border bg-card/60 flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-accent cursor-pointer transition-colors shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className={loading ? "size-4 animate-spin text-primary" : "size-4"} /> Làm mới
        </motion.button>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-7 rounded-2xl border p-5 text-sm">
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
              <div className="border-border bg-card/40 rounded-2xl border p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="text-emerald-400 size-5" />
                  <h2 className="font-semibold text-base">Toàn vẹn Storage S3</h2>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Audio Objects" value={health.storage.audioObjects} />
                  <Metric label="Video Objects" value={health.storage.videoObjects} />
                  <Metric label="Artwork Covers" value={health.storage.artworkObjects} />
                  <Metric label="Backup Manifest" value={health.storage.manifestPresent ? "Sẵn sàng" : "Chưa có"} />
                </div>
              </div>

              <div className="border-border bg-card/40 rounded-2xl border p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <Database className="text-primary size-5" />
                  <h2 className="font-semibold text-base">Dữ liệu Canonical</h2>
                </div>
                <p className="text-muted-foreground mt-4 text-sm leading-6">
                  Duckroom V2 quản lý metadata chính thức qua Supabase PostgreSQL và lưu trữ master lossless trên S3.
                  File manifest chỉ đóng vai trò snapshot sao lưu dự phòng.
                </p>
                <p className="text-muted-foreground mt-3 text-xs">
                  Lần quét gần nhất: {new Date(health.generatedAt).toLocaleString("vi-VN")}
                </p>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-xl font-semibold">Nhật ký hoạt động (Audit Logs)</h2>
              <div className="border-border bg-card/40 mt-4 overflow-hidden rounded-2xl border shadow-sm">
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
                      <time className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
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
    <div className="border-border bg-background/50 rounded-xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1.5 font-semibold text-base tabular-nums">{value}</p>
    </div>
  );
}
