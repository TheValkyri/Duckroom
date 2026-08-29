import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Disc,
  Disc3,
  Edit,
  Grid,
  List,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { EditTrackModal } from "../components/EditTrackModal";
import { TrackRow } from "../components/TrackRow";
import { deleteTrack, syncLibraryWithS3, type Track } from "../data/library";
import {
  listContainerVariants,
  listItemVariants,
  springGentle,
  springPill,
  springSnappy,
  tapScale,
  tweenBase,
} from "../lib/motion";
import { usePlayer } from "../lib/player";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/singles")({
  head: () => ({
    meta: [
      { title: "Đĩa đơn & Single — Duckroom" },
      {
        name: "description",
        content: "Toàn bộ các bản phát hành đĩa đơn (Single & EP) Lossless 24-bit trong kho Duckroom.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Đĩa đơn & Single — Duckroom" },
      {
        property: "og:description",
        content: "Toàn bộ các bản phát hành đĩa đơn (Single & EP) Lossless 24-bit trong kho Duckroom.",
      },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: SinglesPage,
});

function SingleCard({
  track,
  onPlay,
  onEdit,
  onDelete,
}: {
  track: Track;
  onPlay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { isLoggedIn } = useAuth();
  const { current, isPlaying } = usePlayer();
  const isCurrentTrack = current?.id === track.id;
  const isThisPlaying = isCurrentTrack && isPlaying;
  const [hover, setHover] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const fallbackCover = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80";

  const validCover = track.cover && !track.cover.startsWith("blob:") ? track.cover : fallbackCover;

  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={springSnappy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative group flex flex-col"
    >
      {/* Member Actions — rendered OUTSIDE the overflow-hidden cover container to guarantee clickability */}
      {isLoggedIn && (
        <div
          className="absolute top-5.5 right-5.5 z-50 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ pointerEvents: "auto" }}
        >
          <motion.button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit();
            }}
            whileTap={tapScale}
            transition={springSnappy}
            title="Chỉnh sửa thông tin bài hát / LRC"
            className="size-8 rounded-full bg-black/80 hover:bg-primary text-white hover:text-black border border-white/20 flex items-center justify-center transition-colors cursor-pointer shadow-lg"
          >
            <Edit className="size-4" />
          </motion.button>
          <motion.button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            whileTap={tapScale}
            transition={springSnappy}
            title="Xóa đĩa đơn này"
            className="size-8 rounded-full bg-black/80 hover:bg-destructive text-white border border-white/20 flex items-center justify-center transition-colors cursor-pointer shadow-lg"
          >
            <Trash2 className="size-4" />
          </motion.button>
        </div>
      )}

      {/* Vinyl Disc & Cover Assembly */}
      <div className="relative aspect-square w-full rounded-2xl bg-card/60 p-3 border border-white/5 shadow-xl transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-2xl overflow-hidden">
        {/* Sliding Vinyl Record on Hover */}
        <motion.div
          animate={{
            x: hover ? 32 : 0,
            rotate: isThisPlaying ? 360 : hover ? 45 : 0,
          }}
          transition={{
            x: { type: "spring", stiffness: 260, damping: 24 },
            rotate: isThisPlaying ? { repeat: Infinity, duration: 3.5, ease: "linear" } : { duration: 0.5 },
          }}
          className="absolute inset-y-4 right-4 aspect-square rounded-full bg-zinc-950 border border-white/10 shadow-2xl pointer-events-none flex items-center justify-center z-0"
          style={{
            backgroundImage: "repeating-radial-gradient(circle, #18181b 0, #18181b 2px, #09090b 3px, #09090b 5px)",
          }}
        >
          <div className="size-10 rounded-full border border-white/20 bg-card/90 flex items-center justify-center">
            <div className="size-3 rounded-full bg-zinc-900 border border-white/30" />
          </div>
        </motion.div>

        {/* Front Cover Artwork */}
        <div className="relative z-10 size-full overflow-hidden rounded-xl bg-card/60 shadow-md">
          {!imgLoaded && (
            <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          )}
          <img
            src={validCover}
            alt={track.title}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== fallbackCover) {
                target.src = fallbackCover;
              }
              setImgLoaded(true);
            }}
            className={cn(
              "size-full object-cover transition-all duration-500 group-hover:scale-105",
              imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
            )}
          />

          {/* Audio Quality Badge */}
          <div className="absolute top-2.5 left-2.5 z-20">
            <span className="bg-black/70 backdrop-blur-md border border-white/15 text-primary text-[10px] font-mono px-2 py-0.5 rounded-md tracking-wider font-semibold shadow-sm">
              {track.format
                ? track.bitDepth && track.sampleRate
                  ? `${track.format} ${track.bitDepth}/${track.sampleRate > 1000 ? Math.round(track.sampleRate / 1000) : track.sampleRate}`
                  : track.format
                : "LOSSLESS"}
            </span>
          </div>

          {/* Quick Play Overlay Button */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2 z-20 pointer-events-none">
            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              title={isThisPlaying ? "Tạm dừng" : "Phát đĩa đơn"}
              whileTap={tapScale}
              whileHover={{ scale: 1.1 }}
              transition={springSnappy}
              className="size-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg cursor-pointer pointer-events-auto"
            >
              {isThisPlaying ? (
                <Pause className="size-5" fill="currentColor" />
              ) : (
                <Play className="size-5 ml-0.5" fill="currentColor" />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Meta details */}
      <div className="mt-3.5 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3
            onClick={onPlay}
            className={cn(
              "font-display text-base font-semibold truncate cursor-pointer transition-colors hover:text-primary flex-1",
              isCurrentTrack ? "text-primary" : "text-foreground",
            )}
          >
            {track.title}
          </h3>
          {isLoggedIn && (
            <motion.button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit();
              }}
              whileTap={tapScale}
              transition={springSnappy}
              title="Sửa bài hát & lời LRC"
              className="text-muted-foreground hover:text-primary p-1 rounded-md transition-colors cursor-pointer shrink-0"
            >
              <Edit className="size-3.5" />
            </motion.button>
          )}
        </div>
        <p className="text-muted-foreground text-xs truncate mt-0.5">{track.artist}</p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/70 mt-1.5 font-mono">
          <span>{track.year ? `${track.year} · Single` : "Single"}</span>
          <span>{track.sizeMB ? `${track.sizeMB} MB` : ""}</span>
        </div>
      </div>
    </motion.div>
  );
}

function SinglesPage() {
  const { playQueue } = usePlayer();
  const { tracks } = useLibrary();
  const { isLoggedIn } = useAuth();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Singles are defined as tracks where albumId === 'singles' or track has no album
  const singles = useMemo(
    () =>
      tracks.filter(
        (t) => !t.albumId || t.albumId === "singles" || t.albumId === "single-collection" || t.albumId === "single",
      ),
    [tracks],
  );

  const filteredSingles = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase();
    if (!qLower) return singles;
    return singles.filter((t) => t.title.toLowerCase().includes(qLower) || t.artist.toLowerCase().includes(qLower));
  }, [singles, searchQuery]);

  const totalSizeMB = useMemo(() => singles.reduce((acc, t) => acc + (t.sizeMB || 0), 0), [singles]);

  const handleSyncS3 = async () => {
    if (!isLoggedIn) return;
    setIsSyncing(true);
    try {
      await syncLibraryWithS3(true);
    } catch (err) {
      console.warn("[Duckroom Singles] Sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = useCallback(
    (id: string) => {
      if (!isLoggedIn) return;
      if (confirm("Bạn có chắc muốn xóa đĩa đơn này khỏi kho nhạc không?")) {
        void deleteTrack(id);
      }
    },
    [isLoggedIn],
  );

  const handlePlayTrack = useCallback(
    (_: Track, idx: number) => {
      playQueue(filteredSingles, idx);
    },
    [playQueue, filteredSingles],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary mb-2">
            <Disc className="size-4" />
            <span>Phát hành riêng lẻ</span>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Đĩa đơn & Single
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {singles.length} đĩa đơn · {(totalSizeMB / 1024).toFixed(2)} GB · Bản thu Master 24-bit không nén
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {singles.length > 0 && (
            <>
              <motion.button
                onClick={() => playQueue(singles, 0, false)}
                whileTap={tapScale}
                whileHover={{ y: -1 }}
                transition={springSnappy}
                className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold shadow-md cursor-pointer"
              >
                <Play className="size-3.5" fill="currentColor" /> Phát tất cả
              </motion.button>
              <motion.button
                onClick={() => playQueue(singles, 0, true)}
                whileTap={tapScale}
                whileHover={{ y: -1 }}
                transition={springSnappy}
                className="border-border bg-card/60 hover:bg-accent text-foreground inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer"
              >
                <Shuffle className="size-3.5 text-primary" /> Trộn bài
              </motion.button>
            </>
          )}

          {isLoggedIn && (
            <motion.button
              onClick={handleSyncS3}
              disabled={isSyncing}
              whileTap={tapScale}
              transition={springSnappy}
              title="Đồng bộ lại kho tệp tin trên S3"
              className="border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground inline-flex items-center gap-2 rounded-full border px-3.5 py-2.5 text-xs transition-colors cursor-pointer"
            >
              <RefreshCw className={cn("size-3.5", isSyncing && "animate-spin")} />
              <span className="hidden sm:inline">{isSyncing ? "Đang quét..." : "Đồng bộ S3"}</span>
            </motion.button>
          )}

          <Link
            to="/upload"
            className="border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer"
          >
            <Plus className="size-3.5" /> Đăng Đĩa đơn
          </Link>
        </div>
      </div>

      {/* Filter and View Mode Switcher */}
      {singles.length > 0 && (
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm đĩa đơn, nghệ sĩ..."
              className="w-full bg-card/70 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl pl-9.5 pr-8 py-2 text-sm outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 self-end sm:self-auto bg-card/80 border border-border/80 p-1 rounded-xl">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "relative p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 overflow-hidden",
                viewMode === "grid" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
              title="Chế độ lưới đĩa than"
            >
              {viewMode === "grid" && (
                <motion.span
                  layoutId="singles-view-pill"
                  transition={springPill}
                  className="absolute inset-0 rounded-lg bg-accent shadow-sm"
                />
              )}
              <Grid className="size-4 relative z-10" />
              <span className="hidden sm:inline relative z-10">Lưới</span>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "relative p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 overflow-hidden",
                viewMode === "list" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
              title="Chế độ danh sách"
            >
              {viewMode === "list" && (
                <motion.span
                  layoutId="singles-view-pill"
                  transition={springPill}
                  className="absolute inset-0 rounded-lg bg-accent shadow-sm"
                />
              )}
              <List className="size-4 relative z-10" />
              <span className="hidden sm:inline relative z-10">Danh sách</span>
            </button>
          </div>
        </div>
      )}

      {/* Singles Content Area */}
      <div className="mt-8">
        {filteredSingles.length > 0 ? (
          <AnimatePresence mode="wait" initial={false}>
            {viewMode === "grid" ? (
              <motion.div
                key="grid"
                variants={listContainerVariants}
                initial="hidden"
                animate="show"
                exit="hidden"
                className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
              >
                <AnimatePresence initial={false}>
                  {filteredSingles.map((track, i) => (
                    <motion.div key={track.id} layout variants={listItemVariants}>
                      <SingleCard
                        track={track}
                        onPlay={() => {
                          const idx = filteredSingles.findIndex((t) => t.id === track.id);
                          playQueue(filteredSingles, idx >= 0 ? idx : 0);
                        }}
                        onEdit={() => setEditingTrack(track)}
                        onDelete={() => handleDelete(track.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="list"
                variants={listContainerVariants}
                initial="hidden"
                animate="show"
                exit="hidden"
                className="space-y-1 bg-card/20 border border-white/5 rounded-2xl p-3"
              >
                <AnimatePresence initial={false}>
                  {filteredSingles.map((track, i) => (
                    <motion.div key={track.id} layout variants={listItemVariants}>
                      <TrackRow
                        track={track}
                        n={i + 1}
                        index={i}
                        onPlayTrack={handlePlayTrack}
                        onDeleteTrack={handleDelete}
                        extraActions={
                          <motion.button
                            onClick={() => setEditingTrack(track)}
                            whileTap={tapScale}
                            transition={springSnappy}
                            title="Sửa thông tin / Lời bài hát"
                            className="text-muted-foreground hover:text-primary p-1.5 transition-colors cursor-pointer"
                          >
                            <Edit className="size-3.5" />
                          </motion.button>
                        }
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        ) : singles.length === 0 ? (
          /* Empty State */
          <div className="border-border bg-card/30 mt-6 flex flex-col items-center gap-4 rounded-2xl border border-dashed p-16 text-center">
            <div className="size-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Disc3 className="size-8 animate-spin-slow" />
            </div>
            <h3 className="font-display text-2xl font-semibold">Chưa có Đĩa đơn nào</h3>
            <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
              Bạn có thể đăng tải các bài hát phát hành đơn lẻ (Singles) mà không cần tạo Album. Mỗi bài Single sẽ có
              ảnh bìa Artwork và tệp lời LRC riêng biệt.
            </p>
            <motion.div whileTap={tapScale} transition={springSnappy}>
              <Link
                to="/upload"
                className="bg-primary text-primary-foreground mt-2 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold shadow-lg cursor-pointer"
              >
                <UploadCloud className="size-4" /> Đăng Đĩa đơn đầu tiên
              </Link>
            </motion.div>
          </div>
        ) : (
          <p className="text-muted-foreground py-16 text-center text-sm">
            Không tìm thấy đĩa đơn nào phù hợp với từ khóa "{searchQuery}".
          </p>
        )}
      </div>

      {/* Edit Track / Lyrics Modal */}
      <AnimatePresence>
        {editingTrack && (
          <EditTrackModal
            track={editingTrack}
            onClose={() => setEditingTrack(null)}
            onUpdated={() => setEditingTrack(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
