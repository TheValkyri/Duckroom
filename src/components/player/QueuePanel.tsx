import { GripVertical, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { albumById, formatTime } from "../../data/library";
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
      transition={{ type: "spring", stiffness: 240, damping: 30 }}
      className="glass border-border fixed top-0 right-0 bottom-[73px] z-40 flex w-[360px] max-w-[88vw] flex-col border-l"
    >
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="font-display text-xl">Hàng đợi</h2>
          <p className="text-muted-foreground text-xs">
            {queue.length} bài {shuffle ? "· đang trộn" : ""}
          </p>
        </div>
        <button onClick={() => setQueueOpen(false)} aria-label="Đóng hàng đợi">
          <X className="text-muted-foreground hover:text-foreground size-4" />
        </button>
      </header>
      <ol className="flex-1 overflow-y-auto p-2">
        {queue.map((t, i) => (
          <li
            key={t.id}
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
              "group hover:bg-accent/50 flex cursor-grab items-center gap-3 rounded-md px-3 py-2",
              i === index && "bg-accent/60",
              over === i && "ring-primary/60 ring-1",
            )}
          >
            <GripVertical className="text-muted-foreground size-3.5 opacity-0 group-hover:opacity-100" />
            <button onClick={() => jumpTo(i)} className="flex min-w-0 flex-1 items-center gap-3">
              <img
                src={albumById(t.albumId)?.cover}
                alt=""
                loading="lazy"
                className="size-9 rounded object-cover"
                width={36}
                height={36}
              />
              <span className="min-w-0 flex-1 text-left">
                <span
                  className={cn("block truncate text-sm", i === index && "text-primary")}
                >
                  {t.title}
                </span>
                <span className="text-muted-foreground block truncate text-xs">{t.artist}</span>
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatTime(t.duration)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </motion.aside>
  );
}