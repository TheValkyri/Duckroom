import { AlertTriangle, Disc, Disc3, Loader2, Music2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Album } from "../data/library";
import { ModalPortal } from "./ui/modal-portal";
import { cn } from "../lib/utils";
import { springSnappy, tapScale } from "../lib/motion";

interface DeleteAlbumDialogProps {
  album: Album | null;
  isOpen: boolean;
  trackCount: number;
  onClose: () => void;
  onConfirm: (mode: "dissolve" | "cascade_delete") => Promise<void>;
}

export function DeleteAlbumDialog({ album, isOpen, trackCount, onClose, onConfirm }: DeleteAlbumDialogProps) {
  const [mode, setMode] = useState<"cascade_delete" | "dissolve">("cascade_delete");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !album) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await onConfirm(mode);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Có lỗi xảy ra khi xóa album.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={springSnappy}
          className="bg-card border border-border/80 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-destructive/15 border border-destructive/25 text-destructive flex items-center justify-center">
                <Trash2 className="size-4.5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-base text-foreground">Xóa Album</h3>
                <p className="text-xs text-muted-foreground">Tùy chọn xử lý bài hát và dữ liệu lưu trữ</p>
              </div>
            </div>
            <button
              type="button"
              disabled={isDeleting}
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors disabled:opacity-50"
            >
              <X className="size-4.5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-5 overflow-y-auto">
            {/* Album Summary Card */}
            <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-muted/30 border border-border/50">
              <div className="size-14 rounded-xl overflow-hidden bg-black/50 shrink-0 border border-white/10 flex items-center justify-center">
                {album.cover && (album.cover.startsWith("http") || album.cover.startsWith("data:")) ? (
                  <img src={album.cover} alt={album.title} className="size-full object-cover" />
                ) : (
                  <Disc3 className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-sm text-foreground truncate">{album.title}</h4>
                <p className="text-xs text-muted-foreground truncate">{album.artist}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                    <Music2 className="size-3" />
                    {trackCount} bài hát
                  </span>
                  {album.year && <span className="text-[11px] text-muted-foreground">{album.year}</span>}
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Options Selection */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-foreground/80">Chọn hình thức xử lý:</p>

              {/* Option 1: Cascade Delete */}
              <div
                onClick={() => !isDeleting && setMode("cascade_delete")}
                className={cn(
                  "relative p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5",
                  mode === "cascade_delete"
                    ? "bg-destructive/10 border-destructive/60 shadow-sm"
                    : "bg-muted/15 border-border/60 hover:border-border hover:bg-muted/25",
                )}
              >
                <div
                  className={cn(
                    "size-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                    mode === "cascade_delete"
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {mode === "cascade_delete" && <div className="size-2 rounded-full bg-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Xóa sạch album và toàn bộ {trackCount} bài hát
                    </span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-destructive/20 text-destructive font-bold">
                      Dọn sạch S3
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Xóa hoàn toàn album và {trackCount} bài hát khỏi kho nhạc. Hệ thống sẽ tự động dọn dẹp các file âm
                    thanh và ảnh bìa trên S3 để giải phóng dung lượng.
                  </p>
                </div>
              </div>

              {/* Option 2: Dissolve into Singles */}
              <div
                onClick={() => !isDeleting && setMode("dissolve")}
                className={cn(
                  "relative p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5",
                  mode === "dissolve"
                    ? "bg-primary/10 border-primary/60 shadow-sm"
                    : "bg-muted/15 border-border/60 hover:border-border hover:bg-muted/25",
                )}
              >
                <div
                  className={cn(
                    "size-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                    mode === "dissolve"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {mode === "dissolve" && <div className="size-2 rounded-full bg-black" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Chuyển {trackCount} bài hát thành Single độc lập
                    </span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-primary/20 text-primary font-bold">
                      Bảo toàn nhạc
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Chỉ giải tán album. Toàn bộ {trackCount} bài hát sẽ được chuyển sang mục Đĩa đơn & Single, bảo lưu
                    nguyên vẹn file âm thanh & ảnh bìa trên S3 để tiếp tục nghe nhạc bình thường.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 p-5 border-t border-border/60 bg-muted/20">
            <button
              type="button"
              disabled={isDeleting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <motion.button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirm}
              whileTap={tapScale}
              transition={springSnappy}
              className={cn(
                "px-5 py-2 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-md cursor-pointer transition-all disabled:opacity-50",
                mode === "cascade_delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : mode === "cascade_delete" ? (
                <>
                  <Trash2 className="size-3.5" />
                  <span>Xác nhận xóa sạch</span>
                </>
              ) : (
                <>
                  <Disc className="size-3.5" />
                  <span>Xác nhận chuyển thành Single</span>
                </>
              )}
            </motion.button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
