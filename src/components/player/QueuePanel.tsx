import { GripVertical, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { albumById, formatTime } from "../../data/library";
import { springGentle, springSnappy, tapScale } from "../../lib/motion";
import { usePlayer } from "../../lib/player";
import { cn } from "../../lib/utils";

export function QueuePanel() {
  const { queue, index, jumpTo, setQueueOpen, moveInQueue, shuffle } = usePlayer();
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <motion.aside
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={springGentle}
      className="glass edge-shadow-l fixed top-0 right-0 bottom-[73px] z-40 flex w-[360px] max-w-[88vw] flex-col"
    >
      {/* Redesign 2026-09-04: bỏ border-l + border-b header (feedback
          "hạn chế kẻ") — khối kính tách nội dung bằng bóng mềm trái,
          header tách list bằng khoảng trống + tracking tự nhiên. */}
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <h2 className="font-display text-xl">Hàng đợi</h2>
          <p className="text-muted-foreground text-xs">
            {queue.length} bài {shuffle ? "· đang trộn" : ""}
          </p>
        </div>
        <motion.button
          onClick={() => setQueueOpen(false)}
          aria-label="Đóng hàng đợi"
          whileTap={tapScale}
          transition={springSnappy}
          className="p-1 rounded-full hover:bg-accent/60 cursor-pointer"
        >
          <X className="text-muted-foreground hover:text-foreground size-4" />
        </motion.button>
      </header>
      {/* motion.li + layout: khi moveInQueue() đổi thứ tự mảng, mỗi hàng tự
          động FLIP-animate sang vị trí mới thay vì "nhảy" tức thời — cảm giác
          kéo-thả có trọng lượng, mượt như các app nhạc lớn. */}
      <ol className="flex-1 overflow-y-auto p-2">
        {queue.map((t, i) => (
          <motion.li
            key={t.id}
            layout
            transition={springSnappy}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDrop={() => {
              if (dragFrom.current !== null) moveInQueue(dragFrom.current, i);
              dragFrom.current = null;
              setOver(null);
            }}
            onDragEnd={() => setOver(null)}
            className={cn(
              "group hover:bg-accent/50 flex cursor-grab items-center gap-3 rounded-md px-3 py-2 active:cursor-grabbing",
              i === index && "bg-accent/60",
              over === i && "ring-primary/60 ring-1",
            )}
          >
            <GripVertical className="text-muted-foreground size-3.5 opacity-0 transition-opacity group-hover:opacity-100 shrink-0" />
            <button onClick={() => jumpTo(i)} className="flex min-w-0 flex-1 items-center gap-3 cursor-pointer">
              <img
                src={
                  t.cover ||
                  albumById(t.albumId)?.cover ||
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%2318181b'/%3E%3C/svg%3E"
                }
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const target = e.currentTarget;
                  const fallback =
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%2318181b'/%3E%3C/svg%3E";
                  if (target.src !== fallback) {
                    target.src = fallback;
                  }
                }}
                className="size-9 rounded-lg object-cover bg-card/60 border border-white/5 shrink-0"
                width={36}
                height={36}
              />
              <span className="min-w-0 flex-1 text-left">
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
              <span className="text-muted-foreground text-xs tabular-nums">{formatTime(t.duration)}</span>
            </button>
          </motion.li>
        ))}
      </ol>
    </motion.aside>
  );
}
