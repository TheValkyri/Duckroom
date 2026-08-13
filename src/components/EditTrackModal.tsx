import { Image, Loader2, Scissors, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ArtworkCropModal } from "./ArtworkCropModal";
import { albums, saveStoredLibrary, type Track } from "../data/library";
import { cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import { parseLrc } from "../lib/upload-store";
import { createPresignedUrl, requestPresignedUploadUrlServer } from "../lib/s3";

export function EditTrackModal({
  track,
  onClose,
  onUpdated,
}: {
  track: Track;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const currentAlbum = albums.find((a) => a.id === track.albumId);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [albumName, setAlbumName] = useState(currentAlbum?.title || "");
  const [trackNo, setTrackNo] = useState(track.trackNo ? track.trackNo.toString() : "1");
  const [lyricsText, setLyricsText] = useState(
    track.lyrics ? track.lyrics.map((l) => `[${formatTimeSec(l.time)}] ${l.text}`).join("\n") : ""
  );
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(track.cover || null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  function formatTimeSec(s: number) {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}.00`;
  }

  const handleSave = async () => {
    if (!title.trim()) {
      setErrorMsg("Vui lòng nhập tên bài hát.");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");

    try {
      let finalCover = track.cover;

      // Upload new Artwork image if selected
      if (artworkFile) {
        const artExt = artworkFile.name.split(".").pop() || "jpg";
        const cleanName = title.trim().replace(/[\\/:*?"<>|]+/g, "-");
        const artKey = `artworks/edit-${Date.now()}-${cleanName}.${artExt}`;
        const artContentType = artworkFile.type || "image/jpeg";

        const { uploadUrl } = await requestPresignedUploadUrlServer({
          data: { key: artKey, contentType: artContentType },
        });

        await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": artContentType },
          body: artworkFile,
        });

        const newS3Url = await createPresignedUrl(artKey);
        if (newS3Url) finalCover = newS3Url;
      }

      // Handle Album assignment
      let targetAlbumId = "singles";
      if (albumName.trim() && albumName.trim().toLowerCase() !== "singles" && albumName.trim().toLowerCase() !== "single collection") {
        const existing = albums.find((a) => a.title.trim().toLowerCase() === albumName.trim().toLowerCase());
        if (existing) {
          targetAlbumId = existing.id;
        } else {
          targetAlbumId = albumName.trim().toLowerCase().replace(/\s+/g, "-");
          albums.push({
            id: targetAlbumId,
            title: albumName.trim(),
            artist: artist.trim() || "Nghệ sĩ",
            year: new Date().getFullYear(),
            cover: finalCover || "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80",
            accent: "oklch(0.3 0.1 260)",
            note: "Album tự tạo",
          });
        }
      }

      // Update Track Object
      track.title = title.trim();
      track.artist = artist.trim() || "Nghệ sĩ";
      track.albumId = targetAlbumId;
      track.trackNo = Math.max(1, parseInt(trackNo, 10) || 1);
      track.cover = finalCover;
      track.lyrics = parseLrc(lyricsText);

      saveStoredLibrary(true);
      onUpdated();
      onClose();
    } catch (err: any) {
      console.error("Save track edit error:", err);
      setErrorMsg(`Lỗi khi lưu thay đổi: ${err.message || "Kết nối thất bại"}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h2 className="font-display text-xl">Chỉnh sửa thông tin bài hát & Artwork</h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="size-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-lg p-3 text-xs mt-4">
            {errorMsg}
          </div>
        )}

        <div className="overflow-y-auto flex-1 space-y-4 py-4 pr-1">
          {/* Custom Artwork Upload Section */}
          <div className="border border-border/80 rounded-xl p-4 bg-accent/20">
            <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider block mb-2">
              Ảnh Artwork Bài Hát (Thay đổi trực tiếp)
            </label>
            <div className="flex items-center gap-4">
              {artworkPreview ? (
                <img
                  src={artworkPreview}
                  alt="Artwork Preview"
                  className="size-20 rounded-xl object-cover border border-white/10 shadow-md shrink-0"
                />
              ) : (
                <div className="size-20 rounded-xl bg-muted grid place-items-center shrink-0">
                  <Image className="size-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="edit-artwork-input"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer"
                  >
                    <Image className="size-4" />
                    <span>{artworkFile ? `Đã chọn: ${artworkFile.name}` : "Chọn tệp ảnh Artwork mới..."}</span>
                  </label>

                  {artworkPreview && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => setShowCropModal(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-white/10 bg-accent hover:bg-accent/80 text-foreground transition-all cursor-pointer shadow-sm"
                    >
                      <Scissors className="size-3.5 text-primary" />
                      <span>Căn chỉnh / Cắt ảnh</span>
                    </button>
                  )}
                </div>
                <input
                  id="edit-artwork-input"
                  type="file"
                  disabled={isSaving}
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files && e.target.files[0]) {
                      const img = e.target.files[0];
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
                  Ảnh Artwork mới sẽ tự động nạp lên S3 /artworks/ khi lưu.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                Tên bài hát *
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tên bài hát"
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                Nghệ sĩ
              </label>
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Nhập tên nghệ sĩ"
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                Album
              </label>
              <input
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Nhập tên album hoặc để trống"
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                Thứ tự trong Album
              </label>
              <input
                type="number"
                min={1}
                value={trackNo}
                onChange={(e) => setTrackNo(e.target.value)}
                placeholder="Ví dụ: 1, 2, 3..."
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block">
                Lời bài hát (.LRC)
              </label>
              <button
                type="button"
                disabled={isFetchingLyrics || isSaving}
                onClick={async () => {
                  const query = `${artist} ${title}`.trim();
                  if (!query) return;
                  setIsFetchingLyrics(true);
                  try {
                    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                      const match = data.find((d: any) => d.syncedLyrics) || data[0];
                      if (match?.syncedLyrics) setLyricsText(match.syncedLyrics);
                      else if (match?.plainLyrics) setLyricsText(match.plainLyrics);
                    }
                  } catch (err) {
                    console.error("Lyrics fetch error:", err);
                  } finally {
                    setIsFetchingLyrics(false);
                  }
                }}
                className="text-primary hover:underline text-xs flex items-center gap-1 font-semibold cursor-pointer"
              >
                {isFetchingLyrics ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Tự động tải lời mới
              </button>
            </div>
            <textarea
              rows={5}
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              placeholder="[00:15.00] Nhập hoặc dán lời bài hát định dạng LRC..."
              className="w-full bg-card border border-border rounded-lg p-3 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent cursor-pointer"
          >
            Huỷ
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium transition-transform hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Đang lưu...</span>
              </>
            ) : (
              <span>Lưu thay đổi</span>
            )}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showCropModal && artworkPreview && (
          <ArtworkCropModal
            imageSrc={artworkPreview}
            onClose={() => setShowCropModal(false)}
            onApply={(file, dataUrl) => {
              setArtworkFile(file);
              setArtworkPreview(dataUrl);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
