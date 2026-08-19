import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { cn } from "../../lib/utils";

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
  const lines = current?.lyrics ?? [];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const cancelScrollRef = useRef<() => void>(() => {});
  const isInitialMountRef = useRef(true);

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
      style={{
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
      }}
    >
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
