import { AlertTriangle, ExternalLink, FileCode, Loader2, Music, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/utils";
import { getFileTypeInfo } from "./file-type-utils";

interface OrphanPreviewModalProps {
  previewOrphanKey: string | null;
  previewOrphanUrl: string | null;
  isLoadingPreview: boolean;
  previewError: string | null;
  isDeletingSingle: boolean;
  onClose: () => void;
  onDeleteSingle: (key: string) => void;
}

export function OrphanPreviewModal({
  previewOrphanKey,
  previewOrphanUrl,
  isLoadingPreview,
  previewError,
  isDeletingSingle,
  onClose,
  onDeleteSingle,
}: OrphanPreviewModalProps) {
  return (
    <AnimatePresence>
      {previewOrphanKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-card border border-border/80 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="min-w-0 flex-1 pr-4">
                <div className="flex items-center gap-2">
                  {(() => {
                    const info = getFileTypeInfo(previewOrphanKey);
                    const IconC = info.Icon;
                    return (
                      <span
                        className={cn(
                          "text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 flex items-center gap-1.5",
                          info.color,
                        )}
                      >
                        <IconC className="size-3" />
                        {info.label}
                      </span>
                    );
                  })()}
                </div>
                <h3 className="font-mono text-xs text-foreground/90 mt-2 truncate select-all" title={previewOrphanKey}>
                  {previewOrphanKey}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Media Content */}
            <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center min-h-64 bg-black/40">
              {isLoadingPreview ? (
                <div className="flex flex-col items-center gap-3 text-muted-foreground py-12">
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="text-xs">Đang nạp chữ ký S3 và tải bản xem trước...</p>
                </div>
              ) : previewError ? (
                <div className="text-center p-6 text-destructive space-y-2">
                  <AlertTriangle className="size-8 mx-auto" />
                  <p className="text-xs">{previewError}</p>
                </div>
              ) : previewOrphanUrl ? (
                <div className="w-full flex items-center justify-center">
                  {(() => {
                    const info = getFileTypeInfo(previewOrphanKey);
                    if (info.type === "image") {
                      return (
                        <img
                          src={previewOrphanUrl}
                          alt={previewOrphanKey}
                          className="max-h-[55vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/10"
                        />
                      );
                    }
                    if (info.type === "video") {
                      return (
                        <video
                          src={previewOrphanUrl}
                          controls
                          autoPlay
                          className="w-full max-h-[55vh] rounded-2xl bg-black shadow-2xl"
                        />
                      );
                    }
                    if (info.type === "audio") {
                      return (
                        <div className="w-full max-w-md p-6 rounded-2xl bg-card/80 border border-white/10 text-center space-y-4 shadow-xl">
                          <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                            <Music className="size-8" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Bản Master Lossless</p>
                            <p className="text-xs text-muted-foreground font-mono truncate mt-1">{previewOrphanKey}</p>
                          </div>
                          <audio src={previewOrphanUrl} controls autoPlay className="w-full mt-2" />
                        </div>
                      );
                    }
                    return (
                      <div className="text-center p-6 text-muted-foreground space-y-3">
                        <FileCode className="size-12 mx-auto text-amber-400" />
                        <p className="text-xs font-mono">{previewOrphanKey}</p>
                        <a
                          href={previewOrphanUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary underline"
                        >
                          <ExternalLink className="size-3" /> Mở trong tab mới
                        </a>
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-border/60 bg-muted/10 flex items-center justify-between gap-3">
              {previewOrphanUrl && (
                <a
                  href={previewOrphanUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-muted/40 transition-colors"
                >
                  <ExternalLink className="size-3.5" /> Mở tab riêng
                </a>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-border text-xs font-medium hover:bg-muted cursor-pointer transition-colors"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={isDeletingSingle}
                  onClick={() => handleDeleteSingleOrphan(previewOrphanKey)}
                  className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                  <span>{isDeletingSingle ? "Đang xóa..." : "Xóa file này khỏi S3"}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  function handleDeleteSingleOrphan(key: string) {
    onDeleteSingle(key);
  }
}
