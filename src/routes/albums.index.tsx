import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Disc3, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { albumTracks, albums, createAlbum, deleteAlbum, type Album } from "../data/library";
import { usePlayer } from "../lib/player";
import { Play } from "lucide-react";

export const Route = createFileRoute("/albums/")({
  head: () => ({
    meta: [
      { title: "Albums — Duckroom Lossless" },
      { name: "description", content: "Tất cả album trong kho lưu trữ Duckroom, master nguyên gốc." },
      { property: "og:title", content: "Albums — Duckroom Lossless" },
      { property: "og:description", content: "Tất cả album trong kho lưu trữ Duckroom, master nguyên gốc." },
    ],
  }),
  component: AlbumsPage,
});

import { useAuth } from "../lib/useAuth";

function AlbumCard({ album, onDelete, onPlay }: { album: Album; onDelete: () => void; onPlay: () => void }) {
  const [imgError, setImgError] = useState(false);
  const [hover, setHover] = useState(false);
  const { isLoggedIn } = useAuth();

  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative group"
    >
      {/* Delete button - Only for logged in members */}
      <AnimatePresence>
        {isLoggedIn && hover && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Xóa album "${album.title}"? Các bài hát sẽ chuyển về Single Collection.`)) {
                onDelete();
              }
            }}
            className="absolute -top-2 -right-2 z-10 bg-destructive text-white rounded-full p-1.5 shadow-lg hover:scale-110 transition-transform cursor-pointer"
            aria-label="Xóa album"
          >
            <Trash2 className="size-3" />
          </motion.button>
        )}
      </AnimatePresence>

      <Link to="/albums/$albumId" params={{ albumId: album.id }} className="block">
        <div className="relative overflow-hidden rounded-lg">
          {!imgError ? (
            <img
              src={album.cover}
              alt={`Bìa album ${album.title}`}
              loading="lazy"
              width={512}
              height={512}
              className="aspect-square w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="aspect-square w-full bg-card flex items-center justify-center">
              <Disc3 className="size-16 text-muted-foreground" />
            </div>
          )}
          <div className="from-background/90 absolute inset-0 bg-gradient-to-t to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <button
            onClick={(e) => { e.preventDefault(); onPlay(); }}
            aria-label={`Phát ${album.title}`}
            className="bg-primary text-primary-foreground absolute right-3 bottom-3 grid size-11 translate-y-3 place-items-center rounded-full opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
          >
            <Play className="size-4 translate-x-px" fill="currentColor" />
          </button>
        </div>
        <h3 className="font-display mt-3 text-lg leading-tight">{album.title}</h3>
        <p className="text-muted-foreground text-xs">
          {album.year} · {albumTracks(album.id).length} bài
        </p>
      </Link>
    </motion.div>
  );
}

function CreateAlbumModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [coverUrl, setCoverUrl] = useState("");
  const [coverPreviewError, setCoverPreviewError] = useState(false);
  const [note, setNote] = useState("");
  const navigate = useNavigate();

  const previewSrc = coverUrl.trim() || "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const album = createAlbum({
      title,
      artist,
      year: parseInt(year) || new Date().getFullYear(),
      cover: coverUrl.trim() || undefined,
      note,
    });
    onCreated();
    onClose();
    void navigate({ to: "/albums/$albumId", params: { albumId: album.id } });
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
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-2xl">Tạo Album mới</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Cover preview */}
          <div className="flex justify-center">
            <div className="relative size-32 rounded-lg overflow-hidden bg-muted">
              {!coverPreviewError ? (
                <img
                  src={previewSrc}
                  alt="Xem trước ảnh bìa"
                  className="w-full h-full object-cover"
                  onError={() => setCoverPreviewError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Disc3 className="size-12 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">URL Ảnh bìa Album</label>
            <input
              type="url"
              placeholder="https://... (để trống dùng ảnh mặc định)"
              value={coverUrl}
              onChange={(e) => { setCoverUrl(e.target.value); setCoverPreviewError(false); }}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tên Album *</label>
            <input
              required
              type="text"
              placeholder="Nhập tên album..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nghệ sĩ</label>
              <input
                type="text"
                placeholder="Tên nghệ sĩ..."
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Năm phát hành</label>
              <input
                type="number"
                placeholder={new Date().getFullYear().toString()}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min={1900}
                max={2099}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Ghi chú (tuỳ chọn)</label>
            <input
              type="text"
              placeholder="Mô tả ngắn về album..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Tạo Album
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

import { useLibrary } from "../lib/useLibrary";

function AlbumsPage() {
  const { playQueue } = usePlayer();
  const { albums, refresh } = useLibrary();
  const { isLoggedIn } = useAuth();
  const [showCreate, setShowCreate] = useState(false);

  const handleDelete = (id: string) => {
    if (!isLoggedIn) return;
    deleteAlbum(id);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-5xl">Albums</h1>
          <p className="text-muted-foreground mt-2 text-sm">{albums.length} album đã lưu trữ</p>
        </div>
        {isLoggedIn && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-transform hover:scale-105 cursor-pointer"
          >
            <Plus className="size-4" />
            Tạo Album
          </button>
        )}
      </div>

      {albums.length > 0 ? (
        <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-3">
          {albums.map((a) => (
            <AlbumCard
              key={a.id}
              album={a}
              onDelete={() => handleDelete(a.id)}
              onPlay={() => playQueue(albumTracks(a.id), 0)}
            />
          ))}
        </div>
      ) : (
        <div className="border-border bg-card/30 mt-10 flex flex-col items-center gap-4 rounded-xl border p-16 text-center">
          <Disc3 className="text-muted-foreground size-12" />
          <h3 className="font-display text-2xl">Chưa có album nào</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            Bạn có thể tạo album mới và thêm bài hát vào, hoặc tải lên bài hát mới.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreate(true)}
              className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition-transform hover:scale-105"
            >
              <Plus className="size-4" /> Tạo Album
            </button>
            <Link
              to="/upload"
              className="border-border inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-sm transition-colors hover:bg-accent"
            >
              <UploadCloud className="size-4" /> Tải lên bài hát
            </Link>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateAlbumModal
            onClose={() => setShowCreate(false)}
            onCreated={refresh}
          />
        )}
      </AnimatePresence>
    </div>
  );
}