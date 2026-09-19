import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Clock, Flame, Headphones, Music2, Play, Sparkles, TrendingUp, Volume2 } from "lucide-react";
import { useMemo } from "react";
import { albumById, type Track } from "../data/library";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { usePlayerActions, usePlayerIsCurrent, usePlayerIsPlaying } from "../lib/player";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Thống kê nghe nhạc — Duckroom" },
      {
        name: "description",
        content: "Số liệu nghe nhạc thật của bạn trên Duckroom: top nghệ sĩ, bài hát được nghe nhiều nhất.",
      },
    ],
  }),
  component: StatsPage,
});

import { aggregateStats, fmtHours, type HistoryRow } from "../lib/stats";

export type { HistoryRow };

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub: string | undefined;
  gradient?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 p-5 sm:p-6 backdrop-blur-xl shadow-lg transition-all duration-300 hover:border-white/20 hover:bg-card/75">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</span>
        <div
          className={cn(
            "grid size-9 place-items-center rounded-xl border border-white/10 shadow-inner",
            gradient || "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <p className="font-display text-2xl sm:text-3xl font-bold mt-3 tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {sub ? <p className="text-muted-foreground mt-1 text-xs truncate">{sub}</p> : null}
    </div>
  );
}

function TrackRowItem({
  track,
  plays,
  rank,
  allTopTracks,
}: {
  track: Track;
  plays: number;
  rank: number;
  allTopTracks: Track[];
}) {
  const { playQueue } = usePlayerActions();
  const isCurrent = usePlayerIsCurrent(track.id);
  const isPlaying = usePlayerIsPlaying();
  const album = albumById(track.albumId);

  const handlePlay = () => {
    const idx = allTopTracks.findIndex((t) => t.id === track.id);
    playQueue(allTopTracks, Math.max(0, idx));
  };

  return (
    <button
      type="button"
      onClick={handlePlay}
      className={cn(
        "group flex w-full items-center gap-3.5 rounded-2xl border p-2.5 sm:p-3 text-left transition-all cursor-pointer",
        isCurrent
          ? "border-primary/40 bg-primary/10 shadow-sm"
          : "border-white/5 bg-card/40 hover:border-white/15 hover:bg-card/70",
      )}
    >
      {/* Rank */}
      <span
        className={cn(
          "w-6 text-center text-xs font-bold tabular-nums shrink-0",
          rank === 1
            ? "text-amber-400"
            : rank === 2
              ? "text-slate-300"
              : rank === 3
                ? "text-amber-600"
                : "text-muted-foreground",
        )}
      >
        {rank <= 3 ? (rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉") : `#${rank}`}
      </span>

      {/* Artwork with play button overlay */}
      <div className="relative size-11 sm:size-12 rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0">
        <img
          src={album?.cover || "/og-image.jpg"}
          alt={track.title}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div
          className={cn(
            "absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity",
            isCurrent && isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {isCurrent && isPlaying ? (
            <Volume2 className="size-5 text-primary animate-pulse" />
          ) : (
            <Play className="size-4 text-white fill-white ml-0.5" />
          )}
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-semibold transition-colors",
            isCurrent ? "text-primary" : "text-foreground group-hover:text-primary",
          )}
        >
          {track.title}
        </p>
        <p className="text-muted-foreground truncate text-xs mt-0.5">
          {track.artist}
          {album ? ` · ${album.title}` : ""}
        </p>
      </div>

      {/* Plays pill */}
      <div className="shrink-0 flex items-center gap-2">
        <span className="rounded-full bg-primary/15 border border-primary/20 px-2.5 py-1 text-xs font-bold tabular-nums text-primary">
          {plays}×
        </span>
      </div>
    </button>
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
        <div className="grid size-16 place-items-center rounded-3xl bg-primary/10 text-primary mx-auto mb-4 border border-primary/20 shadow-lg">
          <BarChart3 className="size-8" />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Thống kê nghe nhạc</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-md mx-auto">
          Đăng nhập để xem số liệu nghe nhạc thật của bạn trên Duckroom: nghệ sĩ hàng đầu, thời gian nghe và bài hát
          được phát nhiều nhất.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
        >
          Đăng nhập để xem thống kê
        </Link>
      </div>
    );
  }

  const topTrackObjects = stats.topTracks.map((t) => t.track);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Executive Header */}
      <div className="pb-8">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary mb-3">
          <Sparkles className="size-3.5" />
          <span>Duckroom Replay</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Thống kê</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Tổng hợp từ <strong className="text-foreground font-semibold">{stats.totalPlays}</strong> lượt nghe thật trong
          lịch sử tài khoản của bạn.
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatCard
          icon={Headphones}
          label="Tổng thời gian"
          value={fmtHours(stats.totalSeconds)}
          sub={`${stats.totalPlays} lần phát`}
          gradient="bg-blue-500/15 text-blue-400 border-blue-500/20"
        />
        <StatCard
          icon={TrendingUp}
          label="Tỷ lệ hoàn thành"
          value={`${stats.totalPlays ? Math.round((stats.completedPlays / stats.totalPlays) * 100) : 0}%`}
          sub={`${stats.completedPlays} bài nghe hết`}
          gradient="bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
        />
        <StatCard
          icon={Flame}
          label="Nghệ sĩ số 1"
          value={stats.topArtists[0]?.artist ?? "—"}
          sub={stats.topArtists[0] ? `${fmtHours(stats.topArtists[0].seconds)} nghe` : undefined}
          gradient="bg-amber-500/15 text-amber-400 border-amber-500/20"
        />
        <StatCard
          icon={Music2}
          label="Bài nghe nhiều nhất"
          value={String(stats.topTracks[0]?.plays ?? 0) + " lần"}
          sub={stats.topTracks[0]?.track.title}
          gradient="bg-purple-500/15 text-purple-400 border-purple-500/20"
        />
      </div>

      {/* Top Artists - Normalized with Badges & Modern Progress */}
      {stats.topArtists.length > 0 && (
        <section className="mt-12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">Nghệ sĩ nghe nhiều nhất</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Đã chuẩn hoá nghệ sĩ chính, tự động gộp các bản hợp tác & featuring.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-card/50 p-5 sm:p-6 backdrop-blur-xl shadow-xl space-y-4">
            {stats.topArtists.map((a, i) => {
              const rank = i + 1;
              const percent = Math.max(6, (a.seconds / maxArtistSeconds) * 100);

              return (
                <div key={a.artist} className="flex items-center gap-3.5 sm:gap-4">
                  {/* Rank Badge */}
                  <div className="shrink-0 w-8 text-center">
                    {rank === 1 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/30 text-base shadow-sm">
                        🥇
                      </span>
                    ) : rank === 2 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-slate-400/20 border border-slate-400/30 text-base shadow-sm">
                        🥈
                      </span>
                    ) : rank === 3 ? (
                      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-amber-700/20 border border-amber-700/30 text-base shadow-sm">
                        🥉
                      </span>
                    ) : (
                      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-white/5 border border-white/5 text-xs font-bold text-muted-foreground">
                        #{rank}
                      </span>
                    )}
                  </div>

                  {/* Progress Bar & Name */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">{a.artist}</span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        <strong className="text-foreground font-semibold">{fmtHours(a.seconds)}</strong> · {a.plays}{" "}
                        lượt
                      </span>
                    </div>

                    <div className="bg-muted/60 h-2.5 overflow-hidden rounded-full p-0.5">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700",
                          rank === 1
                            ? "bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 shadow-sm shadow-amber-500/20"
                            : rank === 2
                              ? "bg-gradient-to-r from-slate-300 via-zinc-400 to-slate-400"
                              : rank === 3
                                ? "bg-gradient-to-r from-amber-600 via-amber-700 to-yellow-600"
                                : "bg-gradient-to-r from-primary/80 to-primary",
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top Tracks with Artwork & Play Trigger */}
      {stats.topTracks.length > 0 && (
        <section className="mt-12 pb-12">
          <div className="mb-5">
            <h2 className="font-display text-2xl font-bold text-foreground">Bài hát nghe nhiều nhất</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Nhấn trực tiếp vào bài hát để bắt đầu nghe lại.</p>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {stats.topTracks.map((t, i) => (
              <TrackRowItem
                key={t.track.id}
                track={t.track}
                plays={t.plays}
                rank={i + 1}
                allTopTracks={topTrackObjects}
              />
            ))}
          </div>
        </section>
      )}

      {stats.totalPlays === 0 && (
        <div className="rounded-3xl border border-white/5 bg-card/40 p-12 text-center text-muted-foreground text-sm backdrop-blur-sm mt-8">
          Chưa có lịch sử nghe nhạc nào — hãy thưởng thức bài hát đầu tiên rồi quay lại đây nhé!
        </div>
      )}
    </div>
  );
}
