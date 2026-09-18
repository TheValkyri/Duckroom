import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { LyricsPane } from "./Lyrics";

/**
 * PhoneLyricsSheet — lyrics dạng bottom-sheet cho fullscreen phone player
 * (redesign 2026-09-01 theo feedback: bỏ overlay "khung đen", thay bằng
 * sheet kéo lên có handle — cùng ngôn ngữ chuyển động với QueueSheet nên
 * cả app nhất quán: "mở cái gì từ dưới lên, kéo xuống để đóng").
 * Surface dùng glass (blur 12px) trên nền ambient — sheet là MỘT bề mặt
 * liền, không phải khung viền.
 */
export function PhoneLyricsSheet({ open, onClose, trackTitle }: { open: boolean; onClose: () => void; trackTitle: string }) {
  // Đóng bằng: nút X, hoặc kéo HANDLE xuống (pointer thủ công).
  // Vào/ra bằng CSS keyframes (PERF + fix bug motion: AnimatePresence lồng
  // trong NowPlaying giữ transform y:100% mãi mãi — QA bắt được
  // matrix(1,0,0,1,0,772) treo; animation CSS keyframes không thể treo vì
  // mỗi lần mount chạy đúng 1 lần, unmount là biến mất).
  const handleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handle = handleRef.current;
    if (!handle) return;
    let startY = 0;
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      if (e.clientY - startY > 80) {
        dragging = false;
        onClose();
      }
    };
    const onUp = () => {
      dragging = false;
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Lời bài hát: ${trackTitle}`}
      className="lyrics-sheet-in absolute inset-x-0 top-[4.5rem] bottom-0 z-40 flex flex-col rounded-t-[28px] border-t border-white/10 bg-card/92 backdrop-blur-md pb-safe"
    >
      {/* Handle: kéo xuống để đóng (pointer capture thủ công) */}
      <div
        ref={handleRef}
        className="flex cursor-grab justify-center pt-2.5 pb-1.5 active:cursor-grabbing touch-none"
        aria-hidden
      >
        <div className="h-1.5 w-10 rounded-full bg-white/25" />
      </div>
      <div className="flex items-center justify-between px-5 pt-1.5 pb-2 shrink-0">
        <span className="text-primary text-[11px] font-semibold uppercase tracking-[0.22em] truncate">
          {trackTitle}
        </span>
        <button
          onClick={onClose}
          aria-label="Đóng lời bài hát"
          className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-9 place-items-center rounded-full transition-colors cursor-pointer"
        >
          <X className="size-4.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <LyricsPane compact />
      </div>
    </div>
  );
}
