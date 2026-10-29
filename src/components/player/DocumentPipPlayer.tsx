import { memo, useMemo, useState } from "react";
import {
  Maximize2,
  Mic2,
  Minimize2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { albumById, formatTime, type LyricLine } from "../../data/library";
import { usePlayer, usePlayerTime, useSmoothLyricTime } from "../../lib/player";
import { computeWordTimings } from "../../lib/lyrics-formatter";
import { cn } from "../../lib/utils";

/**
 * Word-by-word Karaoke Glowing Syllable Line for Mini Player
 */
const KaraokeLine = memo(function KaraokeLine({
  line,
  nextLineTime,
  time: propTime,
}: {
  line: LyricLine;
  nextLineTime?: number | undefined;
  time?: number;
}) {
  const fallbackTime = propTime ?? 0;
  const time = useSmoothLyricTime(fallbackTime);
  const words = useMemo(() => computeWordTimings(line, nextLineTime), [line, nextLineTime]);

  if (!words.length) {
    return <span className="text-foreground/90 font-medium">{line.text}</span>;
  }

  return (
    <span className="inline-flex flex-wrap justify-center gap-x-1.5 gap-y-1 font-medium">
      {words.map((w, idx) => {
        const isPast = time >= w.endTime;
        const isFuture = time < w.startTime;
        const isSinging = !isPast && !isFuture;

        const progress = isPast
          ? 1
          : isFuture
            ? 0
            : Math.min(1, Math.max(0, (time - w.startTime) / Math.max(0.01, w.endTime - w.startTime)));
        const pct = (progress * 100).toFixed(1);
        const feather = Math.min(12, Math.max(0, (1 - progress) * 24));
        const leadStart = Math.max(0, Number(pct) - feather).toFixed(1);

        return (
          <span
            key={`${idx}-${w.text}`}
            className={cn(
              "relative inline-block transition-transform duration-150 font-semibold",
              isSinging && "-translate-y-0.5",
            )}
          >
            {/* Base text: 100% visible across all PiP themes and windows */}
            <span className={cn("inline-block", isPast ? "text-primary font-semibold" : "text-foreground/45")}>
              {w.text}
            </span>

            {/* Active syllable fluid fill overlay */}
            {isSinging && (
              <span
                className="absolute inset-0 whitespace-nowrap text-primary font-semibold select-none pointer-events-none"
                style={{
                  clipPath: `inset(-15% ${(100 - Number(pct)).toFixed(1)}% -15% 0)`,
                  WebkitClipPath: `inset(-15% ${(100 - Number(pct)).toFixed(1)}% -15% 0)`,
                  maskImage: `linear-gradient(90deg, #000 0%, #000 ${leadStart}%, transparent ${pct}%, transparent 100%)`,
                  WebkitMaskImage: `linear-gradient(90deg, #000 0%, #000 ${leadStart}%, transparent ${pct}%, transparent 100%)`,
                  textShadow: "0 0 10px var(--primary, #d97706)",
                }}
                aria-hidden="true"
              >
                {w.text}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
});

export interface DocumentPipPlayerProps {
  onClose?: (() => void) | undefined;
  isFloatingOverlay?: boolean | undefined;
}

export function DocumentPipPlayer({ onClose, isFloatingOverlay = false }: DocumentPipPlayerProps) {
  const { current, isPlaying, toggle, next, prev, seek, volume, setVolume, isMuted, toggleMute, setExpanded } =
    usePlayer();

  const time = usePlayerTime();
  const [viewMode, setViewMode] = useState<"vinyl" | "lyrics">("vinyl");

  if (!current) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-6 text-center text-muted-foreground">
        <Music2 className="size-10 mb-2 opacity-50 animate-pulse" />
        <p className="text-sm font-medium">Chưa có bài hát nào đang phát</p>
      </div>
    );
  }

  const album = albumById(current.albumId);
  const fallbackCover =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%2318181b'/%3E%3C/svg%3E";
  const coverUrl = current.cover || album?.cover || fallbackCover;

  const lines = current.lyrics || [];
  let activeLyricIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && time >= l.time) activeLyricIdx = i;
  }
  const currentLine = activeLyricIdx >= 0 ? lines[activeLyricIdx] : undefined;
  const nextLine = activeLyricIdx >= 0 && activeLyricIdx + 1 < lines.length ? lines[activeLyricIdx + 1] : undefined;

  const progressPct = current.duration > 0 ? Math.min(100, Math.max(0, (time / current.duration) * 100)) : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * current.duration);
  };

  return (
    <div
      className={cn(
        "relative flex h-screen w-full flex-col justify-between overflow-hidden bg-background text-foreground select-none p-4",
        isFloatingOverlay && "rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl bg-background/95",
      )}
    >
      {/* Background Ambient Glow */}
      <div
        className="pointer-events-none absolute -top-12 -left-12 size-48 rounded-full opacity-20 blur-3xl"
        style={{ backgroundColor: "var(--primary, #d97706)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-12 -right-12 size-48 rounded-full opacity-15 blur-3xl"
        style={{ backgroundColor: "var(--primary, #d97706)" }}
      />

      {/* Header Bar */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="bg-primary/20 text-primary border border-primary/30 flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold">
            DR
          </span>
          <span className="truncate text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Duckroom Mini Player
          </span>
          <span className="border-border text-primary shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono">
            {current.format}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            title={viewMode === "vinyl" ? "Xem lời bài hát" : "Xem đĩa than"}
            onClick={() => setViewMode(viewMode === "vinyl" ? "lyrics" : "vinyl")}
            className={cn(
              "grid size-7 place-items-center rounded-full transition-colors cursor-pointer",
              viewMode === "lyrics"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
            aria-label="Chuyển chế độ hiển thị"
          >
            <Mic2 className="size-3.5" />
          </button>

          {isFloatingOverlay && (
            <button
              type="button"
              title="Mở toàn màn hình"
              onClick={() => {
                setExpanded(true);
                onClose?.();
              }}
              className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-full hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Mở toàn màn hình"
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}

          {onClose && (
            <button
              type="button"
              title="Đóng"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Đóng Mini Player"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Center Stage */}
      <div className="relative z-10 my-auto flex flex-1 flex-col items-center justify-center overflow-hidden py-3">
        {viewMode === "vinyl" ? (
          <>
            {/* Spinning Vinyl Record & Album Jacket */}
            <div className="relative flex items-center justify-center my-1 size-36 sm:size-40 shrink-0">
              {/* Vinyl Disc behind jacket */}
              <div
                className={cn(
                  "absolute size-[8.5rem] sm:size-[9.5rem] rounded-full border-2 border-neutral-800 bg-neutral-950 shadow-xl transition-all duration-700 ease-out",
                  isPlaying ? "translate-x-6 sm:translate-x-8 opacity-95" : "translate-x-0 opacity-0",
                )}
              >
                <div
                  className="size-full rounded-full relative flex items-center justify-center animate-[spin_16s_linear_infinite]"
                  style={{ animationPlayState: isPlaying ? "running" : "paused" }}
                >
                  <div className="absolute inset-3 rounded-full border border-neutral-800/60" />
                  <div className="absolute inset-6 rounded-full border border-neutral-800/40" />
                  <div className="absolute inset-9 rounded-full border border-neutral-800/60" />
                  <div className="bg-primary/30 border-primary/50 flex size-9 items-center justify-center rounded-full border">
                    <div className="bg-background size-2.5 rounded-full" />
                  </div>
                </div>
              </div>

              {/* Album Jacket Sleeve */}
              <div className="relative z-10 size-32 sm:size-36 overflow-hidden rounded-xl border border-white/10 shadow-2xl bg-neutral-900">
                <img
                  src={coverUrl}
                  alt={`Bìa ${current.title}`}
                  className="size-full object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>
            </div>

            {/* Track Info */}
            <div className="mt-3 w-full max-w-xs text-center px-2">
              <h3 className="truncate text-base font-bold text-foreground tracking-tight" title={current.title}>
                {current.title}
              </h3>
              <p className="truncate text-xs text-muted-foreground mt-0.5">
                {current.artist} {album?.title ? `· ${album.title}` : ""}
              </p>
            </div>

            {/* Synchronized Word-by-word Karaoke Lyric Line */}
            <div className="mt-2 flex min-h-[2.5rem] w-full max-w-xs items-center justify-center rounded-xl bg-white/[0.03] border border-white/5 px-3 py-1.5 text-center text-xs leading-relaxed shadow-inner">
              {currentLine ? (
                <KaraokeLine line={currentLine} nextLineTime={nextLine?.time} time={time} />
              ) : (
                <span className="text-muted-foreground/60 italic text-[11px]">
                  {lines.length > 0 ? "· · ·" : "Bản thu không có tệp lời"}
                </span>
              )}
            </div>
          </>
        ) : (
          /* Full Lyrics Stream View */
          <div className="flex h-56 w-full flex-col gap-3 overflow-y-auto px-2 text-center [scrollbar-width:none]">
            {lines.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Bài hát này không có lời đồng bộ
              </div>
            ) : (
              lines.map((line, idx) => {
                const isActive = idx === activeLyricIdx;
                const isPast = idx < activeLyricIdx;
                return (
                  <button
                    key={`${line.time}-${idx}`}
                    type="button"
                    onClick={() => seek(line.time)}
                    className={cn(
                      "block w-full text-left transition-all duration-300 outline-none cursor-pointer",
                      isActive
                        ? "text-white font-bold text-sm scale-102 pl-2 border-l-2 border-primary"
                        : isPast
                          ? "text-white/45 text-xs hover:text-white/80"
                          : "text-white/30 text-xs hover:text-white/70",
                    )}
                  >
                    {isActive ? (
                      <KaraokeLine line={line} nextLineTime={lines[idx + 1]?.time} time={time} />
                    ) : (
                      <span>{line.text}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls Area */}
      <div className="relative z-10 w-full flex flex-col gap-2 pt-2 border-t border-white/5">
        {/* Interactive Seek Bar */}
        <div className="flex w-full items-center gap-2">
          <span className="w-9 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatTime(time)}
          </span>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={current.duration}
            aria-valuenow={time}
            onClick={handleSeek}
            className="group relative flex h-4 flex-1 items-center cursor-pointer"
          >
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 group-hover:h-2 transition-all">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-100 ease-linear shadow-[0_0_8px_var(--primary)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div
              className="absolute size-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1.5"
              style={{ left: `${progressPct}%` }}
            />
          </div>
          <span className="w-9 text-left font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatTime(current.duration)}
          </span>
        </div>

        {/* Transport Buttons */}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            title="Lùi 10 giây"
            onClick={() => seek(Math.max(0, time - 10))}
            className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-full hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Lùi 10 giây"
          >
            <RotateCcw className="size-3.5" />
          </button>

          <button
            type="button"
            title="Bài trước"
            onClick={() => prev()}
            className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-full hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Bài trước"
          >
            <SkipBack className="size-4" fill="currentColor" />
          </button>

          <button
            type="button"
            title={isPlaying ? "Tạm dừng" : "Phát"}
            onClick={toggle}
            className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-full shadow-lg shadow-primary/40 transition-transform active:scale-95 cursor-pointer hover:brightness-110"
            aria-label={isPlaying ? "Tạm dừng" : "Phát"}
          >
            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 translate-x-0.5" fill="currentColor" />}
          </button>

          <button
            type="button"
            title="Bài sau"
            onClick={() => next(true)}
            className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-full hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Bài sau"
          >
            <SkipForward className="size-4" fill="currentColor" />
          </button>

          <button
            type="button"
            title="Tiến 10 giây"
            onClick={() => seek(Math.min(current.duration, time + 10))}
            className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-full hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Tiến 10 giây"
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>

        {/* Volume Strip */}
        <div className="flex items-center justify-center gap-2 px-6">
          <button
            type="button"
            onClick={toggleMute}
            className="text-muted-foreground hover:text-foreground grid size-6 place-items-center transition-colors cursor-pointer"
            aria-label={isMuted ? "Bật tiếng" : "Tắt tiếng"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="size-3.5 text-destructive" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              if (isMuted && val > 0) toggleMute();
            }}
            className="h-1.5 flex-1 accent-primary bg-white/10 rounded-full cursor-pointer"
            aria-label="Âm lượng"
          />
          <span className="w-7 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {Math.round((isMuted ? 0 : volume) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
