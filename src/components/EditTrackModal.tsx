import { Image, Loader2, Scissors, Sparkles, Wand2, X, Zap, FastForward, Rewind } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ArtworkCropModal } from "./ArtworkCropModal";
import { LyricsSearchModal } from "./LyricsSearchModal";
import { albums, updateTrack, createAlbum, type Track } from "../data/library";
import { fetchTrackArtworkUrl } from "../lib/s3";
import { compressAndResizeImageFile, cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import { modalOverlayVariants, modalPanelVariants, springSnappy, tapScale } from "../lib/motion";
import { requestPresignedUploadUrlServer } from "../lib/s3-functions";
import { beautifyLrcString, parseLrc, shiftLrcTime } from "../lib/lyrics-formatter";
import { autoTimePacingLyrics } from "../lib/metadata";
import { useAuth } from "../lib/useAuth";
import { useScrollLock } from "../hooks/use-scroll-lock";
import { cn } from "../lib/utils";

function formatTimeSec(s: number): string {
  if (typeof s !== "number" || isNaN(s) || s < 0) return "00:00.00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const ms = Math.min(99, Math.floor(Math.round((s % 1) * 100)));
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function EditTrackModal({
  track,
  onClose,
  onUpdated,
}: {
  track: Track;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { isLoggedIn, isLoading } = useAuth();
  const currentAlbum = albums.find((a) => a.id === track.albumId);
  const [title, setTitle] = useState(track.title);
  // QoL: khoá scroll nền khi modal mở (cùng pattern MobileSheet).
  useScrollLock(true);
  const [artist, setArtist] = useState(track.artist);
  const [year, setYear] = useState(track.year ? track.year.toString() : "");
  const [albumName, setAlbumName] = useState(currentAlbum?.title || "");
  const [trackNo, setTrackNo] = useState(track.trackNo ? track.trackNo.toString() : "1");
  const [lyricsText, setLyricsText] = useState(
    track.lyrics ? track.lyrics.map((l) => `[${formatTimeSec(l.time)}] ${l.text}`).join("\n") : "",
  );
  const [lyricsSource, setLyricsSource] = useState<string | null>(track.lyricsSource ?? null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);

  const isCoverUrlValid =
    track.cover &&
    (track.cover.startsWith("http://") ||
      track.cover.startsWith("https://") ||
      track.cover.startsWith("data:") ||
      track.cover.startsWith("blob:"));

  const [artworkPreview, setArtworkPreview] = useState<string | null>(isCoverUrlValid ? track.cover! : null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [showLyricsSearchModal, setShowLyricsSearchModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");

  const availableAlbums = useMemo(() => albums.filter((a) => a.id !== "singles" && a.id !== "single-collection"), []);

  useEffect(() => {
    if (!artworkPreview && track.id) {
      let isMounted = true;
      fetchTrackArtworkUrl(track.id).then((url) => {
        if (isMounted && url && (url.startsWith("http://") || url.startsWith("https://"))) {
          setArtworkPreview(url);
        }
      });
      return () => {
        isMounted = false;
      };
    }
    // Không cần cleanup khi đã có preview — trả về cleanup rỗng để mọi
    // code path đều return (fix TS7030 từ working copy, không có ở zip).
    return undefined;
  }, [track.id, artworkPreview]);

  // Close modal if user is confirmed not logged in (deferred to avoid setState-during-render)
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      onClose();
    }
  }, [isLoading, isLoggedIn, onClose]);

  if (isLoading || !isLoggedIn) {
    return null;
  }

  const handleSave = async () => {
    if (!isLoggedIn) {
      setErrorMsg("Bạn cần đăng nhập để thực hiện thay đổi.");
      return;
    }
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
        const artKey = `artwork/edit-${Date.now()}-${cleanName}.${artExt}`;
        const artContentType = artworkFile.type || "image/jpeg";

        const { uploadUrl } = await requestPresignedUploadUrlServer({
          data: { key: artKey, contentType: artContentType },
        });

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": artContentType },
          body: artworkFile,
        });

        if (!putRes.ok) {
          throw new Error(`S3 Error HTTP ${putRes.status}`);
        }

        finalCover = artKey;
      }

      // Handle Album assignment
      let targetAlbumId = "singles";
      if (
        albumName.trim() &&
        albumName.trim().toLowerCase() !== "singles" &&
        albumName.trim().toLowerCase() !== "single collection"
      ) {
        const existing = albums.find((a) => a.title.trim().toLowerCase() === albumName.trim().toLowerCase());
        if (existing) {
          targetAlbumId = existing.id;
        } else {
          const created = await createAlbum({
            title: albumName.trim(),
            artist: artist.trim() || "Nghệ sĩ",
            year: new Date().getFullYear(),
            cover:
              finalCover ||
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E",
            note: "Album tự tạo",
          });
          targetAlbumId = created.id;
        }
      }

      await updateTrack(track.id, {
        expectedVersion: track.version,
        title: title.trim(),
        artist: artist.trim() || "Nghệ sĩ",
        albumId: targetAlbumId === "singles" ? null : targetAlbumId,
        trackNo: parseInt(trackNo, 10) || 1,
        year: year.trim() ? parseInt(year.trim(), 10) : (track.year ?? null),
        cover: finalCover,
        lyrics: parseLrc(lyricsText),
        lyricsSource: lyricsSource ?? null,
      });

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
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h2 className="font-display text-xl">Chỉnh sửa thông tin bài hát & Artwork</h2>
          <motion.button
            onClick={onClose}
            disabled={isSaving}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="size-5" />
          </motion.button>
        </div>

        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-destructive/10 text-destructive border border-destructive/30 rounded-lg text-xs overflow-hidden"
            >
              <div className="p-3 mt-4">{errorMsg}</div>
            </motion.div>
          )}
        </AnimatePresence>

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
                  decoding="async"
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
                      const { file: compressedFile, dataUrl: compressedDataUrl } = await compressAndResizeImageFile(
                        croppedUrl.startsWith("data:") ? dataURLtoFile(croppedUrl, img.name) : img,
                      );
                      setArtworkFile(compressedFile);
                      setArtworkPreview(compressedDataUrl);
                    }
                  }}
                />
                <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                  Ảnh Artwork mới sẽ tự động nạp lên S3 /artwork/ khi lưu.
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
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block">
                  Album / Đĩa đơn
                </label>
                <button
                  type="button"
                  onClick={() => setAlbumName("")}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  🎵 Đặt làm Đĩa đơn
                </button>
              </div>
              <input
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Để trống nếu là Đĩa đơn (Single)"
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              {availableAlbums.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {availableAlbums.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAlbumName(a.title)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer",
                        albumName.toLowerCase() === a.title.toLowerCase()
                          ? "bg-primary/20 text-primary border-primary/40 font-medium"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {a.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                  Thứ tự trong Album
                </label>
                <input
                  type="number"
                  min={1}
                  value={trackNo}
                  onChange={(e) => setTrackNo(e.target.value)}
                  placeholder="Ví dụ: 1, 2..."
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block mb-1">
                  Năm phát hành
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Ví dụ: 2013, 2024..."
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider block">
                Lời bài hát (.LRC)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setShowLyricsSearchModal(true)}
                  className="text-primary hover:underline text-xs flex items-center gap-1 font-semibold cursor-pointer"
                  title="Mở kho tìm kiếm lời bài hát & file LRC đồng bộ đa nguồn"
                >
                  <Sparkles className="size-3" />
                  <span>Tìm lời Online (Kho LRC)</span>
                </button>
                {lyricsText.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setLyricsText(beautifyLrcString(lyricsText));
                      setNoticeMsg("✨ Đã chuẩn hoá định dạng mốc thời gian LRC!");
                      setTimeout(() => setNoticeMsg(""), 3500);
                    }}
                    className="text-muted-foreground hover:text-foreground text-[11px] hover:underline cursor-pointer flex items-center gap-1"
                    title="Sắp xếp và chuẩn hóa định dạng các mốc thời gian"
                  >
                    <span>Chuẩn hóa LRC</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Time Shift Micro-Adjuster */}
            {lyricsText.trim() && lyricsText.includes("[") && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
                  <Rewind className="size-3" /> Lệch nhịp? Dịch chuyển thời gian:
                </span>
                <div className="flex items-center gap-1">
                  {[
                    { label: "-2s", val: -2 },
                    { label: "-1s", val: -1 },
                    { label: "-0.5s", val: -0.5 },
                    { label: "+0.5s", val: 0.5 },
                    { label: "+1s", val: 1 },
                    { label: "+2s", val: 2 },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={() => {
                        const shifted = shiftLrcTime(lyricsText, btn.val);
                        setLyricsText(shifted);
                        setNoticeMsg(`⏩ Đã dịch chuyển toàn bộ lời ${btn.label} so với bản nhạc!`);
                        setTimeout(() => setNoticeMsg(""), 3000);
                      }}
                      className="bg-card hover:bg-primary/20 hover:text-primary border border-border px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {noticeMsg && (
              <div className="mb-2 text-xs text-primary font-medium bg-primary/10 border border-primary/20 rounded-md px-2.5 py-1 animate-fadeIn">
                {noticeMsg}
              </div>
            )}

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
          <motion.button
            onClick={onClose}
            disabled={isSaving}
            whileTap={tapScale}
            transition={springSnappy}
            className="flex-1 border border-border rounded-full py-2.5 text-sm transition-colors hover:bg-accent cursor-pointer"
          >
            Huỷ
          </motion.button>
          <motion.button
            onClick={handleSave}
            disabled={isSaving}
            whileTap={tapScale}
            transition={springSnappy}
            className="flex-1 bg-primary text-primary-foreground rounded-full py-2.5 text-sm font-medium cursor-pointer flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Đang lưu...</span>
              </>
            ) : (
              <span>Lưu thay đổi</span>
            )}
          </motion.button>
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
        {showLyricsSearchModal && (
          <LyricsSearchModal
            isOpen={showLyricsSearchModal}
            onClose={() => setShowLyricsSearchModal(false)}
            initialTitle={title}
            initialArtist={artist}
            audioDuration={track.duration || 180}
            onSelectLyrics={(lrc, trackInfo) => {
              setLyricsText(lrc);
              setLyricsSource(trackInfo?.source ?? null);
              if (trackInfo?.title && (!title || title === "Tên bài hát")) setTitle(trackInfo.title);
              if (trackInfo?.artist && (!artist || artist === "Nghệ sĩ")) setArtist(trackInfo.artist);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
