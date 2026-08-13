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
    }, 4000);
  };

  // Reset scroll to top when track changes
  useEffect(() => {
    isUserScrollingRef.current = false;
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "instant" as any });
    }
  }, [current?.id]);

  // Smoothly scroll active lyrics into view
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
        const targetScroll = elTop - container.clientHeight / 3;
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: "smooth",
        });
      }
    }
  }, [activeIndex]);

  if (!lines.length) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center p-6">
        <h4 className="font-display text-2xl md:text-3xl text-foreground">
          Bài hát này không có lời
        </h4>
        <p className="text-muted-foreground text-sm mt-2 max-w-xs">
          Bản thu này không có lời hát hoặc chưa gắn tệp lời đồng bộ (.LRC).
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", compact ? "h-64" : "h-full")}
      style={{
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 10%, black 85%, transparent 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 10%, black 85%, transparent 100%)",
      }}
    >
      <div
        ref={containerRef}
        onWheel={handleUserScroll}
        onTouchMove={handleUserScroll}
        className="flex h-full flex-col gap-6 overflow-y-auto pt-6 pb-32 px-4 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {lines.map((line, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => {
                isUserScrollingRef.current = false;
                seek(line.time);
              }}
              className={cn(
                "text-left font-display leading-tight transition-all duration-300 transform-gpu cursor-pointer select-none",
                compact ? "text-lg md:text-xl" : "text-2xl md:text-3xl lg:text-4xl",
                isActive
                  ? "text-foreground font-bold opacity-100 scale-100 translate-x-2 drop-shadow-[0_2px_16px_rgba(255,255,255,0.3)]"
                  : "text-muted-foreground/45 font-normal opacity-30 scale-[0.96] hover:opacity-75 hover:scale-[0.98]",
              )}
            >
              {line.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}