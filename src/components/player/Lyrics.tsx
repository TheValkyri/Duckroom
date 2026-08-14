import { useEffect, useMemo, useRef } from "react";
import { usePlayer } from "../../lib/player";
import { cn } from "../../lib/utils";

export function LyricsPane({ compact = false }: { compact?: boolean }) {
  const { current, time, seek } = usePlayer();
  const lines = current?.lyrics ?? [];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);

  const activeIndex = useMemo(() => {
    let idx = -1;
    lines.forEach((l, i) => {
      if (time >= l.time) idx = i;
    });
    return idx;
  }, [lines, time]);

  const handleUserScroll = () => {
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 4500);
  };

  // Reset scroll to top when track changes
  useEffect(() => {
    isUserScrollingRef.current = false;
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "instant" as any });
    }
  }, [current?.id]);

  // Smoothly scroll active lyrics to center of view with fluid animation
  useEffect(() => {
    if (isUserScrollingRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    if (activeIndex <= 0) {
      container.scrollTo({ top: 0, behavior: "smooth" });
    } else if (itemRefs.current[activeIndex]) {
      const el = itemRefs.current[activeIndex];
      if (el) {
        const elTop = el.offsetTop - container.offsetTop;
        const targetScroll = elTop - container.clientHeight / 2.8;
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: "smooth",
        });
      }
    }
  }, [activeIndex]);

  if (!lines.length) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center p-8">
        <h4 className="font-display text-2xl md:text-3xl text-foreground/90">
          Bài hát này không có lời
        </h4>
        <p className="text-muted-foreground text-sm mt-2 max-w-sm">
          Bản thu này không có lời hát hoặc chưa gắn tệp lời đồng bộ (.LRC).
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden select-none",
        compact ? "h-64" : "h-full"
      )}
      style={{
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
      }}
    >
      <div
        ref={containerRef}
        onWheel={handleUserScroll}
        onTouchMove={handleUserScroll}
        className="flex h-full flex-col gap-6 md:gap-8 overflow-y-auto pt-16 pb-48 px-4 md:px-8 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
                "text-left font-sans tracking-tight leading-snug md:leading-normal transition-all duration-500 ease-out transform-gpu cursor-pointer group block w-full outline-none",
                // Balanced and pretty text wrapping to eliminate orphan words / awkward line breaks
                "[text-wrap:balance] [text-wrap:pretty] break-words [word-break:keep-all]",
                compact
                  ? "text-base md:text-lg"
                  : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                isActive
                  ? "text-white font-bold opacity-100 scale-[1.02] origin-left translate-x-2 drop-shadow-[0_0_24px_rgba(255,255,255,0.45)] blur-0"
                  : isPassed
                  ? "text-white/45 font-medium opacity-50 scale-100 blur-[0.2px] hover:opacity-90 hover:text-white/90 hover:blur-0"
                  : "text-white/30 font-medium opacity-35 scale-[0.98] blur-[0.4px] hover:opacity-85 hover:text-white/85 hover:blur-0",
              )}
            >
              <span className="inline-block transition-colors duration-300">
                {line.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}