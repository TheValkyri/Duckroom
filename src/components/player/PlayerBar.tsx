import { ChevronUp, ListMusic, Mic2, Play, SkipBack, SkipForward, Sparkles, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { albumById, formatTime } from "../../data/library";
import { fetchTrackArtworkUrl } from "../../lib/s3";
import { springGentle, springSnappy, tapScale, tweenFast } from "../../lib/motion";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { cn } from "../../lib/utils";
import { Visualizer } from "../Visualizer";
import { SeekBar, TransportControls } from "./Controls";
import { QueuePanel } from "./QueuePanel";
import { QueueSheet } from "./QueueSheet";
import { useIsPhoneLayout } from "../../hooks/use-media-query";

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
    next,
    prev,
  } = usePlayer();

  const [coverLoaded, setCoverLoaded] = useState(false);
  const isPhone = useIsPhoneLayout();

  if (!current) return null;
  const album = albumById(current.albumId);
  const fallbackCover =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect width='56' height='56' fill='%2318181b'/%3E%3C/svg%3E";
  const rawCover = current.cover || album?.cover;
  const coverUrl = rawCover && !rawCover.startsWith("blob:") ? rawCover : fallbackCover;

  return (
    <>
      {/* Queue surface: bottom sheet trên phone (touch-first), drawer giữ
          nguyên cho >=md. Cùng một usePlayer API — không nhân bản logic. */}
      <AnimatePresence>{queueOpen && isPhone && <QueueSheet />}</AnimatePresence>
      <AnimatePresence>{queueOpen && !isPhone && <QueuePanel />}</AnimatePresence>
      {/* Continue-Listening chip — PHONE (<lg): neo phía trên mini-player */}
      <AnimatePresence>
        {resumeHint && !isPlaying && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={tweenFast}
            className="fixed left-1/2 z-50 -translate-x-1/2 bottom-[calc(9.5rem+var(--safe-bottom))] lg:hidden"
          >
            <button
              onClick={() => {
                seek(resumeHint.positionSeconds);
                togglePlayback();
                clearResumeHint();
              }}
              className="glass-strong border-primary/30 text-foreground flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-3.5 py-1.5 shadow-lg cursor-pointer hover:border-primary/60 transition-colors"
              aria-label={`Phát tiếp từ vị trí ${formatTime(resumeHint.positionSeconds)}: ${current.title}`}
            >
              <ResumeChipLabel title={current.title} position={resumeHint.positionSeconds} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ MINI PLAYER (phone <md) — stacked dock, safe-area ============
          Dock nằm TRÊN bottom nav: bottom = nav (3.5rem) + gesture bar
          (safe-area). Không dùng bottom-safe ở đây vì utility đó ghi đè
          thuộc tính `bottom` (bắt được bằng QA overlap-check thực tế). */}
      <motion.footer
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={springGentle}
        className="glass border-border fixed inset-x-0 bottom-[calc(3.5rem+var(--safe-bottom))] z-40 border-t lg:hidden"
        aria-label="Trình phát thu nhỏ"
      >
        {/* Read-only progress strip — seek đầy đủ ở player mở rộng, tránh
            seek nhầm trên dải 2px. Isolated subscriber: chỉ strip này re-render. */}
        <MiniProgressStrip />
        <div
          className="flex h-16 items-center gap-2 px-2"
          role="button"
          tabIndex={0}
          aria-label={`Mở trình phát toàn màn hình: ${current.title}`}
          onClick={() => setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded(true);
            }
          }}
        >
          <span className="group relative size-12 shrink-0 overflow-hidden rounded-lg bg-card/60 border border-white/5">
            {!coverLoaded && (
              <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            )}
            {/* alt="" — ảnh chỉ trang trí; tên bài hiển thị ngay cạnh đó */}
            <img
              src={coverUrl}
              alt=""
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
                "size-full object-cover transition-all duration-500",
                coverLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
              )}
              width={48}
              height={48}
            />
            <span className="bg-background/60 absolute inset-0 grid place-items-center opacity-60">
              <ChevronUp className="size-5" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{current.title}</span>
            <span className="text-muted-foreground block truncate text-xs">{current.artist}</span>
          </span>
          {/* Transport — đúng thứ tự chuẩn: PREV → PLAY → NEXT
              (feedback: trước đây play nằm trước prev = lệch bố cục).
              44px touch targets; stopPropagation để không expand. */}
          <motion.button
            aria-label="Bài trước"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground hover:text-foreground grid size-11 shrink-0 place-items-center rounded-full transition-colors cursor-pointer"
          >
            <SkipBack className="size-5" fill="currentColor" />
          </motion.button>
          <motion.button
            aria-label={isPlaying ? "Tạm dừng" : "Phát"}
            onClick={(e) => {
              e.stopPropagation();
              togglePlayback();
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="grid size-11 shrink-0 place-items-center rounded-full cursor-pointer"
          >
            <span className="bg-primary text-primary-foreground grid size-11 place-items-center rounded-full shadow-[0_8px_30px_-8px_oklch(0.76_0.14_66/0.7)]">
              {isPlaying ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5 translate-x-px" />}
            </span>
          </motion.button>
          <motion.button
            aria-label="Bài sau"
            onClick={(e) => {
              e.stopPropagation();
              next(true);
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground hover:text-foreground grid size-11 shrink-0 place-items-center rounded-full transition-colors cursor-pointer"
          >
            <SkipForward className="size-5" fill="currentColor" />
          </motion.button>
        </div>
      </motion.footer>

      {/* ============ DESKTOP PLAYER BAR (>=lg) — giữ nguyên cấu trúc ============ */}
      <motion.footer
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={springGentle}
        className="glass border-border fixed inset-x-0 bottom-0 z-40 hidden border-t lg:block"
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

          {/* DESKTOP resume chip — NGỒI TRONG footer (absolute), nổi lên
              mép trên phải của bar. Không bao giờ dính content phía trên
              vì nó là một phần của bar; tự ẩn khi play. */}
          <AnimatePresence>
            {resumeHint && !isPlaying && (
              <motion.button
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 6, opacity: 0 }}
                transition={tweenFast}
                onClick={() => {
                  seek(resumeHint.positionSeconds);
                  togglePlayback();
                  clearResumeHint();
                }}
                className="glass-strong border-primary/30 text-foreground absolute -top-4 right-6 z-10 flex max-w-xs items-center gap-2 rounded-full border px-3.5 py-1.5 shadow-lg cursor-pointer hover:border-primary/60 transition-colors"
                aria-label={`Phát tiếp từ vị trí ${formatTime(resumeHint.positionSeconds)}: ${current.title}`}
              >
                <ResumeChipLabel title={current.title} position={resumeHint.positionSeconds} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.footer>
    </>
  );
}

/** Nội dung chip resume dùng chung phone/desktop (giữ 2 vị trí đồng bộ UI). */
function ResumeChipLabel({ title, position }: { title: string; position: number }) {
  return (
    <>
      <span className="bg-primary grid size-4 shrink-0 place-items-center rounded-full">
        <Play className="text-primary-foreground size-2.5" fill="currentColor" />
      </span>
      <span className="truncate text-xs font-medium">
        Tiếp tục <strong className="text-primary">{title}</strong>
        <span className="text-muted-foreground"> · {formatTime(position)}</span>
      </span>
    </>
  );
}

/** Play/Pause glyphs cho mini-player (giữ icon vuông vức như TransportControls). */
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14Z" />
    </svg>
  );
}
function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

/**
 * Dải tiến trình 2px của mini-player — subscriber riêng để toàn bộ dock
 * không re-render theo timeupdate (cùng pattern PlayerBarElapsedLabel).
 */
function MiniProgressStrip() {
  const { current } = usePlayer();
  const time = usePlayerTime();
  const duration = current?.duration || 1;
  const pct = Math.min(100, Math.max(0, (time / duration) * 100));
  return (
    <div className="h-0.5 w-full bg-muted/60" aria-hidden>
      <div className="bg-primary h-full rounded-r-full" style={{ width: `${pct}%` }} />
    </div>
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
