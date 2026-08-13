import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ListPlus, Play, Shuffle, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { TrackRow } from "../components/TrackRow";
import {
  addTracksToAlbum,
  albumById,
  albumTracks,
  deleteAlbum,
  deleteTrack,
  formatTime,
  removeTrackFromAlbum,
  tracks,
} from "../data/library";
import { usePlayer } from "../lib/player";

import { syncLibraryWithS3 } from "../data/library";

export const Route = createFileRoute("/albums/$albumId")({
  loader: ({ params }) => {
    const album = albumById(params.albumId);
    return { album, albumId: params.albumId };
  },
  head: ({ loaderData }) => {
    const t = loaderData?.album?.title ?? "Album";
    return {
      meta: [
        { title: `${t} — Duckroom Lossless` },
        { name: "description", content: `Nghe album ${t} ở chất lượng gốc, không nén lại.` },
        { property: "og:title", content: `${t} — Duckroom Lossless` },
        { property: "og:description", content: `Nghe album ${t} ở chất lượng gốc.` },
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
  const available = tracks.filter((t) => !currentTrackIds.has(t.id));
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl">Thêm bài hát vào album</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-5" />
          </button>
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
              <button
                onClick={onClose}
                className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent"
              >
                Huỷ
              </button>
              <button
                onClick={handleAdd}
                disabled={selected.size === 0}
                className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Thêm {selected.size > 0 ? `(${selected.size})` : ""} bài
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

import { useLibrary } from "../lib/useLibrary";

import { useAuth } from "../lib/useAuth";

function AlbumPage() {
  const { album: loadedAlbum, albumId: paramAlbumId } = Route.useLoaderData();
  const { tracks, albums } = useLibrary();
  const { playQueue } = usePlayer();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [showAddTracks, setShowAddTracks] = useState(false);
  const [imgError, setImgError] = useState(false);

  const album = loadedAlbum || albumById(paramAlbumId);
  if (!album) {
    throw notFound();
  }

  const refresh = () => setTick((t) => t + 1);
  const list = albumTracks(album.id);
  const total = list.reduce((a, t) => a + t.duration, 0);
  const currentIds = new Set(list.map((t) => t.id));

  const handleDeleteAlbum = () => {
    if (!isLoggedIn) return;
    if (confirm(`Xóa album "${album.title}"? Các bài hát sẽ chuyển về Single Collection.`)) {
      deleteAlbum(album.id);
      void navigate({ to: "/albums" });
    }
  };

  const handleRemoveFromAlbum = (trackId: string) => {
    if (!isLoggedIn) return;
    removeTrackFromAlbum(trackId);
    refresh();
  };

  const handleDeleteTrack = async (trackId: string) => {
    if (!isLoggedIn) return;
    await deleteTrack(trackId);
    refresh();
  };

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-40 transition-all duration-700 ease-in-out"
        style={{ background: `linear-gradient(180deg, ${album.accent} 0%, transparent 100%)` }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-14">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-8">
          <Link
            to="/albums"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" /> Tất cả Album
          </Link>
          {isLoggedIn && (
            <button
              onClick={handleDeleteAlbum}
              className="text-muted-foreground hover:text-destructive border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
            >
              <Trash2 className="size-3.5" />
              <span>Xóa Album</span>
            </button>
          )}
        </div>

        {/* Album Hero */}
        <div className="flex flex-col gap-8 md:flex-row md:items-end">
          <div className="w-56 md:w-72 aspect-square rounded-lg overflow-hidden shadow-[0_30px_80px_-30px_oklch(0_0_0/0.9)] flex-shrink-0 bg-muted">
            {!imgError ? (
              <img
                src={album.cover}
                alt={`Bìa album ${album.title}`}
                width={320}
                height={320}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="size-20 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
                </svg>
              </div>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-xs tracking-[0.3em] uppercase">Album</p>
            <h1 className="font-display mt-2 text-6xl leading-none">{album.title}</h1>
            <p className="text-muted-foreground mt-4 text-sm">
              {album.artist} · {album.year} · {list.length} bài · {formatTime(total)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{album.note}</p>
            <div className="mt-6 flex gap-3 flex-wrap">
              <button
                onClick={() => list.length > 0 && playQueue(list, 0, false)}
                disabled={list.length === 0}
                className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="size-4" fill="currentColor" /> Phát
              </button>
              <button
                onClick={() => list.length > 0 && playQueue(list, 0, true)}
                disabled={list.length === 0}
                className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Shuffle className="size-4" /> Trộn bài
              </button>
              {isLoggedIn && (
                <button
                  onClick={() => setShowAddTracks(true)}
                  className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors cursor-pointer"
                >
                  <ListPlus className="size-4" /> Thêm bài hát
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Track list */}
        <div className="mt-12">
          {list.length === 0 ? (
            <div className="border-border bg-card/30 flex flex-col items-center gap-3 rounded-xl border p-12 text-center">
              <p className="text-muted-foreground text-sm">Album này chưa có bài hát nào.</p>
              {isLoggedIn && (
                <button
                  onClick={() => setShowAddTracks(true)}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-transform hover:scale-105"
                >
                  <ListPlus className="size-4" /> Thêm bài hát vào album
                </button>
              )}
            </div>
          ) : (
            list.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                n={i + 1}
                showAlbum={false}
                onPlay={() => playQueue(list, i, false)}
                onDelete={() => handleDeleteTrack(t.id)}
                extraActions={
                  <button
                    onClick={() => handleRemoveFromAlbum(t.id)}
                    title="Gỡ khỏi album (giữ lại bài hát)"
                    className="text-muted-foreground hover:text-foreground transition-colors p-1.5"
                    aria-label="Gỡ khỏi album"
                  >
                    <X className="size-3.5" />
                  </button>
                }
              />
            ))
          )}
        </div>
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
    </div>
  );
}