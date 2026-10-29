import { memo, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePlayer, usePlayerTime, useSmoothLyricTime } from "../../lib/player";
import { computeWordTimings } from "../../lib/lyrics-formatter";
import { useTrackLyrics } from "../../lib/use-track-lyrics";
import type { LyricLine } from "../../data/library";
import { cn } from "../../lib/utils";

/**
 * Word-by-word Syllable Karaoke Flow for Phone Current Lyric
 */
const PhoneActiveWordFlow = memo(function PhoneActiveWordFlow({
  line,
  nextLineTime,
}: {
  line: LyricLine;
  nextLineTime?: number | undefined;
}) {
  const fallbackTime = usePlayerTime();
  const time = useSmoothLyricTime(fallbackTime);
  const words = useMemo(() => computeWordTimings(line, nextLineTime), [line, nextLineTime]);

  if (!words.length) {
    return <span className="text-foreground/90 font-medium">{line.text}</span>;
  }

  return (
    <span className="inline-flex flex-wrap justify-center gap-x-1.5 gap-y-0.5">
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
          <span key={`${idx}-${w.text}`} className="relative inline-block font-semibold">
            {/* Base text: real font glyphs, visible in all environments */}
            <span className={cn("inline-block", isPast ? "text-white font-semibold" : "text-white/45")}>{w.text}</span>

            {/* Active syllable fluid fill overlay */}
            {isSinging && (
              <span
                className="absolute inset-0 whitespace-nowrap text-white font-semibold select-none pointer-events-none"
                style={{
                  clipPath: `inset(-15% ${(100 - Number(pct)).toFixed(1)}% -15% 0)`,
                  WebkitClipPath: `inset(-15% ${(100 - Number(pct)).toFixed(1)}% -15% 0)`,
                  maskImage: `linear-gradient(90deg, #000 0%, #000 ${leadStart}%, transparent ${pct}%, transparent 100%)`,
                  WebkitMaskImage: `linear-gradient(90deg, #000 0%, #000 ${leadStart}%, transparent ${pct}%, transparent 100%)`,
                  textShadow: "none",
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

/**
 * PhoneCurrentLyricLine — dòng lời đang phát hiển thị ngay dưới title
 * trên phone (feedback: muốn "lời chạy trên player luôn").
 * LyricDisplay được React.memo để AnimatePresence và motion.p chỉ
 * chạy khi dòng lời thật sự đổi, 0 cost motion trên các timeupdate tick.
 */
const LyricDisplay = memo(function LyricDisplay({ activeIdx, text }: { activeIdx: number; text: string }) {
  const { current } = usePlayer();
  const { lines } = useTrackLyrics(current);
  const line = lines?.[activeIdx];
  const nextLineTime = lines?.[activeIdx + 1]?.time;

  return (
    <div
      className="relative mx-auto mt-2 flex h-10 max-w-[88%] items-center justify-center overflow-hidden"
      style={{
        WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
        maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
      }}
      aria-hidden
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={`${activeIdx}-${text}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="line-clamp-2 px-3 text-center text-[13px] font-medium leading-4 tracking-tight text-foreground/85"
        >
          {activeIdx >= 0 && line ? (
            <PhoneActiveWordFlow line={line} nextLineTime={nextLineTime} />
          ) : activeIdx >= 0 && text ? (
            text
          ) : (
            "· · ·"
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  );
});

export function PhoneCurrentLyricLine() {
  const { current } = usePlayer();
  const time = usePlayerTime();
  const { lines } = useTrackLyrics(current);

  if (!lines || lines.length === 0) return null;

  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && time >= l.time) activeIdx = i;
  }

  const line = lines[Math.max(0, activeIdx)];
  if (!line) return null;

  return <LyricDisplay activeIdx={activeIdx} text={line.text ?? ""} />;
}
