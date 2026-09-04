import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Clock, Disc3, Flame, Headphones, Music2, Sparkles, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { albumById, type Track } from "../data/library";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Thống kê — Duckroom" },
      { name: "description", content: "Số liệu nghe nhạc thật của bạn trên Duckroom: nghệ sĩ, album, định dạng." },
    ],
  }),
  component: StatsPage,
});

type HistoryRow = {
  id: number;
  track_id: string;
  started_at: string;
  ended_at: string | null;
  seconds_played: number;
  completed: boolean;
};

/** Tổng hợp thuần từ playback_history (dữ liệu THẬT đã ghi khi hết bài —
 *  không fake số). Tất cả tính bằng 1 lượt quét O(N). */
function aggregateStats(history: HistoryRow[], tracks: Track[]) {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const byArtistSeconds = new Map<string, number>();
  const byArtistPlays = new Map<string, number>();
  const byTrackPlays = new Map<string, number>();
  const byFormatSeconds = new Map<string, number>();
  let totalSeconds = 0;
  let totalPlays = 0;
  let completedPlays = 0;

  for (const h of history) {
    const t = trackById.get(h.track_id);
    if (!t) continue; // track đã bị xóa khỏi library — không đếm ảo.
    const secs = Math.max(0, Math.min(h.seconds_played || 0, 24 * 3600));
    totalSeconds += secs;
    totalPlays++;
    if (h.completed) completedPlays++;

    const artist = t.artist || "Không rõ";
    byArtistSeconds.set(artist, (byArtistSeconds.get(artist) ?? 0) + secs);
    byArtistPlays.set(artist, (byArtistPlays.get(artist) ?? 0) + 1);
    byTrackPlays.set(t.id, (byTrackPlays.get(t.id) ?? 0) + 1);
    const fmt = t.format && t.format !== "UNKNOWN" ? t.format : "Khác";
    byFormatSeconds.set(fmt, (byFormatSeconds.get(fmt) ?? 0) + secs);
  }

  const topArtists = [...byArtistSeconds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([artist, seconds]) => ({
      artist,
      seconds,
      plays: byArtistPlays.get(artist) ?? 0,
    }));

  const topTracks = [...byTrackPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, plays]) => ({ track: trackById.get(id), plays }))
    .filter((x): x is { track: Track; plays: number } => Boolean(x.track));

  const formatBreakdown = [...byFormatSeconds.entries()].sort((a, b) => b[1] - a[1]);

  return {
    totalSeconds,
    totalPlays,
    completedPlays,
    topArtists,
    topTracks,
    formatBreakdown,
  };
}

function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub: string | undefined;
}) {
  return (
    <div className="bg-card/60 edge-shadow-b rounded-2xl p-5">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
        <Icon className="text-primary size-4" />
        {label}
      </div>
      <p className="font-display text-3xl font-bold mt-2 tabular-nums">{value}</p>
      {sub ? <p className="text-muted-foreground mt-1 text-xs">{sub}</p> : null}
    </div>
  );
}

function StatsPage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { tracks } = useLibrary();
  const member = useMemberLibraryContext();

  const stats = useMemo(() => aggregateStats(member.history ?? [], tracks), [member.history, tracks]);

  const maxArtistSeconds = stats.topArtists[0]?.seconds ?? 1;

  if (authLoading) return null;

  if (!isLoggedIn) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24 text-center">
        <BarChart3 className="text-primary mx-auto size-12" />
        <h1 className="font-display mt-4 text-3xl font-bold">Thống kê nghe nhạc</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Đăng nhập để xem số liệu thật của bạn: nghệ sĩ nghe nhiều nhất, tổng thời gian, tỷ lệ FLAC lossless — mọi con
          số tính từ lịch sử phát thật của tài khoản.
        </p>
        <Link
          to="/login"
          className="bg-primary text-primary-foreground mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03]"
        >
          Đăng nhập để xem thống kê
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-12">
      <div className="pb-6">
        <div className="text-primary flex items-center gap-2 text-xs font-semibold uppercase tracking-widest mb-2">
          <Sparkles className="size-4" />
          <span>Duckroom của bạn</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">Thống kê</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Tính từ {stats.totalPlays} lần phát thật trong lịch sử của bạn — không phóng đại, không làm tròn đẹp.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatCard
          icon={Headphones}
          label="Tổng thời gian"
          value={fmtHours(stats.totalSeconds)}
          sub={`${stats.totalPlays} lần phát`}
        />
        <StatCard
          icon={TrendingUp}
          label="Hoàn thành"
          value={`${stats.totalPlays ? Math.round((stats.completedPlays / stats.totalPlays) * 100) : 0}%`}
          sub={`${stats.completedPlays} bài nghe hết`}
        />
        <StatCard
          icon={Flame}
          label="Nghệ sĩ top"
          value={stats.topArtists[0]?.artist ?? "—"}
          sub={stats.topArtists[0] ? fmtHours(stats.topArtists[0].seconds) : undefined}
        />
        <StatCard
          icon={Music2}
          label="Bài nghe nhiều nhất"
          value={String(stats.topTracks[0]?.plays ?? 0)}
          sub={stats.topTracks[0]?.track.title}
        />
      </div>

      {/* Top nghệ sĩ — thanh ngang theo tỷ lệ thật */}
      {stats.topArtists.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl font-bold">Nghệ sĩ nghe nhiều nhất</h2>
          <div className="mt-5 space-y-3">
            {stats.topArtists.map((a, i) => (
              <div key={a.artist} className="flex items-center gap-3">
                <span className="text-muted-foreground w-6 shrink-0 text-right text-sm tabular-nums font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{a.artist}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {fmtHours(a.seconds)} · {a.plays} lần
                    </span>
                  </div>
                  <div className="bg-muted mt-1.5 h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${Math.max(4, (a.seconds / maxArtistSeconds) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Bài nghe nhiều nhất */}
      {stats.topTracks.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl font-bold">Bài nghe nhiều nhất</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {stats.topTracks.map((t, i) => {
              const album = albumById(t.track.albumId);
              return (
                <div key={t.track.id} className="bg-card/60 flex items-center gap-3 rounded-2xl p-3">
                  <span className="text-muted-foreground w-5 text-center text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.track.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {t.track.artist}
                      {album ? ` · ${album.title}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-primary shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums",
                    )}
                  >
                    {t.plays}×
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Format breakdown — "lossless-first" cần bằng chứng */}
      {stats.formatBreakdown.length > 0 && (
        <section className="mt-10 pb-8">
          <h2 className="font-display flex items-center gap-2 text-2xl font-bold">
            <Disc3 className="size-5" />
            Chất lượng nghe
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Thời gian nghe thật theo định dạng file gốc (không transcode).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.formatBreakdown.map(([fmt, secs]) => (
              <div key={fmt} className="bg-card/60 flex items-baseline gap-2 rounded-full px-4 py-2 text-sm">
                <span className="font-semibold">{fmt}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{fmtHours(secs)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.totalPlays === 0 && (
        <div className="text-muted-foreground mt-12 text-center text-sm">
          Chưa có lịch sử phát nào — nghe bài đầu tiên rồi quay lại đây nhé.
        </div>
      )}
    </div>
  );
}
