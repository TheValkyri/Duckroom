import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePlayer, usePlayerTime } from "../../lib/player";

/**
 * PhoneCurrentLyricLine — dòng lời đang phát hiển thị ngay dưới title
 * trên phone (feedback: muốn "lời chạy trên player luôn").
 * LyricDisplay được React.memo để AnimatePresence và motion.p chỉ
 * chạy khi dòng lời thật sự đổi, 0 cost motion trên các timeupdate tick.
 */
const LyricDisplay = memo(function LyricDisplay({
  activeIdx,
  text,
}: {
  activeIdx: number;
  text: string;
}) {
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
          {activeIdx >= 0 && text ? text : "· · ·"}
        </motion.p>
      </AnimatePresence>
    </div>
  );
});

export function PhoneCurrentLyricLine() {
  const { current } = usePlayer();
  const time = usePlayerTime();
  const lines = current?.lyrics;

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
