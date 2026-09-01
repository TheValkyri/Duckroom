import { Disc3, Image as ImageIcon, Loader2, Scissors, Trash2, UploadCloud, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { updateAlbum, type Album } from "../data/library";
import { fetchAlbumArtworkUrl } from "../lib/s3";
import { ArtworkCropModal } from "./ArtworkCropModal";
import { compressAndResizeImageFile, cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import { modalOverlayVariants, modalPanelVariants, springSnappy, tapScale } from "../lib/motion";
import { requestPresignedUploadUrlServer } from "../lib/s3-functions";
import { useAuth } from "../lib/useAuth";
import { cn } from "../lib/utils";

interface EditAlbumModalProps {
  album: Album;
  onClose: () => void;
  onUpdated?: (updatedAlbum: Album) => void;
}

export function EditAlbumModal({ album, onClose, onUpdated }: EditAlbumModalProps) {
  const { isLoggedIn, isLoading } = useAuth();
  const [title, setTitle] = useState(album.title);
  const [artist, setArtist] = useState(album.artist);
  const [year, setYear] = useState(album.year ? album.year.toString() : new Date().getFullYear().toString());
  const [note, setNote] = useState(album.note || "");
  const [coverUrl, setCoverUrl] = useState("");
  const [artworkFile, setArtworkFile] = useState<File | null>(null);

  const isAlbumCoverValid =
    album.cover &&
    (album.cover.startsWith("http://") ||
      album.cover.startsWith("https://") ||
      album.cover.startsWith("data:") ||
      album.cover.startsWith("blob:"));

  const [artworkPreview, setArtworkPreview] = useState<string | null>(isAlbumCoverValid ? album.cover : null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [coverPreviewError, setCoverPreviewError] = useState(false);

  useEffect(() => {
    if (!artworkPreview && album.id && !isAlbumCoverValid) {
      let isMounted = true;
      fetchAlbumArtworkUrl(album.id).then((url) => {
        if (isMounted && url && (url.startsWith("http://") || url.startsWith("https://"))) {
          setArtworkPreview(url);
        }
      });
      return () => {
        isMounted = false;
      };
    }
    // Cleanup rỗng cho path còn lại — mọi code path return (fix TS7030).
    return undefined;
  }, [album.id, artworkPreview, isAlbumCoverValid]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      onClose();
    }
  }, [isLoading, isLoggedIn, onClose]);

  if (isLoading || !isLoggedIn) {
    return null;
  }

  const previewSrc =
    artworkPreview ||
    (coverUrl.trim().startsWith("http") ? coverUrl.trim() : null) ||
    (isAlbumCoverValid ? album.cover : null) ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSaving) return;

    if (!isLoggedIn) {
      setErrorMsg("Bạn cần đăng nhập tài khoản thành viên để chỉnh sửa album.");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");

    try {
      let finalCover = album.cover;

      // If user uploaded a new artwork image, send directly to Pikamc S3
      if (artworkFile) {
        setUploadStatus("Đang tải ảnh bìa lên Pikamc S3...");
        const artExt = artworkFile.name.split(".").pop() || "jpg";
        const cleanName = title.trim().replace(/[\\/:*?"<>|]+/g, "-") || "album";
        const artKey = `artwork/album-${Date.now()}-${cleanName}.${artExt}`;
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
          throw new Error(`S3 Error HTTP ${putRes.status}: Tải lên ảnh bìa thất bại.`);
        }

        finalCover = artKey;
      } else if (coverUrl.trim()) {
        finalCover = coverUrl.trim();
      }

      setUploadStatus("Đang cập nhật thông tin album...");
      const updated = await updateAlbum(album.id, {
        expectedVersion: album.version,
        title: title.trim(),
        artist: artist.trim() || "Nghệ sĩ",
        year: parseInt(year, 10) || new Date().getFullYear(),
        cover: finalCover,
        note: note.trim(),
      });

      if (updated) {
        onUpdated?.(updated);
      }
      onClose();
    } catch (err: any) {
      console.error("Edit album upload error:", err);
      const msg = err?.message || err?.error || "Kết nối máy chủ S3 thất bại";
      setErrorMsg(`Lỗi khi cập nhật album: ${msg}`);
    } finally {
      setIsSaving(false);
      setUploadStatus("");
    }
  };

  return (
    <>
      <motion.div
        variants={modalOverlayVariants}
        initial="hidden"
        animate="show"
        exit="exit"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isSaving) onClose();
        }}
      >
        <motion.div
          variants={modalPanelVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <h2 className="font-display text-2xl font-semibold">Chỉnh sửa Album</h2>
            <button
              onClick={onClose}
              disabled={isSaving}
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

          <form onSubmit={handleSave} className="overflow-y-auto flex-1 space-y-4 py-3 pr-1">
            {/* Cover upload & preview */}
            <div className="border border-border/80 rounded-xl p-4 bg-accent/20">
              <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider block mb-2">
                Ảnh bìa Album (Lưu trữ trên Pikamc S3)
              </label>
              <div className="flex items-center gap-4">
                <div className="relative size-20 rounded-xl overflow-hidden bg-muted shrink-0 border border-white/10 shadow-md">
                  {!coverPreviewError ? (
                    <img
                      src={previewSrc}
                      alt="Xem trước ảnh bìa"
                      decoding="async"
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
                      htmlFor="edit-album-cover-upload"
                      className={cn(
                        "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer",
                        isSaving && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <ImageIcon className="size-4" />
                      <span>{artworkFile ? `Đổi ảnh (${artworkFile.name})` : "Tải ảnh mới..."}</span>
                    </label>

                    {(artworkPreview || previewSrc) && (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setShowCropModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-white/10 bg-accent hover:bg-accent/80 text-foreground transition-all cursor-pointer shadow-sm"
                      >
                        <Scissors className="size-3.5 text-primary" />
                        <span>Cắt ảnh</span>
                      </button>
                    )}
                  </div>

                  <input
                    id="edit-album-cover-upload"
                    type="file"
                    disabled={isSaving}
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      if (e.target.files && e.target.files[0]) {
                        const img = e.target.files[0];
                        setCoverPreviewError(false);
                        const croppedUrl = await cropBlackLetterbox(img);
                        const { file: compressedFile, dataUrl: compressedDataUrl } = await compressAndResizeImageFile(
                          croppedUrl.startsWith("data:") ? dataURLtoFile(croppedUrl, img.name) : img,
                        );
                        setArtworkFile(compressedFile);
                        setArtworkPreview(compressedDataUrl);
                      }
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                    {artworkFile
                      ? `Đã chọn: ${artworkFile.name} (${(artworkFile.size / 1024 / 1024).toFixed(2)} MB)`
                      : "Tải ảnh mới để tự động lưu vào S3 và đồng bộ toàn bộ thiết bị."}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Hoặc URL ảnh bìa tùy chỉnh (tùy chọn)</label>
              <input
                type="url"
                disabled={isSaving}
                placeholder="https://... (để trống nếu đã tải ảnh ở trên)"
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
                disabled={isSaving}
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
                  disabled={isSaving}
                  placeholder="MCK, Vũ..."
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Năm phát hành</label>
                <input
                  type="number"
                  disabled={isSaving}
                  placeholder="2024"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ghi chú / Mô tả</label>
              <textarea
                rows={2}
                disabled={isSaving}
                placeholder="Thông tin thêm về album, bản master, hãng đĩa..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-50"
              />
            </div>

            <div className="flex gap-3 pt-3">
              <motion.button
                type="button"
                disabled={isSaving}
                onClick={onClose}
                whileTap={tapScale}
                transition={springSnappy}
                className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
              >
                Huỷ
              </motion.button>
              <motion.button
                type="submit"
                disabled={!title.trim() || isSaving}
                whileTap={tapScale}
                transition={springSnappy}
                className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 shadow-md"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>{uploadStatus || "Đang lưu..."}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="size-4" />
                    <span>Lưu Thay Đổi</span>
                  </>
                )}
              </motion.button>
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
