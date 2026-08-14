import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Disc3, Image as ImageIcon, Loader2, Play, Plus, Scissors, Trash2, UploadCloud, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { albumTracks, albums, createAlbum, deleteAlbum, saveStoredLibrary, type Album } from "../data/library";
import { usePlayer } from "../lib/player";
import { ArtworkCropModal } from "../components/ArtworkCropModal";
import { cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import { createPresignedUrl } from "../lib/s3";
import { requestPresignedUploadUrlServer } from "../lib/s3-functions";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/albums/")({
  head: () => ({
    meta: [
      { title: "Albums — Duckroom" },
      { name: "description", content: "Tất cả album trong kho lưu trữ Duckroom, master nguyên gốc." },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Albums — Duckroom" },
      { property: "og:description", content: "Tất cả album trong kho lưu trữ Duckroom, master nguyên gốc." },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
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
      {isLoggedIn && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Xoá album ${album.title}`}
          className="absolute top-2.5 right-2.5 z-20 size-8 rounded-full bg-black/60 hover:bg-destructive text-white/80 hover:text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm shadow-md cursor-pointer"
          title="Xoá album này"
        >
          <Trash2 className="size-4" />
        </button>
      )}

      <Link
        to="/albums/$albumId"
        params={{ albumId: album.id }}
        className="block"
      >
        <div className="aspect-square w-full overflow-hidden rounded-xl bg-card relative shadow-md">
          {!imgError ? (
            <img
              src={album.cover}
              alt={`Bìa album ${album.title}`}
              loading="lazy"
              onError={() => setImgError(true)}
              className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="size-full flex items-center justify-center bg-muted">
              <Disc3 className="size-16 text-muted-foreground" />
            </div>
          )}

          {/* Quick Play Button on Hover */}
          <button
            onClick={(e) => { e.preventDefault(); onPlay(); }}
            aria-label={`Phát ${album.title}`}
            className="bg-primary text-primary-foreground absolute right-3 bottom-3 grid size-11 translate-y-3 place-items-center rounded-full opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 cursor-pointer"
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
  const { isLoggedIn } = useAuth();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [coverUrl, setCoverUrl] = useState("");
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [note, setNote] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [coverPreviewError, setCoverPreviewError] = useState(false);
  const navigate = useNavigate();

  const previewSrc =
    artworkPreview ||
    coverUrl.trim() ||
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isUploading) return;

    if (artworkFile && !isLoggedIn) {
      setErrorMsg("Bạn cần đăng nhập tài khoản thành viên để tải ảnh lên Pikamc S3.");
      return;
    }

    setIsUploading(true);
    setErrorMsg("");

    try {
      let finalCover = coverUrl.trim();

      // If user chose an artwork file, upload directly to Pikamc S3
      if (artworkFile) {
        setUploadStatus("Đang tải ảnh bìa lên Pikamc S3...");
        const artExt = artworkFile.name.split(".").pop() || "jpg";
        const cleanName = title.trim().replace(/[\\/:*?"<>|]+/g, "-") || "album";
        const artKey = `artworks/album-${Date.now()}-${cleanName}.${artExt}`;
        const artContentType = artworkFile.type || "image/jpeg";

        const res = await requestPresignedUploadUrlServer({
          data: { key: artKey, contentType: artContentType },
        });

        const uploadUrl = res?.uploadUrl;
        if (!uploadUrl) {
          throw new Error("Không nhận được URL tải lên từ máy chủ S3.");
        }

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": artContentType },
          body: artworkFile,
        });

        if (!putRes.ok) {
          throw new Error(`S3 Error HTTP ${putRes.status}`);
        }

        const newS3Url = await createPresignedUrl(artKey);
        if (newS3Url) {
          finalCover = newS3Url;
        }
      }

      setUploadStatus("Đang khởi tạo album...");
      const album = createAlbum({
        title: title.trim(),
        artist: artist.trim() || "Nghệ sĩ",
        year: parseInt(year, 10) || new Date().getFullYear(),
        cover: finalCover || undefined,
        note: note.trim(),
      });

      saveStoredLibrary(true);
      onCreated();
      onClose();
      void navigate({ to: "/albums/$albumId", params: { albumId: album.id } });
    } catch (err: any) {
      console.error("Create album upload error:", err);
      const msg = err?.message || err?.error || "Kết nối máy chủ S3 thất bại";
      setErrorMsg(`Lỗi khi tải ảnh lên S3: ${msg}`);
    } finally {
      setIsUploading(false);
      setUploadStatus("");
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isUploading) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <h2 className="font-display text-2xl">Tạo Album mới</h2>
            <button
              onClick={onClose}
              disabled={isUploading}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>

          {errorMsg && (
            <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-lg p-3 text-xs mt-3">
              {errorMsg}
            </div>
          )}

          {!isLoggedIn && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-center justify-between gap-3 mt-3">
              <span>💡 Bạn chưa đăng nhập. Để tải ảnh bìa lên Pikamc S3, vui lòng đăng nhập tài khoản.</span>
              <Link to="/login" className="underline font-semibold hover:text-white shrink-0">
                Đăng nhập
              </Link>
            </div>
          )}

          <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 space-y-4 py-3 pr-1">
            {/* Cover upload & preview */}
            <div className="border border-border/80 rounded-xl p-4 bg-accent/20">
              <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider block mb-2">
                Ảnh bìa Album (Tải lên Pikamc S3)
              </label>
              <div className="flex items-center gap-4">
                <div className="relative size-20 rounded-xl overflow-hidden bg-muted shrink-0 border border-white/10 shadow-md">
                  {!coverPreviewError ? (
                    <img
                      src={previewSrc}
                      alt="Xem trước ảnh bìa"
                      className="size-full object-cover"
                      onError={() => setCoverPreviewError(true)}
                    />
                  ) : (
                    <div className="size-full grid place-items-center">
                      <Disc3 className="size-8 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={isLoggedIn ? "album-cover-upload" : undefined}
                      onClick={() => {
                        if (!isLoggedIn) {
                          setErrorMsg("Vui lòng đăng nhập tài khoản thành viên để tải ảnh lên Pikamc S3.");
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer",
                        isUploading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <ImageIcon className="size-4" />
                      <span>{artworkFile ? `Đổi ảnh (${artworkFile.name})` : "Tải ảnh lên S3..."}</span>
                    </label>

                    {(artworkPreview || coverUrl) && (
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => setShowCropModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-white/10 bg-accent hover:bg-accent/80 text-foreground transition-all cursor-pointer shadow-sm"
                      >
                        <Scissors className="size-3.5 text-primary" />
                        <span>Cắt ảnh</span>
                      </button>
                    )}
                  </div>

                  <input
                    id="album-cover-upload"
                    type="file"
                    disabled={isUploading}
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      if (e.target.files && e.target.files[0]) {
                        const img = e.target.files[0];
                        setCoverPreviewError(false);
                        const croppedUrl = await cropBlackLetterbox(img);
                        const cleanFile = croppedUrl.startsWith("data:")
                          ? dataURLtoFile(croppedUrl, img.name)
                          : img;
                        setArtworkFile(cleanFile);
                        setArtworkPreview(croppedUrl);
                      }
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                    {artworkFile
                      ? `Đã chọn: ${artworkFile.name} (${(artworkFile.size / 1024 / 1024).toFixed(2)} MB)`
                      : "Ảnh sẽ được tự động lưu lên Pikamc S3 (/artworks/)."}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Hoặc URL ảnh bìa tùy chỉnh (tùy chọn)</label>
              <input
                type="url"
                disabled={isUploading}
                placeholder="https://... (để trống nếu đã chọn ảnh ở trên)"
                value={coverUrl}
                onChange={(e) => {
                  setCoverUrl(e.target.value);
                  setCoverPreviewError(false);
                }}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tên Album *</label>
              <input
                required
                type="text"
                disabled={isUploading}
                placeholder="Nhập tên album..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nghệ sĩ</label>
                <input
                  type="text"
                  disabled={isUploading}
                  placeholder="Tên nghệ sĩ..."
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Năm phát hành</label>
                <input
                  type="number"
                  disabled={isUploading}
                  placeholder={new Date().getFullYear().toString()}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  min={1900}
                  max={2099}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ghi chú (tuỳ chọn)</label>
              <input
                type="text"
                disabled={isUploading}
                placeholder="Mô tả ngắn về album..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>

            <div className="flex gap-3 pt-3 border-t border-border">
              <button
                type="button"
                disabled={isUploading}
                onClick={onClose}
                className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={!title.trim() || isUploading}
                className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>{uploadStatus || "Đang tải lên..."}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="size-4" />
                    <span>Tạo Album</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {showCropModal && (artworkPreview || previewSrc) && (
          <ArtworkCropModal
            imageSrc={artworkPreview || previewSrc}
            onClose={() => setShowCropModal(false)}
            onApply={(file, dataUrl) => {
              setArtworkFile(file);
              setArtworkPreview(dataUrl);
            }}
          />
        )}
      </AnimatePresence>
    </>
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