import { ChevronUp, ListMusic, Mic2, Sparkles, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { albumById, formatTime } from "../../data/library";
import { fetchTrackArtworkUrl } from "../../lib/s3";
import { springGentle, springSnappy, tapScale } from "../../lib/motion";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { cn } from "../../lib/utils";
import { Visualizer } from "../Visualizer";
import { SeekBar, TransportControls } from "./Controls";
import { QueuePanel } from "./QueuePanel";

export function PlayerBar() {
  const {
    current,
    isPlaying,
    volume,
    isMuted,
    setVolume,
    toggleMute,
    crossfade,
    setCrossfade,
    expanded,
    setExpanded,
    lyricsOpen,
    setLyricsOpen,
    queueOpen,
    setQueueOpen,
    resumeHint,
    clearResumeHint,
    seek,
    toggle: togglePlayback,
  } = usePlayer();

  const [coverLoaded, setCoverLoaded] = useState(false);

  if (!current) return null;
  const album = albumById(current.albumId);
  const fallbackCover =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect width='56' height='56' fill='%2318181b'/%3E%3C/svg%3E";
  const rawCover = current.cover || album?.cover;
  const coverUrl = rawCover && !rawCover.startsWith("blob:") ? rawCover : fallbackCover;

  return (
    <>
      <AnimatePresence>{queueOpen && <QueuePanel />}</AnimatePresence>
      {/* Continue-Listening pill (Phase 5.2): restored track loaded paused. */}
      <AnimatePresence>
        {resumeHint && !isPlaying && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springSnappy}
            className="glass border-border fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-xl"
          >
            <span className="text-muted-foreground text-xs">
              Tiếp tục nghe <strong className="text-foreground">{current.title}</strong>?
            </span>
            <button
              onClick={() => {
                seek(resumeHint.positionSeconds);
                togglePlayback();
                clearResumeHint();
              }}
              className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-semibold cursor-pointer"
            >
              Phát tiếp
            </button>
            <button
              onClick={clearResumeHint}
              aria-label="Đóng gợi ý tiếp tục nghe"
              className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.footer
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={springGentle}
        className="glass border-border fixed inset-x-0 bottom-0 z-40 border-t"
      >
        <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-8 py-3">
          {/* Left: Track Info & Cover (Stretched to far left) */}
          <div className="flex min-w-0 items-center gap-3 justify-start">
            <button
              onClick={() => setExpanded(true)}
              className="group relative size-14 shrink-0 overflow-hidden rounded-lg bg-card/60 cursor-pointer border border-white/5"
              aria-label="Mở toàn màn hình"
            >
              {!coverLoaded && (
                <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              )}
              <img
                src={coverUrl}
                alt={`Bìa album ${album?.title || current.title}`}
                decoding="async"
                onLoad={() => setCoverLoaded(true)}
                onError={async (e) => {
                  const target = e.currentTarget;
                  if (current?.id) {
                    try {
                      const fresh = await fetchTrackArtworkUrl(current.id);
                      if (fresh && fresh !== target.src) {
                        target.src = fresh;
                        setCoverLoaded(true);
                        return;
                      }
                    } catch {
                      // fallback below
                    }
                  }
                  if (target.src !== fallbackCover) {
                    target.src = fallbackCover;
                  }
                  setCoverLoaded(true);
                }}
                className={cn(
                  "size-full object-cover transition-all duration-500 group-hover:scale-105",
                  coverLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
                )}
                width={56}
                height={56}
              />
              <span className="bg-background/60 absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                <ChevronUp className="size-5" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{current.title}</p>
              <p className="text-muted-foreground truncate text-xs">
                {current.artist} · {album?.title}
              </p>
            </div>
            <span className="border-border text-primary ml-2 hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] tracking-wide lg:block">
              {current.format} {current.bitDepth}/{current.sampleRate}
            </span>
          </div>

          {/* Center: Controls & WIDER Progress Bar */}
          <div className="flex w-[38vw] max-w-2xl min-w-[280px] flex-col items-center">
            <TransportControls />
            <div className="flex w-full items-center gap-3 mt-0.5">
              <PlayerBarElapsedLabel />
              <div className="flex-1">
                <SeekBar compact />
              </div>
              <span className="text-muted-foreground w-10 text-[11px] tabular-nums">
                {formatTime(current.duration)}
              </span>
            </div>
          </div>

          {/* Right: Controls & Volume (Stretched to far right) */}
          <div className="flex items-center justify-end gap-3 min-w-0">
            <div className="hidden h-6 w-24 shrink-0 items-center overflow-hidden xl:flex">
              <Visualizer playing={isPlaying} bars={18} height={24} className="size-full" />
            </div>
            <motion.button
              aria-label="Hòa âm Crossfade"
              title={`Hòa trộn bài (Crossfade): ${
                crossfade > 0 ? `${crossfade} giây (Studio Equal-Power Mix)` : "Đang tắt (Nhấn để bật 10s)"
              }`}
              onClick={() => {
                const presets = [10, 7, 5, 3, 0];
                const curIdx = presets.indexOf(crossfade);
                const nextVal = presets[(curIdx + 1) % presets.length] ?? 0;
                setCrossfade(nextVal);
              }}
              whileTap={tapScale}
              whileHover={{ y: -1 }}
              transition={springSnappy}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-white/10 cursor-pointer shadow-sm",
                crossfade > 0
                  ? "text-amber-400 border-amber-500/40 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                  : "hover:bg-accent/50",
              )}
            >
              <Sparkles className={cn("size-3.5", crossfade > 0 && "text-amber-400 animate-pulse")} />
              <span className="hidden sm:inline font-mono">{crossfade > 0 ? `${crossfade}s` : "Mix Off"}</span>
            </motion.button>
            <motion.button
              aria-label="Lời bài hát"
              title={lyricsOpen ? "Ẩn lời bài hát" : "Xem lời bài hát"}
              onClick={() => {
                if (!expanded) {
                  setExpanded(true);
                  setLyricsOpen(true);
                } else {
                  setLyricsOpen(!lyricsOpen);
                }
              }}
              whileTap={tapScale}
              whileHover={{ y: -1 }}
              transition={springSnappy}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1.5 rounded-full hover:bg-accent/50",
                lyricsOpen && expanded && "text-primary bg-primary/10",
              )}
            >
              <Mic2 className="size-4" />
            </motion.button>
            <motion.button
              aria-label="Hàng đợi"
              onClick={() => setQueueOpen(!queueOpen)}
              whileTap={tapScale}
              whileHover={{ y: -1 }}
              transition={springSnappy}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1.5 rounded-full hover:bg-accent/50",
                queueOpen && "text-primary bg-primary/10",
              )}
            >
              <ListMusic className="size-4" />
            </motion.button>
            <VolumeBar />
          </div>
        </div>
      </motion.footer>
    </>
  );
}

/**
 * Perf fix 2026-08-25: label thời gian trôi được tách ra component riêng.
 * Trước đây PlayerBar gọi usePlayerTime() ở top-level → toàn bộ footer
 * (~20 nút motion + Visualizer + cover) re-render 4-60 lần/giây theo
 * timeupdate, chiếm main thread liên tục và làm MỌI tương tác (kể cả click
 * sidebar) bị khựng. Giờ chỉ node chữ này re-render mỗi tick.
 */
function PlayerBarElapsedLabel() {
  const time = usePlayerTime();
  return <span className="text-muted-foreground w-10 text-right text-[11px] tabular-nums">{formatTime(time)}</span>;
}

function VolumeBar() {
  const { volume, isMuted, setVolume, toggleMute } = usePlayer();
  const [isDragging, setIsDragging] = useState(false);
  const currentVol = isMuted ? 0 : volume;
  const pct = Math.min(100, Math.max(0, currentVol * 100));

  return (
    <div className="hidden items-center gap-2 md:flex">
      <motion.button
        onClick={toggleMute}
        aria-label={isMuted ? "Bật âm thanh" : "Tắt âm thanh"}
        whileTap={tapScale}
        transition={springSnappy}
        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {isMuted || volume === 0 ? <VolumeX className="size-4 text-destructive" /> : <Volume2 className="size-4" />}
      </motion.button>
      <div
        className="group relative flex h-6 w-24 items-center select-none cursor-pointer"
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
          <div
            className={cn(
              "h-full rounded-full bg-primary",
              isDragging ? "transition-none" : "transition-[width] duration-75 ease-out",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md",
            isDragging
              ? "scale-125 opacity-100 transition-none"
              : "opacity-0 group-hover:scale-125 group-hover:opacity-100 transition-all duration-150",
          )}
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={currentVol}
          aria-label="Âm lượng"
          onChange={(e) => setVolume(Number(e.target.value))}
          className="absolute inset-0 size-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}
