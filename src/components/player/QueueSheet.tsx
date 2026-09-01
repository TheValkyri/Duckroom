import { ChevronDown, ChevronUp, X } from "lucide-react";
import { motion } from "motion/react";
import { albumById, formatTime } from "../../data/library";
import { MobileSheet } from "../MobileSheet";
import { springSnappy, tapScale } from "../../lib/motion";
import { usePlayer } from "../../lib/player";
import { cn } from "../../lib/utils";

/**
 * QueueSheet — hàng đợi dạng bottom-sheet cho phone (MOBILE_UI_ARCHITECTURE
 * §3.3). Cùng usePlayer API với QueuePanel (queue/index/jumpTo/moveInQueue/
 * shuffle) — không nhân bản logic player.
 *
 * Reorder bằng nút ↑/↓ 44px (cùng lựa chọn a11y-first với AD-11 cho
 * playlist reorder): HTML5 drag của QueuePanel chỉ hoạt động với chuột;
 * touch-DnD tự chế dễ conflict với scroll và không dùng được trên
 * screen-reader. Optimistic update đã do moveInQueue xử lý.
 *
 * Fallback ảnh: giữ data-URI nội bộ (không unsplash) theo fix 2026-08-25
 * — tránh request mạng + flash trắng mỗi khi cover lỗi.
 */
const QUEUE_FALLBACK_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%2318181b'/%3E%3C/svg%3E";

export function QueueSheet() {
  const { queue, index, jumpTo, setQueueOpen, moveInQueue } = usePlayer();

  return (
    <MobileSheet open onClose={() => setQueueOpen(false)} title="Hàng đợi" maxHeightVh={72}>
      <p className="text-muted-foreground px-3 pb-2 text-xs">
        {queue.length} bài · chạm bài để phát, dùng mũi tên để sắp xếp lại
      </p>
      <ol className="pb-2">
        {queue.map((t, i) => {
          const busyHint = t.id;
          return (
            <motion.li
              key={`${busyHint}-${i}`}
              layout
              transition={springSnappy}
              className={cn("flex items-center gap-1 rounded-xl px-2 py-1.5", i === index && "bg-accent/60")}
            >
              <button
                onClick={() => jumpTo(i)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left cursor-pointer"
                aria-label={`Phát ${t.title} (bài ${i + 1})`}
              >
                <span className="text-muted-foreground w-5 shrink-0 text-right text-[11px] tabular-nums">{i + 1}</span>
                <img
                  src={t.cover || albumById(t.albumId)?.cover || QUEUE_FALLBACK_COVER}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.src !== QUEUE_FALLBACK_COVER) target.src = QUEUE_FALLBACK_COVER;
                  }}
                  className="size-11 rounded-lg border border-white/5 bg-card/60 object-cover shrink-0"
                  width={44}
                  height={44}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      i === index ? "text-primary font-semibold" : "text-foreground",
                    )}
                  >
                    {t.title}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">{t.artist}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatTime(t.duration)}</span>
              </button>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => moveInQueue(i, i - 1)}
                  aria-label={`Di chuyển ${t.title} lên trên`}
                  className="text-muted-foreground/70 hover:text-primary disabled:cursor-not-allowed disabled:opacity-20 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
                >
                  <ChevronUp className="size-5" />
                </button>
                <button
                  type="button"
                  disabled={i === queue.length - 1}
                  onClick={() => moveInQueue(i, i + 1)}
                  aria-label={`Di chuyển ${t.title} xuống dưới`}
                  className="text-muted-foreground/70 hover:text-primary disabled:cursor-not-allowed disabled:opacity-20 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
                >
                  <ChevronDown className="size-5" />
                </button>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </MobileSheet>
  );
}
