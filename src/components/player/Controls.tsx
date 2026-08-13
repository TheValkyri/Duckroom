import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { formatTime } from "../../data/library";
import { usePlayer } from "../../lib/player";
import { cn } from "../../lib/utils";

export function TransportControls({ size = "md" }: { size?: "md" | "lg" }) {
  const { isPlaying, toggle, next, prev, shuffle, toggleShuffle, repeat, cycleRepeat } =
    usePlayer();
  const big = size === "lg";

  const iconBtn =
    "grid place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground cursor-pointer";

  return (
    <div className={cn("flex items-center", big ? "gap-6" : "gap-4")}>
      <button
        aria-label="Trộn bài"
        title={shuffle ? "Trộn bài: Đang Bật (nhấn phím 'S')" : "Trộn bài: Đang Tắt (nhấn phím 'S')"}
        onClick={toggleShuffle}
        className={cn(iconBtn, big ? "size-10" : "size-8", shuffle && "text-primary relative font-bold")}
      >
        <Shuffle className={big ? "size-5" : "size-4"} />
        {shuffle && <span className="absolute -bottom-1 size-1 rounded-full bg-primary" />}
      </button>
      <button aria-label="Bài trước" title="Bài trước (Shift + Mũi tên trái)" onClick={prev} className={cn(iconBtn, "size-9")}>
        <SkipBack className={big ? "size-6" : "size-5"} fill="currentColor" />
      </button>
      <motion.button
        aria-label={isPlaying ? "Tạm dừng" : "Phát"}
        title={isPlaying ? "Tạm dừng (Phím cách Space)" : "Phát (Phím cách Space)"}
        onClick={toggle}
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.06 }}
        transition={{ type: "spring", stiffness: 520, damping: 24 }}
        className={cn(
          "grid place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_30px_-8px_oklch(0.76_0.14_66/0.7)] cursor-pointer",
          big ? "size-16" : "size-11",
        )}
      >
        {isPlaying ? (
          <Pause className={big ? "size-7" : "size-5"} fill="currentColor" />
        ) : (
          <Play className={cn(big ? "size-7" : "size-5", "translate-x-[1px]")} fill="currentColor" />
        )}
      </motion.button>
      <button aria-label="Bài sau" title="Bài sau (Shift + Mũi tên phải)" onClick={() => next(true)} className={cn(iconBtn, "size-9")}>
        <SkipForward className={big ? "size-6" : "size-5"} fill="currentColor" />
      </button>
      <button
        aria-label="Lặp lại"
        title={
          repeat === "one"
            ? "Lặp lại: Lặp 1 bài (nhấn phím 'R')"
            : repeat === "all"
            ? "Lặp lại: Lặp toàn bộ (nhấn phím 'R')"
            : "Lặp lại: Đang Tắt (nhấn phím 'R')"
        }
        onClick={cycleRepeat}
        className={cn(iconBtn, big ? "size-10" : "size-8", repeat !== "off" && "text-primary relative font-bold")}
      >
        {repeat === "one" ? (
          <Repeat1 className={big ? "size-5" : "size-4"} />
        ) : (
          <Repeat className={big ? "size-5" : "size-4"} />
        )}
        {repeat !== "off" && <span className="absolute -bottom-1 size-1 rounded-full bg-primary" />}
      </button>
    </div>
  );
}

export function SeekBar({ compact = false }: { compact?: boolean }) {
  const { time, current, seek } = usePlayer();
  const duration = current?.duration ?? 1;

  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const displayTime = isDragging ? dragTime : time;
  const pct = Math.min(100, Math.max(0, (displayTime / (duration || 1)) * 100));

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      seek(val);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex w-full items-center select-none cursor-pointer",
        compact ? "h-6 py-1" : "h-8 py-2",
      )}
      onPointerDown={() => setIsDragging(true)}
      onPointerUp={() => {
        if (isDragging) {
          seek(dragTime);
          setIsDragging(false);
        }
      }}
    >
      {/* Background Track */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            isDragging ? "transition-none" : "transition-[width] duration-75 ease-out"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Hover/Drag Thumb Dot */}
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md",
          isDragging ? "scale-125 opacity-100 transition-none" : "opacity-0 group-hover:scale-125 group-hover:opacity-100 transition-all duration-150"
        )}
        style={{ left: `${pct}%` }}
      />

      {/* Native Range Input overlay */}
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={displayTime}
        onChange={handleSeekChange}
        onInput={(e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          if (!isNaN(val)) setDragTime(val);
        }}
        aria-label="Tiến trình phát nhạc"
        className="absolute inset-0 size-full opacity-0 cursor-pointer"
      />
    </div>
  );
}