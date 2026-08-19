import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Image,
  Loader2,
  Mic,
  Rewind,
  Scissors,
  Sparkles,
  UploadCloud,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ArtworkCropModal } from "../components/ArtworkCropModal";
import { LrcLiveSyncModal } from "../components/LrcLiveSyncModal";
import { LyricsSearchModal } from "../components/LyricsSearchModal";
import { type Album } from "../data/library";
import { compressAndResizeImageFile, cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import {
  autoTimePacingLyrics,
  calculateFileSha256,
  extractAudioMetadata,
  extractVideoThumbnail,
  getAudioFileDuration,
} from "../lib/metadata";
import {
  executeGlobalUpload,
  getUploadState,
  subscribeUploadState,
  updateUploadState,
  type UploadState,
} from "../lib/upload-store";
import { beautifyLrcString, shiftLrcTime } from "../lib/lyrics-formatter";
import { springPill, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Tải lên — Duckroom" },
      {
        name: "description",
        content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ Duckroom, không nén lại.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Tải lên — Duckroom" },
      { property: "og:description", content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ." },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: UploadPage,
});

import { useLibrary } from "../lib/useLibrary";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";

function UploadPage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const { isOwner, loading: isRoleLoading } = useDuckroomRole();
  const { albums, tracks } = useLibrary();
  const [storeState, setStoreState] = useState<UploadState>(getUploadState());
  const [over, setOver] = useState(false);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [showLiveSyncModal, setShowLiveSyncModal] = useState(false);
  const [showLyricsSearchModal, setShowLyricsSearchModal] = useState(false);
  const [fileSha256, setFileSha256] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isLoggedIn) {
      void navigate({ to: "/login" });
    } else if (!isAuthLoading && !isRoleLoading && isLoggedIn && !isOwner) {
      void navigate({ to: "/my-library" });
    }
  }, [isAuthLoading, isRoleLoading, isLoggedIn, isOwner, navigate]);

  useEffect(() => {
    return subscribeUploadState(setStoreState);
  }, []);

  const {
    isUploading,
    progressText,
    percent,
    successMessage,
    errorMessage,
    selectedFile,
    extractedCover,
    artworkFile,
    artworkPreview,
    title,
    artist,
    album,
    year,
    trackNo,
    lyricsText,
    isVideo,
  } = storeState;

  const isMkv = selectedFile ? selectedFile.name.endsWith(".mkv") : false;

  const handleSelectFiles = async (files: File[]) => {
    if (!files.length || isUploading) return;
    const file = files[0]!;

    const isVid = file.type.startsWith("video/") || file.name.endsWith(".mkv");
    let autoTitle = title;
    let autoArtist = artist;

    const parts = file.name.replace(/\.[^/.]+$/, "").split(" - ");
    if (parts.length >= 2) {
      if (!autoArtist) autoArtist = parts[0]!.trim();
      if (!autoTitle) autoTitle = parts.slice(1).join(" - ").trim();
    } else if (!autoTitle) {
      autoTitle = file.name.replace(/\.[^/.]+$/, "");
    }

    updateUploadState({
      selectedFile: file,
      fileName: file.name,
      sizeMB: parseFloat((file.size / 1024 / 1024).toFixed(1)),
      errorMessage: "",
      extractedCover: null,
      title: autoTitle,
      artist: autoArtist,
      isVideo: isVid,
    });

    if (!isVid) {
      void calculateFileSha256(file).then(setFileSha256);
      const meta = await extractAudioMetadata(file);
      const updates: Partial<UploadState> = {};
      if (meta.cover) updates.extractedCover = meta.cover;
      if (meta.title && (!title || title === autoTitle)) updates.title = meta.title;
      if (meta.artist && (!artist || artist === autoArtist)) updates.artist = meta.artist;
      if (meta.album && !album) updates.album = meta.album;
      if (meta.year && !year) updates.year = meta.year;
      if (meta.trackNo) updates.trackNo = String(meta.trackNo);
      if (meta.lyrics) {
        updates.lyricsText = meta.lyrics;
        updates.successMessage = `✨ Đã tự động trích xuất thông tin thẻ và lời bài hát nhúng sẵn (${meta.lyrics.length} ký tự)!`;
      }
      updateUploadState(updates);
    } else {
      const thumb = await extractVideoThumbnail(file);
      if (thumb) updateUploadState({ extractedCover: thumb });
    }
  };

  const duplicateTrack = useMemo(() => {
    if (!selectedFile || isVideo || !title.trim()) return null;
    const curTitle = title.trim().toLowerCase();
    const curArtist = artist.trim().toLowerCase();
    return tracks.find((t) => {
      const matchTitle = t.title.trim().toLowerCase() === curTitle;
      const matchArtist = curArtist ? t.artist.trim().toLowerCase() === curArtist : true;
      return matchTitle && matchArtist;
    });
  }, [selectedFile, isVideo, title, artist, tracks]);

  const handleUploadSubmit = () => {
    void executeGlobalUpload();
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="pb-6 border-b border-border/60 mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary mb-2">
          <UploadCloud className="size-4" />
          <span>Kho lưu trữ đám mây S3</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Tải lên</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Lưu trữ bản thu master gốc, giữ nguyên độ phân giải và chất lượng âm thanh FLAC, WAV, ProRes 4K.
        </p>
      </div>

      <AnimatePresence initial={false}>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 24 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={tweenBase}
            className="overflow-hidden"
          >
            <div className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 flex items-center justify-between gap-4 rounded-xl border p-4 text-sm">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 shrink-0" />
                <span>{successMessage}</span>
              </div>
              <motion.button
                onClick={() => navigate({ to: isVideo ? "/videos" : "/library" })}
                whileTap={tapScale}
                transition={springSnappy}
                className="bg-emerald-500 text-black rounded-full px-4 py-1.5 text-xs font-semibold hover:bg-emerald-400 cursor-pointer"
              >
                Xem kho ngay
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 24 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={tweenBase}
            className="overflow-hidden"
          >
            <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-xl border p-4 text-sm">
              <AlertTriangle className="size-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.label
        htmlFor="file-upload-input"
        onDragOver={(e) => {
          e.preventDefault();
          if (!isUploading) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!isUploading && e.dataTransfer.files) handleSelectFiles(Array.from(e.dataTransfer.files));
        }}
        animate={{ scale: over ? 1.01 : 1 }}
        transition={springSnappy}
        className={cn(
          "border-border mt-8 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center transition-colors select-none",
          isUploading ? "opacity-60 cursor-not-allowed border-muted" : "cursor-pointer",
          over && !isUploading && "border-primary bg-accent/40",
          selectedFile && !isUploading && "border-primary/60 bg-accent/20",
        )}
      >
        <input
          id="file-upload-input"
          type="file"
          disabled={isUploading}
          accept=".flac,.wav,.alac,.m4a,video/*,.mkv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleSelectFiles(Array.from(e.target.files));
          }}
        />
        <UploadCloud className="text-primary size-10" />
        <p className="text-base font-medium">
          {selectedFile ? selectedFile.name : "Kéo thả tệp FLAC / WAV / ALAC / MV vào đây"}
        </p>
        <p className="text-muted-foreground text-xs">
          {selectedFile
            ? `Dung lượng: ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
            : "Hỗ trợ file nhạc Hi-Res FLAC / WAV / ALAC & Video 4K MP4"}
        </p>
      </motion.label>

      {isMkv && (
        <div className="border-amber-500/40 bg-amber-500/10 text-amber-300 mt-4 flex items-start gap-3 rounded-lg border p-3.5 text-xs leading-relaxed">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <strong>Lưu ý định dạng .MKV:</strong> Trình duyệt web mặc định không hỗ trợ phát trực tiếp tệp .mkv. Bạn
            nên đổi đuôi sang MP4 trước khi tải lên để phát mượt mà nhất.
          </div>
        </div>
      )}

      {selectedFile && (
        <div className="border-border bg-card/60 mt-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
          <div className="flex items-center gap-4">
            {artworkPreview || extractedCover ? (
              <img
                src={artworkPreview || extractedCover || ""}
                alt="Cover preview"
                decoding="async"
                className="size-16 rounded-xl object-cover border border-white/10"
              />
            ) : (
              <div className="bg-muted grid size-16 place-items-center rounded-xl">
                <UploadCloud className="text-muted-foreground size-7" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{selectedFile.name}</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                {(selectedFile.size / 1024 / 1024).toFixed(1)} MB •{" "}
                {artworkFile
                  ? "✨ Sử dụng ảnh Artwork tùy chọn"
                  : extractedCover
                    ? "✨ Đã trích xuất Ảnh bìa gốc"
                    : "Sẵn sàng tải lên"}
              </p>
              {fileSha256 && (
                <p className="text-muted-foreground/60 font-mono text-[10px] truncate mt-1">SHA-256: {fileSha256}</p>
              )}
            </div>
          </div>

          {/* Review Center Status Badges */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
              Audio: {selectedFile.name.split(".").pop()?.toUpperCase()} Lossless Master
            </span>
            <span
              className={cn(
                "px-2.5 py-1 rounded-full border font-medium",
                artworkPreview || extractedCover
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/20",
              )}
            >
              Artwork: {artworkPreview || extractedCover ? "Đã sẵn sàng (1200px)" : "Chưa có ảnh"}
            </span>
            <span
              className={cn(
                "px-2.5 py-1 rounded-full border font-medium",
                lyricsText.trim()
                  ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                  : "bg-muted/40 text-muted-foreground border-border",
              )}
            >
              Lời: {lyricsText.includes("[0") ? "Synced (.lrc)" : lyricsText.trim() ? "Plain text" : "Chưa có lời"}
            </span>
          </div>
        </div>
      )}

      {duplicateTrack && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-amber-500/40 bg-amber-500/10 text-amber-300 rounded-2xl border p-4 text-xs leading-relaxed flex items-start justify-between gap-3 mt-4"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-foreground text-sm">Phát hiện bài hát trùng lặp trong kho nhạc:</p>
              <p className="mt-0.5">
                Bài hát <strong>"{duplicateTrack.title}"</strong> của <strong>{duplicateTrack.artist}</strong> đã có sẵn
                trong kho ({duplicateTrack.format} {duplicateTrack.bitDepth}/{duplicateTrack.sampleRate}).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/library" })}
            className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-black font-semibold hover:bg-amber-400 cursor-pointer shrink-0"
          >
            Xem bài cũ
          </button>
        </motion.div>
      )}

      {/* Form Fields & Action Controls - Locked during upload */}
      <fieldset
        disabled={isUploading}
        className="border-border mt-8 grid gap-5 rounded-xl border p-6 md:grid-cols-2 disabled:opacity-65"
      >
        <Field
          id="field-title"
          label="Tên bài / MV *"
          value={title}
          disabled={isUploading}
          onChange={(v) => updateUploadState({ title: v })}
          placeholder="Nhập tên bài hát hoặc MV"
        />
        <Field
          id="field-artist"
          label="Nghệ sĩ"
          value={artist}
          disabled={isUploading}
          onChange={(v) => updateUploadState({ artist: v })}
          placeholder="Nhập tên nghệ sĩ"
        />
        {!isVideo && (
          <div className="md:col-span-2 border-b border-border/60 pb-4">
            <label className="text-muted-foreground text-xs tracking-wider uppercase block mb-2 font-medium">
              Loại phát hành
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isUploading}
                onClick={() => updateUploadState({ album: "" })}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer",
                  !album.trim() || album.toLowerCase() === "singles" || album.toLowerCase() === "single collection"
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40",
                )}
              >
                {(!album.trim() ||
                  album.toLowerCase() === "singles" ||
                  album.toLowerCase() === "single collection") && (
                  <motion.span
                    layoutId="release-type-pill"
                    transition={springPill}
                    className="absolute inset-0 rounded-xl bg-primary/20 shadow-sm -z-10"
                  />
                )}
                <span>🎵 Đĩa đơn (Single)</span>
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => {
                  const defaultAlbum = albums.find((a) => a.id !== "singles" && a.id !== "single-collection");
                  updateUploadState({ album: defaultAlbum ? defaultAlbum.title : "Album mới" });
                }}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer",
                  album.trim() && album.toLowerCase() !== "singles" && album.toLowerCase() !== "single collection"
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40",
                )}
              >
                {album.trim() && album.toLowerCase() !== "singles" && album.toLowerCase() !== "single collection" && (
                  <motion.span
                    layoutId="release-type-pill"
                    transition={springPill}
                    className="absolute inset-0 rounded-xl bg-primary/20 shadow-sm -z-10"
                  />
                )}
                <span>💿 Thuộc Album</span>
              </button>
            </div>
          </div>
        )}

        {!isVideo &&
        album.trim() &&
        album.toLowerCase() !== "singles" &&
        album.toLowerCase() !== "single collection" ? (
          <AlbumSelectField
            albums={albums}
            value={album}
            disabled={isUploading}
            onChange={(v) => updateUploadState({ album: v })}
            onSelectAlbum={(selectedAlbum) => {
              const updates: Partial<UploadState> = {};
              if (selectedAlbum.artist && (!artist || artist === "Nghệ sĩ")) {
                updates.artist = selectedAlbum.artist;
              }
              if (selectedAlbum.year) {
                updates.year = selectedAlbum.year.toString();
              }
              updateUploadState(updates);
            }}
          />
        ) : !isVideo ? (
          <div className="flex flex-col justify-center bg-card/40 border border-white/5 rounded-xl p-3.5">
            <span className="text-xs text-primary font-medium flex items-center gap-1.5">
              <span>🎵 Đĩa đơn độc lập</span>
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Bài hát sẽ được đưa vào mục <strong>Đĩa đơn</strong> với ảnh bìa Artwork riêng biệt.
            </p>
          </div>
        ) : null}
        <Field
          id="field-year"
          label="Năm phát hành"
          value={year}
          disabled={isUploading}
          onChange={(v) => updateUploadState({ year: v })}
          placeholder="Nhập năm phát hành (VD: 2024)"
        />
        {!isVideo && (
          <Field
            id="field-trackno"
            label="Số thứ tự Track (Tùy chọn)"
            value={trackNo}
            disabled={isUploading}
            onChange={(v) => updateUploadState({ trackNo: v })}
            placeholder="Tự động theo thứ tự hoặc metadata (VD: 1)"
          />
        )}

        {/* Custom Artwork Image Upload Field */}
        <div className="md:col-span-2 border-t border-border/60 pt-4">
          <label className="text-muted-foreground text-xs tracking-wider uppercase flex items-center justify-between mb-2">
            <span>Ảnh Artwork / Bìa Album (Tùy chọn)</span>
            <span className="text-[11px] text-primary">Tự động lưu vào /artworks/</span>
          </label>
          <div className="flex items-center gap-4">
            {artworkPreview || extractedCover ? (
              <img
                src={artworkPreview || extractedCover || ""}
                alt="Artwork Preview"
                decoding="async"
                className="size-16 rounded-xl object-cover border border-white/10 shadow-md shrink-0"
              />
            ) : (
              <div className="size-16 rounded-xl bg-muted/60 border border-dashed border-border grid place-items-center shrink-0">
                <Image className="size-6 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="artwork-upload-input"
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer",
                    isUploading && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Image className="size-4" />
                  <span>{artworkFile ? `Đổi Artwork (${artworkFile.name})` : "Chọn ảnh Artwork..."}</span>
                </label>

                {(artworkPreview || extractedCover) && (
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => setShowCropModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-white/10 bg-accent hover:bg-accent/80 text-foreground transition-all cursor-pointer shadow-sm"
                  >
                    <Scissors className="size-3.5 text-primary" />
                    <span>Căn chỉnh / Cắt ảnh</span>
                  </button>
                )}
              </div>
              <input
                id="artwork-upload-input"
                type="file"
                disabled={isUploading}
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files && e.target.files[0]) {
                    const img = e.target.files[0];
                    const croppedUrl = await cropBlackLetterbox(img);
                    const { file: compressedFile, dataUrl: compressedDataUrl } = await compressAndResizeImageFile(
                      croppedUrl.startsWith("data:") ? dataURLtoFile(croppedUrl, img.name) : img,
                    );
                    updateUploadState({
                      artworkFile: compressedFile,
                      artworkPreview: compressedDataUrl,
                    });
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                {artworkFile
                  ? `Đã chọn: ${artworkFile.name} (${(artworkFile.size / 1024 / 1024).toFixed(2)} MB)`
                  : "Chấp nhận các định dạng ảnh JPG, PNG, WEBP. Ảnh sẽ lưu vào S3 /artworks/."}
              </p>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label htmlFor="field-lyrics" className="text-muted-foreground text-xs tracking-wider uppercase">
              Lời bài hát (Định dạng LRC [MM:SS])
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {lyricsText.trim() && (
                <button
                  type="button"
                  disabled={!selectedFile || isUploading}
                  onClick={() => setShowLiveSyncModal(true)}
                  className="text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Bật nhạc phát và bấm Spacebar để gán mốc thời gian chuẩn xác 100% theo từng câu hát của ca sĩ"
                >
                  <Mic className="size-3" />
                  <span>Chấm nhịp theo giọng hát</span>
                </button>
              )}
              {lyricsText.trim() && (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => {
                    updateUploadState({
                      lyricsText: beautifyLrcString(lyricsText),
                      successMessage: "✨ Đã chuẩn hoá định dạng mốc thời gian LRC!",
                    });
                  }}
                  className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1 text-xs cursor-pointer transition-colors"
                  title="Sắp xếp và chuẩn hóa định dạng các mốc thời gian"
                >
                  <span>Chuẩn hóa LRC</span>
                </button>
              )}
              <button
                type="button"
                disabled={isUploading}
                onClick={() => setShowLyricsSearchModal(true)}
                className="text-primary hover:underline flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors"
                title="Mở kho tìm kiếm lời bài hát & file LRC đồng bộ đa nguồn"
              >
                <Sparkles className="size-3" />
                <span>Tìm lời Online (Kho LRC)</span>
              </button>
            </div>
          </div>

          {/* Quick Time Shift Micro-Adjuster in Upload */}
          {lyricsText.trim() && lyricsText.includes("[") && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
                <Rewind className="size-3" /> Dịch chuyển thời gian LRC:
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
                    disabled={isUploading}
                    onClick={() => {
                      const shifted = shiftLrcTime(lyricsText, btn.val);
                      updateUploadState({
                        lyricsText: shifted,
                        successMessage: `⏩ Đã dịch chuyển toàn bộ mốc thời gian ${btn.label}!`,
                      });
                    }}
                    className="bg-card hover:bg-primary/20 hover:text-primary border border-border px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            id="field-lyrics"
            rows={5}
            disabled={isUploading}
            value={lyricsText}
            onChange={(e) => updateUploadState({ lyricsText: e.target.value })}
            placeholder="[00:15.00] Nhập hoặc dán lời bài hát định dạng LRC tại đây..."
            className="border-border bg-card focus:ring-ring w-full rounded-md border p-3 font-mono text-xs outline-none focus:ring-1 disabled:cursor-not-allowed"
          />
        </div>

        <div className="md:col-span-2">
          {isUploading && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span>{progressText}</span>
                <span className="text-primary font-semibold tabular-nums">{percent}%</span>
              </div>
              <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300 rounded-full"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          <motion.button
            onClick={handleUploadSubmit}
            disabled={isUploading}
            whileTap={tapScale}
            whileHover={{ y: -1 }}
            transition={springSnappy}
            className="bg-primary text-primary-foreground w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>{progressText || "Đang tải lên..."}</span>
              </>
            ) : (
              <>
                <UploadCloud className="size-4" />
                <span>Tải lên bài hát</span>
              </>
            )}
          </motion.button>
        </div>
      </fieldset>

      <AnimatePresence>
        {showCropModal && (artworkPreview || extractedCover) && (
          <ArtworkCropModal
            imageSrc={artworkPreview || extractedCover || ""}
            onClose={() => setShowCropModal(false)}
            onApply={(file, dataUrl) => {
              updateUploadState({
                artworkFile: file,
                artworkPreview: dataUrl,
              });
            }}
          />
        )}
        {showLiveSyncModal && (
          <LrcLiveSyncModal
            isOpen={showLiveSyncModal}
            onClose={() => setShowLiveSyncModal(false)}
            audioFile={selectedFile}
            initialLyrics={lyricsText}
            onSave={(syncedLrc) => {
              updateUploadState({
                lyricsText: syncedLrc,
                successMessage: "✨ Đã áp dụng lời bài hát được chấm nhịp khớp 100% với giọng hát nghệ sĩ!",
              });
            }}
          />
        )}
        {showLyricsSearchModal && (
          <LyricsSearchModal
            isOpen={showLyricsSearchModal}
            onClose={() => setShowLyricsSearchModal(false)}
            initialTitle={title}
            initialArtist={artist}
            audioDuration={180}
            onSelectLyrics={(lrc, trackInfo) => {
              const updates: Partial<UploadState> = {
                lyricsText: lrc,
                successMessage: `✨ Đã tìm và áp dụng lời bài hát cho "${trackInfo?.title || title}"!`,
              };
              if (trackInfo?.title && (!title || title === "Tên bài hát")) updates.title = trackInfo.title;
              if (trackInfo?.artist && (!artist || artist === "Nghệ sĩ")) updates.artist = trackInfo.artist;
              updateUploadState(updates);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground text-xs tracking-wider uppercase">
        {label}
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-border bg-card focus:ring-ring mt-2 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed"
      />
    </div>
  );
}

function AlbumSelectField({
  albums: albumList,
  value,
  disabled,
  onChange,
  onSelectAlbum,
}: {
  albums: Album[];
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onSelectAlbum: (album: Album) => void;
}) {
  const uniqueAlbums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const a of albumList) {
      if (a.title.trim() && a.title.toLowerCase() !== "single collection" && a.title.toLowerCase() !== "singles") {
        const key = a.title.trim().toLowerCase();
        if (!map.has(key)) map.set(key, a);
      }
    }
    return Array.from(map.values());
  }, [albumList]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="field-album" className="text-muted-foreground text-xs tracking-wider uppercase">
          Album
        </label>
        {uniqueAlbums.length > 0 && (
          <span className="text-[11px] text-primary font-medium">({uniqueAlbums.length} album có sẵn)</span>
        )}
      </div>

      <div className="relative mt-2">
        <input
          id="field-album"
          list="albums-datalist"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val);
            const found = uniqueAlbums.find((a) => a.title.toLowerCase() === val.toLowerCase());
            if (found) {
              onSelectAlbum(found);
            }
          }}
          placeholder={uniqueAlbums.length > 0 ? "Chọn hoặc nhập tên album mới..." : "Nhập tên album"}
          className="border-border bg-card focus:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed"
        />

        <datalist id="albums-datalist">
          {uniqueAlbums.map((a) => (
            <option key={a.id} value={a.title}>
              {a.artist} ({a.year})
            </option>
          ))}
        </datalist>
      </div>

      {uniqueAlbums.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {uniqueAlbums.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(a.title);
                onSelectAlbum(a);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                value.toLowerCase() === a.title.toLowerCase()
                  ? "border-primary bg-primary/20 text-primary font-medium"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
              )}
            >
              + {a.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
