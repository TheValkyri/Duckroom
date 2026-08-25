import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { applyLyricsOffset } from "../../lib/lyrics-formatter";
import { cn } from "../../lib/utils";

/**
 * Runtime lyrics offset storage (Master Plan §10.4).
 * Per-track global offset persisted locally; the stored LRC payload itself is
 * NEVER rewritten — offset is applied at display time only.
 */
const OFFSET_STORAGE_PREFIX = "duckroom.lyricsOffset.";
const OFFSET_STEP_MS = 200;
const OFFSET_LIMIT_MS = 10_000;

function readStoredOffset(trackId: string | undefined): number {
  if (!trackId || typeof window === "undefined" || !window.localStorage) return 0;
  try {
    const raw = window.localStorage.getItem(OFFSET_STORAGE_PREFIX + trackId);
    const parsed = raw ? Number.parseFloat(raw) : 0;
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, parsed));
  } catch {
    return 0;
  }
}

function writeStoredOffset(trackId: string | undefined, offsetMs: number): void {
  if (!trackId || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(OFFSET_STORAGE_PREFIX + trackId, String(offsetMs));
  } catch {
    // Storage unavailable (private mode/quota) — offset stays session-only.
  }
}

/**
 * Cuộn mượt tự viết (thay cho `scrollTo({behavior:"smooth"})` của trình duyệt).
 *
 * Native smooth-scroll phó mặc easing/tốc độ cho từng trình duyệt (Chrome,
 * Safari, Firefox mỗi nơi một khác) và quan trọng hơn: KHÔNG THỂ ngắt mượt
 * giữa chừng. Nếu dòng active đổi trước khi lần cuộn trước xong (bài nhịp
 * nhanh, nhiều dòng lyric sát nhau), trình duyệt giật thẳng sang đích mới.
 * Tự chạy bằng requestAnimationFrame cho phép hủy/nối animation đang chạy dở
 * mượt mà (interrupt-safe), đồng thời dùng chung easing "duck glide" với
 * toàn bộ app (xem lib/motion.ts -> easeDuck).
 */
function animateScrollTo(el: HTMLElement, target: number, duration = 520) {
  const start = el.scrollTop;
  const distance = target - start;
  if (Math.abs(distance) < 1) return () => {};

  const startTime = performance.now();
  let raf = 0;

  // ease-out cubic — khớp với "duck glide" easeDuck dùng trong lib/motion.ts
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    el.scrollTop = start + distance * ease(t);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(raf);
}

export function LyricsPane({ compact = false }: { compact?: boolean }) {
  const { current, seek } = usePlayer();
  const time = usePlayerTime();
  const originalLines = current?.lyrics ?? [];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const cancelScrollRef = useRef<() => void>(() => {});
  const isInitialMountRef = useRef(true);

  // §10.4 — global offset: display-time shift only, per-track persistence
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    setOffsetMs(readStoredOffset(current?.id));
  }, [current?.id]);

  // Fix 2026-08-25: pill chỉnh lệch lời tự ẩn khi rảnh (offset = 0 + không
  // hover) — trước đây chữ "Lời" đứng lơ lửng góc phải mãi mãi.
  const [pillVisible, setPillVisible] = useState(false);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPillTimer = () => {
    if (pillTimerRef.current) {
      clearTimeout(pillTimerRef.current);
      pillTimerRef.current = null;
    }
  };
  const showPill = () => {
    clearPillTimer();
    setPillVisible(true);
  };
  const schedulePillHide = () => {
    clearPillTimer();
    pillTimerRef.current = setTimeout(() => setPillVisible(false), 2200);
  };

  const updateOffsetMs = (next: number) => {
    const clamped = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, next));
    setOffsetMs(clamped);
    writeStoredOffset(current?.id, clamped);
    showPill();
    schedulePillHide();
  };

  const lines = useMemo(
    () => (offsetMs === 0 ? originalLines : applyLyricsOffset(originalLines, offsetMs)),
    [originalLines, offsetMs],
  );

  const activeIndex = useMemo(() => {
    let idx = -1;
    lines.forEach((l, i) => {
      if (time >= l.time) idx = i;
    });
    return idx;
  }, [lines, time]);

  const handleUserScroll = () => {
    isUserScrollingRef.current = true;
    cancelScrollRef.current(); // người dùng chủ động cuộn -> hủy animation tự động đang chạy dở
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 4500);
  };

  // Reset scroll to top when track changes
  useEffect(() => {
    isUserScrollingRef.current = false;
    isInitialMountRef.current = true;
    cancelScrollRef.current();
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [current?.id]);

  // Smoothly scroll active lyrics into center of view (tự viết, interrupt-safe, không trượt lại từ đầu khi mở lời)
  useEffect(() => {
    if (isUserScrollingRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    cancelScrollRef.current();

    if (activeIndex <= 0) {
      if (isInitialMountRef.current) {
        container.scrollTop = 0;
        isInitialMountRef.current = false;
      } else {
        cancelScrollRef.current = animateScrollTo(container, 0);
      }
    } else if (itemRefs.current[activeIndex]) {
      const el = itemRefs.current[activeIndex];
      if (el) {
        const elTop = el.offsetTop - container.offsetTop;
        const targetScroll = Math.max(0, elTop - container.clientHeight / 2.8);
        if (isInitialMountRef.current) {
          container.scrollTop = targetScroll;
          isInitialMountRef.current = false;
        } else {
          cancelScrollRef.current = animateScrollTo(container, targetScroll);
        }
      }
    }
  }, [activeIndex]);

  useEffect(() => () => cancelScrollRef.current(), []);
  useEffect(() => () => clearPillTimer(), []);

  if (!lines.length) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center p-8">
        <h4 className="font-display text-2xl md:text-3xl text-foreground/90">Bài hát này không có lời</h4>
        <p className="text-muted-foreground text-sm mt-2 max-w-sm">
          Bản thu này không có lời hát hoặc chưa gắn tệp lời đồng bộ (.LRC).
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden select-none", compact ? "h-64" : "h-full")}
      onMouseEnter={showPill}
      onMouseLeave={schedulePillHide}
      style={{
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
      }}
    >
      {/* §10.4 offset controls — positive = lyrics appear later; click value to reset.
          Auto-hide khi offset = 0 và không tương tác (fix chữ "Lời" đứng vĩnh viễn). */}
      <div
        className={cn(
          "absolute top-2 right-4 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-1.5 py-1 backdrop-blur-md transition-opacity duration-300",
          pillVisible || offsetMs !== 0 ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          title="Lời xuất hiện sớm hơn (−200ms)"
          onClick={() => updateOffsetMs(offsetMs - OFFSET_STEP_MS)}
          className="grid size-6 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          −
        </button>
        <button
          type="button"
          title="Đặt lại lệch thời gian về 0"
          onClick={() => updateOffsetMs(0)}
          className={cn(
            "min-w-[3.25rem] rounded-full px-1 py-0.5 text-center text-[11px] font-medium tabular-nums transition-colors",
            offsetMs === 0 ? "text-white/40" : "text-primary hover:bg-white/10",
          )}
        >
          {offsetMs === 0 ? "0.0s" : `${offsetMs > 0 ? "+" : ""}${(offsetMs / 1000).toFixed(1)}s`}
        </button>
        <button
          type="button"
          title="Lời xuất hiện muộn hơn (+200ms)"
          onClick={() => updateOffsetMs(offsetMs + OFFSET_STEP_MS)}
          className="grid size-6 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          +
        </button>
      </div>
      <motion.div
        key={current?.id || "lyrics-pane"}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="h-full w-full"
      >
        <div
          ref={containerRef}
          onWheel={handleUserScroll}
          onTouchMove={handleUserScroll}
          className="flex h-full flex-col gap-6 md:gap-7 overflow-y-auto pt-16 pb-48 px-4 md:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {lines.map((line, i) => {
            const isActive = i === activeIndex;
            const isPassed = i < activeIndex;

            return (
              <button
                key={`${line.time}-${i}`}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => {
                  isUserScrollingRef.current = false;
                  seek(line.time);
                }}
                className={cn(
                  // Identical font-bold geometry across ALL states to permanently prevent layout reflow/expansion
                  "text-left font-sans font-bold tracking-tight leading-snug md:leading-normal transition-all duration-300 transform-gpu cursor-pointer group block w-full outline-none antialiased",
                  "[text-wrap:balance] [text-wrap:pretty] break-words [word-break:keep-all]",
                  compact ? "text-base md:text-lg" : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                  isActive
                    ? "text-white opacity-100 scale-[1.02] origin-left"
                    : isPassed
                      ? "text-white/45 opacity-45 hover:text-white/85 hover:opacity-85 hover:scale-[1.01] origin-left"
                      : "text-white/20 opacity-25 hover:text-white/80 hover:opacity-80 hover:scale-[1.01] origin-left",
                )}
              >
                <span className="inline-block transition-all duration-300">{line.text}</span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
