import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Disc3, ListPlus, Pencil, Play, Shuffle, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import { EditAlbumModal } from "../components/EditAlbumModal";
import {
  addTracksToAlbum,
  albumById,
  albumTracks,
  deleteAlbum,
  deleteTrack,
  formatTime,
  removeTrackFromAlbum,
  syncLibraryWithS3,
  type Track,
} from "../data/library";
import {
  listContainerVariants,
  listItemVariants,
  modalOverlayVariants,
  modalPanelVariants,
  springSmooth,
  springSnappy,
  tapScale,
  tweenBase,
} from "../lib/motion";
import { useAuth } from "../lib/useAuth";
import { ShareMenu } from "../components/ShareMenu";
import { useLibrary } from "../lib/useLibrary";
import { usePlayer } from "../lib/player";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/albums/$albumId")({
  loader: ({ params }) => {
    const album = albumById(params.albumId);
    return { album, albumId: params.albumId };
  },
  head: ({ loaderData }) => {
    const t = loaderData?.album?.title ?? "Album";
    const cover = loaderData?.album?.cover || "https://duckroom.vercel.app/og-image.jpg";
    return {
      meta: [
        { title: `${t} — Duckroom` },
        { name: "description", content: `Nghe album ${t} ở chất lượng gốc, không nén lại.` },
        { property: "og:site_name", content: "Duckroom" },
        { property: "og:title", content: `${t} — Duckroom` },
        { property: "og:description", content: `Nghe album ${t} ở chất lượng gốc.` },
        { property: "og:image", content: cover },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: cover },
      ],
    };
  },
  component: AlbumPage,
});

function AddTracksModal({
  albumId,
  currentTrackIds,
  onClose,
  onAdded,
}: {
  albumId: string;
  currentTrackIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { tracks: libraryTracks } = useLibrary();
  const available = useMemo(
    () => libraryTracks.filter((t) => !currentTrackIds.has(t.id)),
    [libraryTracks, currentTrackIds],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (selected.size === 0) return;
    addTracksToAlbum(albumId, [...selected]);
    onAdded();
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        variants={modalPanelVariants}
        initial="hidden"
        animate="show"
        exit="exit"
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl">Thêm bài hát vào album</h2>
          <motion.button
            onClick={onClose}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-5" />
          </motion.button>
        </div>

        {available.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">Tất cả bài hát đã nằm trong album này rồi!</p>
            <Link to="/upload" className="text-primary text-sm mt-3 inline-flex items-center gap-1 hover:underline">
              Tải lên bài hát mới
            </Link>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-xs mb-3">Chọn bài hát để thêm vào album:</p>
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {available.map((track) => (
                <label
                  key={track.id}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors select-none ${
                    selected.has(track.id)
                      ? "bg-primary/15 border border-primary/40"
                      : "hover:bg-muted/60 border border-transparent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(track.id)}
                    onChange={() => toggle(track.id)}
                    className="accent-primary size-4"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{track.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatTime(track.duration)}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-4 pt-4 border-t border-border">
              <motion.button
                onClick={onClose}
                whileTap={tapScale}
                transition={springSnappy}
                className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent"
              >
                Huỷ
              </motion.button>
              <motion.button
                onClick={handleAdd}
                disabled={selected.size === 0}
                whileTap={tapScale}
                transition={springSnappy}
                className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Thêm {selected.size > 0 ? `(${selected.size})` : ""} bài
              </motion.button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function AlbumPage() {
  const { album: loadedAlbum, albumId: paramAlbumId } = Route.useLoaderData();
  const { tracks, albums, refresh } = useLibrary();
  const { playQueue } = usePlayer();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const album = loadedAlbum || albumById(paramAlbumId);
  if (!album) {
    throw notFound();
  }

  const list = albumTracks(album.id);
  const total = list.reduce((a, t) => a + t.duration, 0);
  const currentIds = new Set(list.map((t) => t.id));

  const handleDeleteAlbum = useCallback(async () => {
    if (!isLoggedIn) return;
    if (confirm(`Chuyển album "${album.title}" vào thùng rác?`)) {
      await deleteAlbum(album.id);
      void navigate({ to: "/albums" });
    }
  }, [isLoggedIn, album.title, album.id, navigate]);

  const handleRemoveFromAlbum = useCallback(
    async (trackId: string) => {
      if (!isLoggedIn) return;
      await removeTrackFromAlbum(trackId);
      refresh();
    },
    [isLoggedIn, refresh],
  );

  const handleDeleteTrack = useCallback(
    async (trackId: string) => {
      if (!isLoggedIn) return;
      await deleteTrack(trackId);
      refresh();
    },
    [isLoggedIn, refresh],
  );

  const handlePlayTrack = useCallback(
    (_: Track, idx: number) => {
      playQueue(list, idx, false);
    },
    [playQueue, list],
  );

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-40 transition-all duration-1000 ease-out"
        style={{ background: `linear-gradient(180deg, ${album.accent} 0%, transparent 100%)` }}
      />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-8">
          <Link
            to="/albums"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" /> Tất cả Album
          </Link>
          {isLoggedIn && (
            <div className="flex items-center gap-2.5">
              <motion.button
                onClick={() => setShowEditModal(true)}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground hover:text-foreground border-border hover:bg-accent flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
              >
                <Pencil className="size-3.5" />
                <span>Chỉnh sửa Album</span>
              </motion.button>
              <motion.button
                onClick={handleDeleteAlbum}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground hover:text-destructive border-border hover:bg-destructive/10 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa Album</span>
              </motion.button>
            </div>
          )}
        </div>

        {/* Album Hero */}
        <div className="flex flex-col items-center gap-5 md:flex-row md:items-end md:gap-8">
          <div className="w-44 sm:w-56 md:w-72 aspect-square rounded-2xl overflow-hidden shadow-[0_30px_80px_-30px_oklch(0_0_0/0.9)] flex-shrink-0 bg-card/60 relative border border-white/5">
            {!imgLoaded && !imgError && (
              <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            )}
            {!imgError ? (
              <motion.img
                layoutId={`cover-${album.id}`}
                transition={springSmooth}
                src={album.cover || undefined}
                alt={`Bìa album ${album.title}`}
                width={320}
                height={320}
                decoding="async"
                onLoad={() => setImgLoaded(true)}
                onError={() => {
                  setImgError(true);
                  setImgLoaded(true);
                }}
                className={cn(
                  "w-full h-full object-cover transition-all duration-500",
                  imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
                )}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 className="size-20 text-muted-foreground animate-spin-slow" />
              </div>
            )}
          </div>
          <div className="w-full text-center md:text-left">
            <p className="text-muted-foreground text-xs tracking-[0.3em] uppercase">Album</p>
            <div className="flex items-center justify-center gap-3 mt-2 md:justify-start">
              <h1 className="font-display text-3xl sm:text-5xl md:text-6xl leading-none">{album.title}</h1>
              {isLoggedIn && (
                <motion.button
                  onClick={() => setShowEditModal(true)}
                  whileTap={tapScale}
                  transition={springSnappy}
                  title="Chỉnh sửa Album"
                  className="text-muted-foreground hover:text-primary p-2 rounded-full border border-border/80 hover:border-primary/40 bg-card/60 transition-colors cursor-pointer shrink-0"
                >
                  <Pencil className="size-4" />
                </motion.button>
              )}
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              {album.artist} · {album.year} · {list.length} bài · {formatTime(total)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{album.note}</p>
            <div className="mt-5 flex w-full justify-center gap-3 flex-wrap md:mt-6 md:justify-start md:flex-nowrap">
              <motion.button
                onClick={() => list.length > 0 && playQueue(list, 0, false)}
                disabled={list.length === 0}
                whileTap={tapScale}
                whileHover={{ y: -1 }}
                transition={springSnappy}
                className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Play className="size-4" fill="currentColor" /> Phát
              </motion.button>
              <motion.button
                onClick={() => list.length > 0 && playQueue(list, 0, true)}
                disabled={list.length === 0}
                whileTap={tapScale}
                whileHover={{ y: -1 }}
                transition={springSnappy}
                className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Shuffle className="size-4" /> Trộn bài
              </motion.button>
              <ShareMenu resourceType="album" resourceId={album.id} title={album.title} />
              {isLoggedIn && (
                <motion.button
                  onClick={() => setShowAddTracks(true)}
                  whileTap={tapScale}
                  whileHover={{ y: -1 }}
                  transition={springSnappy}
                  className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors cursor-pointer"
                >
                  <ListPlus className="size-4" /> Thêm bài hát
                </motion.button>
              )}
            </div>
          </div>
        </div>

        {/* Track list with smooth stagger */}
        <motion.div variants={listContainerVariants} initial="hidden" animate="show" className="mt-12 space-y-1">
          {list.length === 0 ? (
            <div className="border-border bg-card/30 flex flex-col items-center gap-3 rounded-xl border p-12 text-center">
              <p className="text-muted-foreground text-sm">Album này chưa có bài hát nào.</p>
              {isLoggedIn && (
                <motion.button
                  onClick={() => setShowAddTracks(true)}
                  whileTap={tapScale}
                  transition={springSnappy}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium cursor-pointer"
                >
                  <ListPlus className="size-4" /> Thêm bài hát vào album
                </motion.button>
              )}
            </div>
          ) : (
            list.map((t, i) => (
              <motion.div key={t.id} variants={listItemVariants}>
                <TrackRow
                  track={t}
                  n={i + 1}
                  index={i}
                  showAlbum={false}
                  onPlayTrack={handlePlayTrack}
                  onDelete={() => handleDeleteTrack(t.id)}
                  extraActions={
                    <motion.button
                      onClick={() => handleRemoveFromAlbum(t.id)}
                      whileTap={tapScale}
                      transition={springSnappy}
                      title="Gỡ khỏi album (giữ lại bài hát)"
                      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 cursor-pointer"
                      aria-label="Gỡ khỏi album"
                    >
                      <X className="size-3.5" />
                    </motion.button>
                  }
                />
              </motion.div>
            ))
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {showAddTracks && (
          <AddTracksModal
            albumId={album.id}
            currentTrackIds={currentIds}
            onClose={() => setShowAddTracks(false)}
            onAdded={refresh}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEditModal && <EditAlbumModal album={album} onClose={() => setShowEditModal(false)} onUpdated={refresh} />}
      </AnimatePresence>
    </div>
  );
}
