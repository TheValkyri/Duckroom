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

  // Smoothly scroll active lyrics into center of view without jitter
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
        className="flex h-full flex-col gap-6 md:gap-7 overflow-y-auto pt-16 pb-48 px-4 md:px-8 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
                "text-left font-sans font-bold tracking-tight leading-snug md:leading-normal transition-all duration-300 transform-gpu cursor-pointer group block w-full outline-none antialiased subpixel-antialiased",
                "[text-wrap:balance] [text-wrap:pretty] break-words [word-break:keep-all]",
                compact
                  ? "text-base md:text-lg"
                  : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                isActive
                  ? "text-white opacity-100"
                  : isPassed
                  ? "text-white/45 opacity-45 hover:text-white/85 hover:opacity-85"
                  : "text-white/20 opacity-25 hover:text-white/80 hover:opacity-80",
              )}
            >
              <span className="inline-block transition-colors duration-200">
                {line.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}