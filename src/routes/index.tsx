import { createFileRoute, Link } from "@tanstack/react-router";
import { Disc, Disc3, Music2, Pause, Pencil, Play, Shuffle, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { AlbumCard } from "../components/AlbumCard";
import { EditAlbumModal } from "../components/EditAlbumModal";
import { TrackRow } from "../components/TrackRow";
import { Visualizer } from "../components/Visualizer";
import { VideoThumb } from "../components/VideoThumb";
import { albumTracks, type Album, type Track } from "../data/library";
import { listContainerVariants, listItemVariants, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { usePlayer } from "../lib/player";
import { useLibrary } from "../lib/useLibrary";
import { useAuth } from "../lib/useAuth";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Duckroom — Kho nhạc lossless riêng" },
      {
        name: "description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Duckroom — Kho nhạc lossless riêng" },
      {
        property: "og:description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "675" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: Index,
});

function SingleMiniCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const { current, isPlaying } = usePlayer();
  const isCurrentTrack = current?.id === track.id;
  const isThisPlaying = isCurrentTrack && isPlaying;
  const [hover, setHover] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <motion.div
      variants={listItemVariants}
      whileHover={{ y: -4 }}
      transition={springSnappy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group flex flex-col relative"
    >
      <div className="relative aspect-square w-full rounded-2xl bg-card/60 p-2.5 border border-white/5 shadow-md group-hover:border-primary/30 group-hover:shadow-xl transition-all duration-300 overflow-hidden">
        {/* Sliding Vinyl */}
        <motion.div
          animate={{
            x: hover ? 24 : 0,
            rotate: isThisPlaying ? 360 : hover ? 45 : 0,
          }}
          transition={{
            x: { type: "spring", stiffness: 260, damping: 24 },
            rotate: isThisPlaying ? { repeat: Infinity, duration: 3.5, ease: "linear" } : { duration: 0.5 },
          }}
          className="absolute inset-y-3 right-3 aspect-square rounded-full bg-zinc-950 border border-white/10 shadow-xl pointer-events-none flex items-center justify-center z-0"
          style={{
            backgroundImage: "repeating-radial-gradient(circle, #18181b 0, #18181b 2px, #09090b 3px, #09090b 5px)",
          }}
        >
          <div className="size-8 rounded-full border border-white/20 bg-card/90 flex items-center justify-center">
            <div className="size-2.5 rounded-full bg-zinc-900 border border-white/30" />
          </div>
        </motion.div>

        {/* Cover */}
        <div className="relative z-10 size-full overflow-hidden rounded-xl bg-card/60 shadow-sm">
          {!imgLoaded && (
            <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          )}
          <img
            src={
              track.cover && !track.cover.startsWith("blob:")
                ? track.cover
                : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E"
            }
            alt={track.title}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              const target = e.currentTarget;
              const fallback =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";
              if (target.src !== fallback) {
                target.src = fallback;
              }
              setImgLoaded(true);
            }}
            className={cn(
              "size-full object-cover transition-all duration-500 group-hover:scale-105",
              imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
            )}
          />

          <div className="absolute top-2 left-2 z-20">
            <span className="bg-black/75 backdrop-blur-md border border-white/15 text-primary text-[9px] font-mono px-1.5 py-0.5 rounded tracking-wider font-semibold shadow-sm">
              {track.format
                ? track.bitDepth && track.sampleRate
                  ? `${track.format} ${track.bitDepth}/${track.sampleRate > 1000 ? Math.round(track.sampleRate / 1000) : track.sampleRate}`
                  : track.format
                : "LOSSLESS"}
            </span>
          </div>

          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center z-20">
            <button
              onClick={onPlay}
              aria-label={isThisPlaying ? "Tạm dừng" : "Phát"}
              className="size-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transform transition-transform hover:scale-110 active:scale-95 cursor-pointer"
            >
              {isThisPlaying ? (
                <Pause className="size-4" fill="currentColor" />
              ) : (
                <Play className="size-4 ml-0.5" fill="currentColor" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col">
        <h4
          onClick={onPlay}
          className={cn(
            "font-display text-sm font-semibold truncate cursor-pointer transition-colors hover:text-primary",
            isCurrentTrack ? "text-primary" : "text-foreground",
          )}
        >
          {track.title}
        </h4>
        <p className="text-muted-foreground text-xs truncate mt-0.5">{track.artist}</p>
      </div>
    </motion.div>
  );
}

function Index() {
  const { playQueue, isPlaying } = usePlayer();
  const { tracks, albums, videos } = useLibrary();
  const { isLoggedIn } = useAuth();
  const member = useMemberLibraryContext();
  const [editingHeroAlbum, setEditingHeroAlbum] = useState<Album | null>(null);

  const hero = albums[0];
  const heroTracks = useMemo(() => (hero ? albumTracks(hero.id) : []), [hero]);

  /* QoL A3: "Nghe gần đây" THẬT thay vì tracks.slice(0,5) giả.
   * - Member: playbackHistory từ server (mới nhất trước) → map ra Track,
   *   dedupe theo id (một bài nghe 10 lần chỉ xuất 1 lần ở vị trí gần nhất).
   * - Guest: fallback đúng hành vi cũ (thứ tự library) — không có session
   *   recents riêng cho guest theo Master Plan §1.3 (guest không persist).
   * - Luôn cắt 5 và chỉ hiển thị section khi CÓ dữ liệu thật. */
  const recent = useMemo(() => {
    const history = member.history;
    if (isLoggedIn && history?.length) {
      const seen = new Set<string>();
      const out: Track[] = [];
      for (const h of history) {
        if (!h?.track_id || seen.has(h.track_id)) continue;
        const t = tracks.find((x) => x.id === h.track_id);
        if (t) {
          seen.add(t.id);
          out.push(t);
        }
        if (out.length >= 5) break;
      }
      if (out.length) return out;
    }
    return tracks.slice(0, 5);
  }, [isLoggedIn, member.history, tracks]);

  const singles = useMemo(
    () =>
      tracks.filter(
        (t) => !t.albumId || t.albumId === "singles" || t.albumId === "single-collection" || t.albumId === "single",
      ),
    [tracks],
  );
  const featuredSingles = useMemo(() => singles.slice(0, 5), [singles]);

  const handlePlayRecentTrack = useCallback(
    (_: Track, idx: number) => {
      playQueue(recent, idx);
    },
    [playQueue, recent],
  );

  if (!hero || albums.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-20">
        <section className="grain border-border relative overflow-hidden rounded-2xl border bg-card/60 p-6 sm:p-10 md:p-16">
          <div className="max-w-2xl">
            <span className="text-xs tracking-[0.35em] uppercase font-semibold">
              <span className="text-primary">Duck</span>
              <span className="text-foreground">room</span>
            </span>
            <h1 className="font-display mt-4 text-3xl leading-[1.05] sm:text-5xl md:text-6xl">
              Kho nhạc của bạn đã sẵn sàng
            </h1>
            <p className="text-muted-foreground mt-4 text-sm md:text-base leading-relaxed">
              Duckroom đã được dọn sạch tất cả dữ liệu mẫu. Hãy đưa các bản thu FLAC 24-bit, WAV hoặc MV bản gốc của bạn
              vào kho lưu trữ cá nhân ngay bây giờ.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/upload"
                className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03]"
              >
                <UploadCloud className="size-4" /> Tải lên nhạc & MV gốc
              </Link>
              <Link
                to="/library"
                className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors"
              >
                <Music2 className="size-4" /> Xem thư viện
              </Link>
            </div>
          </div>
        </section>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: "Hi-Res FLAC & WAV",
              desc: "Giữ nguyên 24-bit / 96kHz – 192kHz không qua bất kỳ bước transcode nén lại nào.",
              icon: Disc3,
            },
            {
              title: "Đĩa đơn & Albums",
              desc: "Phân loại linh hoạt giữa Album đầy đủ và các bản phát hành Đĩa đơn độc lập.",
              icon: Disc,
            },
            {
              title: "Lời Bài Hát Đồng Bộ",
              desc: "Tự động cuộn lời bài hát chính xác theo thời gian thực chuẩn Apple Music.",
              icon: Music2,
            },
          ].map((item, i) => (
            <div key={i} className="border-border bg-card/40 rounded-xl border p-6">
              <item.icon className="text-primary size-6 mb-3" />
              <h3 className="font-display text-xl mb-1">{item.title}</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Hero Featured Album */}
      <section className="grain relative overflow-hidden">
        <img
          key={hero.cover}
          src={
            hero.cover ||
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E"
          }
          alt=""
          aria-hidden
          decoding="async"
          onError={(e) => {
            const target = e.currentTarget;
            const fallback =
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";
            if (target.src !== fallback) {
              target.src = fallback;
            }
          }}
          className="absolute inset-0 size-full scale-110 object-cover opacity-25 blur-3xl transition-opacity duration-700 ease-in-out animate-fade-in"
        />
        <div className="from-background relative inset-0 bg-gradient-to-t via-transparent to-transparent" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16 md:flex-row md:items-end md:gap-10 md:py-24">
          <img
            src={
              hero.cover ||
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E"
            }
            alt={`Bìa album ${hero.title}`}
            decoding="async"
            onError={(e) => {
              const target = e.currentTarget;
              const fallback =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";
              if (target.src !== fallback) {
                target.src = fallback;
              }
            }}
            width={512}
            height={512}
            className="aspect-square w-40 rounded-xl object-cover shadow-[0_40px_100px_-30px_oklch(0_0_0/0.9)] sm:w-52 md:w-80"
          />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <p className="text-primary text-xs tracking-[0.35em] uppercase font-semibold">Album Nổi Bật</p>
              {isLoggedIn && hero && (
                <motion.button
                  whileTap={tapScale}
                  transition={springSnappy}
                  onClick={() => setEditingHeroAlbum(hero)}
                  title="Chỉnh sửa Album nổi bật"
                  className="text-muted-foreground hover:text-primary transition-colors cursor-pointer p-1 rounded-md"
                >
                  <Pencil className="size-3.5" />
                </motion.button>
              )}
            </div>
            <h1 className="font-display mt-3 text-4xl leading-[0.95] sm:text-5xl md:text-7xl">{hero.title}</h1>
            <p className="text-muted-foreground mt-3 max-w-md text-sm sm:mt-4">
              {hero.note || `${hero.artist} · ${hero.year}`}
            </p>
            <Visualizer playing={isPlaying} bars={36} height={40} className="mt-4 hidden max-w-sm sm:block sm:mt-6" />
            <div className="mt-5 flex flex-wrap gap-3 sm:mt-6">
              <button
                onClick={() => playQueue(heroTracks, 0, false)}
                className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03] cursor-pointer shadow-md"
              >
                <Play className="size-4" fill="currentColor" /> Phát album
              </button>
              <button
                onClick={() => playQueue(tracks, 0, true)}
                className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors cursor-pointer"
              >
                <Shuffle className="size-4" /> Trộn toàn bộ kho
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Albums Section */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        <SectionHead title="Albums" to="/albums" />
        <motion.div
          variants={listContainerVariants}
          initial="hidden"
          animate="show"
          className="mt-6 grid grid-cols-2 gap-4 sm:gap-8 md:grid-cols-3 sm:mt-8"
        >
          {albums.map((a) => (
            <motion.div key={a.id} variants={listItemVariants}>
              <AlbumCard album={a} />
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Singles Section (If available) */}
      {featuredSingles.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-10 sm:pb-14">
          <SectionHead title="Đĩa đơn & Single" to="/singles" badge={`${singles.length} bài`} />
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="show"
            className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 sm:mt-8"
          >
            {featuredSingles.map((track) => (
              <SingleMiniCard
                key={track.id}
                track={track}
                onPlay={() => {
                  const idx = singles.findIndex((t) => t.id === track.id);
                  playQueue(singles, idx >= 0 ? idx : 0);
                }}
              />
            ))}
          </motion.div>
        </section>
      )}

      {/* Recent Tracks Section */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-10 sm:pb-14">
        <SectionHead title="Nghe gần đây" to="/library" />
        <motion.div variants={listContainerVariants} initial="hidden" animate="show" className="mt-6 sm:mt-6">
          {recent.map((t, i) => (
            <motion.div key={t.id} variants={listItemVariants}>
              <TrackRow track={t} n={i + 1} index={i} onPlayTrack={handlePlayRecentTrack} />
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Videos Section */}
      {videos.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-24">
          <SectionHead title="MV Bản Gốc" to="/videos" />
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="show"
            className="mt-6 grid gap-4 sm:gap-8 md:grid-cols-2 sm:mt-8"
          >
            {videos.map((v) => (
              <motion.div key={v.id} variants={listItemVariants}>
                <Link to="/videos/$videoId" params={{ videoId: v.id }} className="group block">
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-card/60">
                    <VideoThumb
                      src={v.src || undefined}
                      thumb={v.thumb || undefined}
                      alt={`Ảnh nền MV ${v.title}`}
                      className="transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  </div>
                  <h3 className="font-display mt-3 text-xl">{v.title}</h3>
                  <p className="text-muted-foreground text-xs">
                    {v.resolution} · {v.codec}
                  </p>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      <AnimatePresence>
        {editingHeroAlbum && (
          <EditAlbumModal
            album={editingHeroAlbum}
            onClose={() => setEditingHeroAlbum(null)}
            onUpdated={() => setEditingHeroAlbum(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHead({
  title,
  to,
  badge,
}: {
  title: string;
  to: "/albums" | "/library" | "/videos" | "/singles";
  badge?: string;
}) {
  return (
    <div className="border-border flex items-baseline justify-between gap-2 border-b pb-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
        {badge && (
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {badge}
          </span>
        )}
      </div>
      <Link to={to} className="text-muted-foreground hover:text-primary shrink-0 text-xs font-medium transition-colors">
        Xem tất cả →
      </Link>
    </div>
  );
}
