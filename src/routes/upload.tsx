import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Image,
  Loader2,
  Mic,
  Scissors,
  Sparkles,
  UploadCloud,
  XCircle,
  RefreshCw,
  Layers,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArtworkCropModal } from "../components/ArtworkCropModal";
import { LrcLiveSyncModal } from "../components/LrcLiveSyncModal";
import { LyricsSearchModal } from "../components/LyricsSearchModal";
import { compressAndResizeImageFile, cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";
import {
  enqueueFilesForIngestion,
  getIngestionStoreState,
  subscribeIngestionStore,
  updateIngestionItem,
  approveIngestionItem,
  approveAllIngestionItems,
  retryIngestionItem,
  cancelIngestionItem,
  clearCompletedIngestionItems,
  applyBulkMetadataEdit,
  type IngestionItem,
  type IngestionStoreState,
} from "../lib/upload-store";
import { beautifyLrcString, parseLrc, shiftLrcTime } from "../lib/lyrics-formatter";
import { springPill, springSnappy, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";
import { useLibrary } from "../lib/useLibrary";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Tải lên & Trung tâm Tiếp nhận — Duckroom" },
      {
        name: "description",
        content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ Duckroom qua quy trình tiếp nhận chuẩn xác.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Tải lên & Trung tâm Tiếp nhận — Duckroom" },
      { property: "og:description", content: "Đưa file FLAC, WAV và MV bản gốc vào kho lưu trữ." },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const { isOwner, loading: isRoleLoading } = useDuckroomRole();
  const { albums } = useLibrary();
  const [storeState, setStoreState] = useState<IngestionStoreState>(getIngestionStoreState());
  const [over, setOver] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Bulk edit (Master Plan §8.4)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArtist, setBulkArtist] = useState("");
  const [bulkAlbum, setBulkAlbum] = useState("");
  const [bulkYear, setBulkYear] = useState("");

  const reviewItems = storeState.items.filter((i) => i.stage === "waiting_review");
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleApplyBulk = () => {
    if (selectedIds.size === 0) return;
    applyBulkMetadataEdit([...selectedIds], { artist: bulkArtist, album: bulkAlbum, year: bulkYear });
    setSelectedIds(new Set());
    setBulkArtist("");
    setBulkAlbum("");
    setBulkYear("");
  };

  const handleRejectSelected = async () => {
    for (const id of selectedIds) {
      await cancelIngestionItem(id);
    }
    setSelectedIds(new Set());
  };

  // Modals state
  const [showCropModal, setShowCropModal] = useState(false);
  const [showLiveSyncModal, setShowLiveSyncModal] = useState(false);
  const [showLyricsSearchModal, setShowLyricsSearchModal] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isLoggedIn) {
      void navigate({ to: "/login" });
    } else if (!isAuthLoading && !isRoleLoading && isLoggedIn && !isOwner) {
      void navigate({ to: "/my-library" });
    }
  }, [isAuthLoading, isRoleLoading, isLoggedIn, isOwner, navigate]);

  useEffect(() => {
    return subscribeIngestionStore(setStoreState);
  }, []);

  const items = storeState.items;
  const activeItem = items.find((i) => i.id === activeItemId) || items[0] || null;

  const handleSelectFiles = (files: File[]) => {
    if (!files.length) return;
    void enqueueFilesForIngestion(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectFiles(Array.from(e.dataTransfer.files));
    }
  };

  const pendingCount = items.filter((i) => i.stage === "waiting_review").length;
  const activeCount = items.filter((i) => ["uploading", "verifying_server", "committing"].includes(i.stage)).length;
  const completedCount = items.filter((i) => i.stage === "complete").length;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 pb-32">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">Trung tâm Tiếp nhận Media</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Phân tích tệp nhị phân, kiểm tra SHA-256, duyệt thông tin & cam kết trực tiếp vào PostgreSQL.
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {pendingCount > 0 && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => void approveAllIngestionItems()}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm"
              >
                <CheckCircle2 className="h-4 w-4" />
                Phê duyệt tất cả ({pendingCount})
              </motion.button>
            )}
            {completedCount > 0 && (
              <button
                onClick={clearCompletedIngestionItems}
                className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Xóa mục hoàn tất
              </button>
            )}
          </div>
        )}
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition-all duration-200",
          over ? "border-primary bg-primary/5 scale-[1.01]" : "border-border/80 bg-card/40 hover:border-primary/50",
        )}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
          <UploadCloud className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Kéo thả tệp âm thanh (FLAC, WAV, M4A) hoặc MV vào đây</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-md">
          Hỗ trợ chọn nhiều tệp cùng lúc. Hệ thống sẽ tự động trích xuất thẻ ID3/Vorbis, ảnh bìa và lời bài hát nhúng
          sẵn.
        </p>

        <label className="mt-6 cursor-pointer rounded-xl bg-secondary px-6 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80 transition-colors">
          Chọn tệp từ máy
          <input
            type="file"
            multiple
            accept="audio/*,video/*,.flac,.alac,.wav,.mp3,.m4a,.mp4,.mkv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleSelectFiles(Array.from(e.target.files));
            }}
          />
        </label>
      </div>

      {/* Queue & Review Section */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left: Items List */}
          <div className="space-y-4 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Hàng đợi tiếp nhận ({items.length})
              </h2>
              {activeCount > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-primary font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang xử lý ({activeCount})
                </span>
              )}
            </div>

            <div className="space-y-3">
              {/* Bulk edit toolbar — §8.4: applies to SELECTED review items */}
              {reviewItems.length > 0 && (
                <div className="rounded-2xl border border-border bg-card/80 p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={bulkArtist}
                      onChange={(e) => setBulkArtist(e.target.value)}
                      placeholder="Nghệ sĩ..."
                      className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs"
                    />
                    <input
                      value={bulkAlbum}
                      onChange={(e) => setBulkAlbum(e.target.value)}
                      placeholder="Album..."
                      className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs"
                    />
                    <input
                      value={bulkYear}
                      onChange={(e) => setBulkYear(e.target.value)}
                      placeholder="Năm"
                      inputMode="numeric"
                      className="h-8 w-20 rounded-lg border border-input bg-background px-2.5 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      disabled={selectedIds.size === 0}
                      onClick={handleApplyBulk}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold",
                        selectedIds.size > 0
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "cursor-not-allowed bg-secondary text-muted-foreground",
                      )}
                    >
                      Áp dụng cho {selectedIds.size} mục đã chọn
                    </button>
                    <button
                      disabled={selectedIds.size === 0}
                      onClick={() => void handleRejectSelected()}
                      className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    >
                      Loại bỏ mục đã chọn
                    </button>
                    {reviewItems.length > 0 && (
                      <button
                        onClick={() => setSelectedIds(new Set(reviewItems.map((i) => i.id)))}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Chọn tất cả ({reviewItems.length})
                      </button>
                    )}
                  </div>
                </div>
              )}

              {items.map((item) => {
                const isSelected =
                  (activeItem && activeItem.id === item.id) || (!activeItem && items[0]?.id === item.id);
                return (
                  <motion.div
                    key={item.id}
                    layout
                    onClick={() => setActiveItemId(item.id)}
                    className={cn(
                      "cursor-pointer rounded-2xl border p-4 transition-all duration-200",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card/60 hover:bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label
                        className="flex shrink-0 cursor-pointer items-center pt-0.5 pr-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          disabled={item.stage !== "waiting_review"}
                          onChange={() => toggleSelected(item.id)}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-foreground">
                          {item.metadata.title || item.file.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.metadata.artist || "Chưa xác định"} • {(item.file.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                      <StageBadge stage={item.stage} duplicate={item.duplicate.status} />
                    </div>

                    {/* Review status strip — §8.3 signals surfaced to the Owner */}
                    {item.stage === "waiting_review" && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <ReviewChip label="Meta" status={item.review.metadataStatus} />
                        <ReviewChip label="Artwork" status={item.review.artworkStatus} />
                        <ReviewChip
                          label="Integrity"
                          status={item.review.integrityStatus === "pending" ? "warning" : item.review.integrityStatus}
                        />
                        {item.review.duplicateStatus === "exact_duplicate" && (
                          <ReviewChip label="Duplicate" status="error" />
                        )}
                      </div>
                    )}

                    {/* Progress / Status bar */}
                    {item.stage !== "complete" && item.stage !== "waiting_review" && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>{item.progressText}</span>
                          <span>{item.progressPercent}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              "h-full transition-all duration-300",
                              item.stage === "failed" ? "bg-destructive" : "bg-primary",
                            )}
                            style={{ width: `${item.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {item.errorMessage && (
                      <p className="mt-2 text-xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {item.errorMessage}
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Right: Review & Edit Card */}
          {activeItem && (
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Duyệt thông tin tệp</h3>
                  <p className="text-xs text-muted-foreground font-mono truncate max-w-sm">
                    SHA-256: {activeItem.clientSha256 || "Đang tính..."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeItem.stage === "failed" && (
                    <button
                      onClick={() => void retryIngestionItem(activeItem.id)}
                      className="flex items-center gap-1 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Thử lại
                    </button>
                  )}
                  <button
                    onClick={() => void cancelIngestionItem(activeItem.id)}
                    className="flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Hủy bỏ
                  </button>
                </div>
              </div>

              {/* Duplicate Alert */}
              {activeItem.duplicate.status === "exact_duplicate" && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    Phát hiện bản sao SHA-256 chính xác
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tệp này trùng mã băm SHA-256 với một bản ghi đã tồn tại trong thư viện.
                  </p>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => approveIngestionItem(activeItem.id, "upload_anyway")}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      Vẫn tải lên bản sao
                    </button>
                    <button
                      onClick={() => void cancelIngestionItem(activeItem.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      Hủy mục này
                    </button>
                  </div>
                </div>
              )}

              {/* Metadata Form */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Tên bài hát / MV</label>
                  <input
                    type="text"
                    value={activeItem.metadata.title}
                    onChange={(e) =>
                      updateIngestionItem(activeItem.id, {
                        metadata: { ...activeItem.metadata, title: e.target.value },
                      })
                    }
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Nghệ sĩ thể hiện</label>
                  <input
                    type="text"
                    value={activeItem.metadata.artist}
                    onChange={(e) =>
                      updateIngestionItem(activeItem.id, {
                        metadata: { ...activeItem.metadata, artist: e.target.value },
                      })
                    }
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {!activeItem.isVideo && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">Album (để trống = Singles)</label>
                      <input
                        type="text"
                        value={activeItem.metadata.album}
                        placeholder="Singles"
                        onChange={(e) =>
                          updateIngestionItem(activeItem.id, {
                            metadata: { ...activeItem.metadata, album: e.target.value },
                          })
                        }
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground">Năm</label>
                        <input
                          type="text"
                          value={activeItem.metadata.year}
                          onChange={(e) =>
                            updateIngestionItem(activeItem.id, {
                              metadata: { ...activeItem.metadata, year: e.target.value },
                            })
                          }
                          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground">Track No.</label>
                        <input
                          type="text"
                          value={activeItem.metadata.trackNo}
                          onChange={(e) =>
                            updateIngestionItem(activeItem.id, {
                              metadata: { ...activeItem.metadata, trackNo: e.target.value },
                            })
                          }
                          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Lyrics editor (audio only) — Master Plan §10 */}
              {!activeItem.isVideo && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-foreground">Lời bài hát (LRC hoặc lời thường)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {activeItem.metadata.lyricsText.trim() && (
                        <button
                          type="button"
                          onClick={() =>
                            updateIngestionItem(activeItem.id, {
                              metadata: {
                                ...activeItem.metadata,
                                lyricsText: beautifyLrcString(activeItem.metadata.lyricsText),
                              },
                            })
                          }
                          className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                        >
                          Chuẩn hóa LRC
                        </button>
                      )}
                      {parseLrc(activeItem.metadata.lyricsText).length > 0 &&
                        [-0.5, 0.5].map((delta) => (
                          <button
                            key={delta}
                            type="button"
                            onClick={() =>
                              updateIngestionItem(activeItem.id, {
                                metadata: {
                                  ...activeItem.metadata,
                                  lyricsText: shiftLrcTime(activeItem.metadata.lyricsText, delta),
                                },
                              })
                            }
                            className="rounded-lg border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                          >
                            {delta > 0 ? "+0.5s" : "-0.5s"}
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => setShowLyricsSearchModal(true)}
                        className="text-primary flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold hover:underline"
                      >
                        Tìm lời Online (Kho LRC)
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLiveSyncModal(true)}
                        className="text-primary flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold hover:underline"
                        title="Gõ nhịp theo bản nghe local để đóng dấu thời gian LRC"
                      >
                        Đồng bộ thủ công
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={activeItem.metadata.lyricsText}
                    onChange={(e) =>
                      updateIngestionItem(activeItem.id, {
                        metadata: { ...activeItem.metadata, lyricsText: e.target.value },
                      })
                    }
                    rows={4}
                    placeholder="[00:12.00] Lời bài hát… (để trống nếu chưa có)"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {/* Artwork & Technical specs preview */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-muted">
                  {activeItem.artwork.previewUrl ? (
                    <img src={activeItem.artwork.previewUrl} alt="Cover" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Image className="h-8 w-8 opacity-40" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <label className="cursor-pointer rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80">
                      Đổi ảnh bìa
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            updateIngestionItem(activeItem.id, {
                              artwork: { file, previewUrl: url, status: "pending" },
                            });
                          }
                        }}
                      />
                    </label>

                    {activeItem.artwork.previewUrl && (
                      <button
                        onClick={() => setShowCropModal(true)}
                        className="flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                        Cắt vuông 1:1
                      </button>
                    )}
                  </div>

                  {activeItem.localAnalysis && (
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted px-2 py-0.5 font-mono font-medium">
                        {activeItem.localAnalysis.container}
                      </span>
                      {"sampleRate" in activeItem.localAnalysis && activeItem.localAnalysis.sampleRate > 0 && (
                        <span className="rounded bg-muted px-2 py-0.5 font-mono">
                          {activeItem.localAnalysis.bitDepth}-bit / {activeItem.localAnalysis.sampleRate / 1000} kHz
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Trạng thái: <strong className="text-foreground">{activeItem.stage}</strong>
                </span>

                {activeItem.stage === "waiting_review" && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => void approveIngestionItem(activeItem.id)}
                    className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Phê duyệt & Tải lên
                  </motion.button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Artwork Crop Modal */}
      {showCropModal && activeItem?.artwork.previewUrl && (
        <ArtworkCropModal
          imageSrc={activeItem.artwork.previewUrl}
          onClose={() => setShowCropModal(false)}
          onApply={(croppedFile: File, croppedDataUrl: string) => {
            updateIngestionItem(activeItem.id, {
              artwork: { file: croppedFile, previewUrl: croppedDataUrl, status: "pending" },
            });
            setShowCropModal(false);
          }}
        />
      )}

      {/* Lyrics Online Search Modal */}
      {showLyricsSearchModal && activeItem && !activeItem.isVideo && (
        <LyricsSearchModal
          isOpen={showLyricsSearchModal}
          onClose={() => setShowLyricsSearchModal(false)}
          initialTitle={activeItem.metadata.title}
          initialArtist={activeItem.metadata.artist}
          {...(() => {
            const analysis = activeItem.localAnalysis;
            const dur = analysis && "durationSeconds" in analysis ? (analysis.durationSeconds as number) : 0;
            return dur > 0 ? ({ audioDuration: dur } as const) : {};
          })()}
          onSelectLyrics={(lrc, trackInfo) => {
            const fresh = getIngestionStoreState().items.find((i) => i.id === activeItem.id);
            if (!fresh) {
              setShowLyricsSearchModal(false);
              return;
            }
            const nextTitle =
              trackInfo?.title && trackInfo.title !== "Tên bài hát" ? trackInfo.title : fresh.metadata.title;
            updateIngestionItem(fresh.id, {
              metadata: { ...fresh.metadata, lyricsText: lrc, title: nextTitle },
            });
            setShowLyricsSearchModal(false);
          }}
        />
      )}

      {/* LRC Live Sync Studio Modal */}
      {showLiveSyncModal && activeItem && !activeItem.isVideo && (
        <LrcLiveSyncModal
          isOpen={showLiveSyncModal}
          onClose={() => setShowLiveSyncModal(false)}
          audioFile={activeItem.file}
          initialLyrics={activeItem.metadata.lyricsText}
          onSave={(lrcString) => {
            const fresh = getIngestionStoreState().items.find((i) => i.id === activeItem.id);
            if (!fresh) {
              setShowLiveSyncModal(false);
              return;
            }
            updateIngestionItem(fresh.id, {
              metadata: { ...fresh.metadata, lyricsText: lrcString },
            });
            setShowLiveSyncModal(false);
          }}
        />
      )}
    </div>
  );
}

function ReviewChip({ label, status }: { label: string; status: "verified" | "warning" | "error" | string }) {
  const styles: Record<string, string> = {
    verified: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    error: "bg-destructive/10 text-destructive",
  };
  const labels: Record<string, string> = { verified: "OK", warning: "Cảnh báo", error: "Lỗi" };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", styles[status] ?? styles["warning"])}>
      {label}: {labels[status] ?? status}
    </span>
  );
}

function StageBadge({ stage, duplicate }: { stage: string; duplicate: string }) {
  if (duplicate === "exact_duplicate") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">
        Trùng lặp
      </span>
    );
  }
  switch (stage) {
    case "waiting_review":
      return (
        <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-blue-600">
          Chờ duyệt
        </span>
      );
    case "approved":
      return (
        <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
          Đã duyệt
        </span>
      );
    case "uploading":
      return (
        <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-yellow-600">
          Đang tải
        </span>
      );
    case "verifying_server":
      return (
        <span className="rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-purple-600">
          Đang xác minh
        </span>
      );
    case "committing":
      return (
        <span className="rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-teal-600">
          Đang cam kết
        </span>
      );
    case "complete":
      return (
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
          Hoàn tất
        </span>
      );
    case "failed":
      return (
        <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-600">
          Thất bại
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {stage}
        </span>
      );
  }
}
