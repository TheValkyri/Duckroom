import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Image, Loader2, Scissors, Sparkles, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ArtworkCropModal } from "../components/ArtworkCropModal";
import { albums, type Album } from "../data/library";
import { cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import { extractAudioCover, extractVideoThumbnail } from "../lib/metadata";
import {
  executeGlobalUpload,
  getUploadState,
  subscribeUploadState,
  updateUploadState,
  type UploadState,
} from "../lib/upload-store";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Tải lên — Duckroom Lossless" },
      {
        name: "description",
        content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ Duckroom, không nén lại.",
      },
      { property: "og:title", content: "Tải lên — Duckroom Lossless" },
      { property: "og:description", content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ." },
    ],
  }),
  component: UploadPage,
});

import { useLibrary } from "../lib/useLibrary";
import { useAuth } from "../lib/useAuth";

function UploadPage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const { albums } = useLibrary();
  const [storeState, setStoreState] = useState<UploadState>(getUploadState());
  const [over, setOver] = useState(false);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isLoggedIn) {
      void navigate({ to: "/login" });
    }
  }, [isAuthLoading, isLoggedIn, navigate]);

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
      const cover = await extractAudioCover(file);
      if (cover) updateUploadState({ extractedCover: cover });
    } else {
      const thumb = await extractVideoThumbnail(file);
      if (thumb) updateUploadState({ extractedCover: thumb });
    }
  };

  const handleUploadSubmit = () => {
    void executeGlobalUpload();
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-5xl">Tải lên</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Lưu trữ bản thu master gốc, giữ nguyên độ phân giải và chất lượng âm thanh.
      </p>

      {successMessage && (
        <div className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 mt-6 flex items-center justify-between gap-4 rounded-xl border p-4 text-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => navigate({ to: isVideo ? "/videos" : "/library" })}
            className="bg-emerald-500 text-black rounded-full px-4 py-1.5 text-xs font-semibold hover:bg-emerald-400 cursor-pointer"
          >
            Xem kho ngay
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-6 flex items-center gap-3 rounded-xl border p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

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
            <strong>Lưu ý định dạng .MKV:</strong> Trình duyệt web mặc định không hỗ trợ phát trực tiếp tệp .mkv.
            Bạn nên đổi đuôi sang MP4 trước khi tải lên để phát mượt mà nhất.
          </div>
        </div>
      )}

      {selectedFile && (
        <div className="border-border bg-card/60 mt-4 flex items-center gap-4 rounded-xl border p-4">
          {artworkPreview || extractedCover ? (
            <img src={artworkPreview || extractedCover || ""} alt="Cover preview" className="size-14 rounded-lg object-cover" />
          ) : (
            <div className="bg-muted grid size-14 place-items-center rounded-lg">
              <UploadCloud className="text-muted-foreground size-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{selectedFile.name}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {(selectedFile.size / 1024 / 1024).toFixed(1)} MB •{" "}
              {artworkFile
                ? "✨ Sử dụng ảnh Artwork tùy chọn"
                : extractedCover
                ? "✨ Đã trích xuất Ảnh bìa gốc"
                : "Sẵn sàng tải lên"}
            </p>
          </div>
        </div>
      )}

      {/* Form Fields & Action Controls - Locked during upload */}
      <fieldset disabled={isUploading} className="border-border mt-8 grid gap-5 rounded-xl border p-6 md:grid-cols-2 disabled:opacity-65">
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
        <AlbumSelectField
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
        <Field
          id="field-year"
          label="Năm phát hành"
          value={year}
          disabled={isUploading}
          onChange={(v) => updateUploadState({ year: v })}
          placeholder="Nhập năm phát hành"
        />

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
                    isUploading && "opacity-50 cursor-not-allowed"
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
                    const cleanFile = croppedUrl.startsWith("data:")
                      ? dataURLtoFile(croppedUrl, img.name)
                      : img;
                    updateUploadState({
                      artworkFile: cleanFile,
                      artworkPreview: croppedUrl,
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
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="field-lyrics" className="text-muted-foreground text-xs tracking-wider uppercase">
              Lời bài hát (Định dạng LRC [MM:SS])
            </label>
            <button
              type="button"
              disabled={isFetchingLyrics || isUploading}
              onClick={async () => {
                const query = `${artist} ${title}`.trim() || title.trim();
                if (!query) {
                  updateUploadState({ errorMessage: "Vui lòng nhập Tên bài hát và Nghệ sĩ trước." });
                  return;
                }
                setIsFetchingLyrics(true);
                updateUploadState({ errorMessage: "", successMessage: "" });
                try {
                  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
                  const data = await res.json();
                  if (Array.isArray(data) && data.length > 0) {
                    const match = data.find((d: any) => d.syncedLyrics) || data[0];
                    if (match?.syncedLyrics) {
                      updateUploadState({
                        lyricsText: match.syncedLyrics,
                        successMessage: `✨ Đã tự động tìm thấy lời bài hát cho "${match.trackName || title}"!`,
                      });
                    } else if (match?.plainLyrics) {
                      updateUploadState({
                        lyricsText: match.plainLyrics,
                        successMessage: `✨ Đã tìm thấy lời bài hát cho "${match.trackName || title}"!`,
                      });
                    } else {
                      updateUploadState({ errorMessage: "Không tìm thấy lời bài hát. Bạn có thể tự nhập bên dưới." });
                    }
                  } else {
                    updateUploadState({ errorMessage: "Không tìm thấy lời bài hát trên thư viện." });
                  }
                } catch {
                  updateUploadState({ errorMessage: "Lỗi khi kết nối thư viện lời bài hát." });
                } finally {
                  setIsFetchingLyrics(false);
                }
              }}
              className="text-primary hover:underline flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              {isFetchingLyrics ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  <span>Đang tìm lời...</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3" />
                  <span>Tự động tìm & điền Lời bài hát (.LRC)</span>
                </>
              )}
            </button>
          </div>
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

          <button
            onClick={handleUploadSubmit}
            disabled={isUploading}
            className="bg-primary text-primary-foreground w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-medium transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
          </button>
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
  value,
  disabled,
  onChange,
  onSelectAlbum,
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onSelectAlbum: (album: Album) => void;
}) {
  const uniqueAlbums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const a of albums) {
      if (a.title.trim() && a.title.toLowerCase() !== "single collection" && a.title.toLowerCase() !== "singles") {
        const key = a.title.trim().toLowerCase();
        if (!map.has(key)) map.set(key, a);
      }
    }
    return Array.from(map.values());
  }, [albums]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="field-album" className="text-muted-foreground text-xs tracking-wider uppercase">
          Album
        </label>
        {uniqueAlbums.length > 0 && (
          <span className="text-[11px] text-primary font-medium">
            ({uniqueAlbums.length} album có sẵn)
          </span>
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
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
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