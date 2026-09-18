import { AnimatePresence, motion } from "motion/react";
import { usePlayer, usePlayerTime } from "../../lib/player";

/**
 * PhoneCurrentLyricLine — dòng lời đang phát hiển thị ngay dưới title
 * trên phone (feedback: muốn "lời chạy trên player luôn"). Subscriber DUY
 * NHẤT là time; active line được tính bằng binary search rồi setState CHỈ
 * khi index đổi (2-4 lần/phút) — không phải mỗi tick. CSS mask fade 2 bên,
 * đổi chữ bằng key AnimatePresence để dòng mới trượt nhẹ lên (có lý do:
 * người dùng theo dõi lời theo thời gian thực).
 */
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

  return (
    // Fix 2026-09-04 (feedback: "1 dòng canh giữa ổn, xuống dòng thì chữ
    // lệch/tụt xuống dưới, dài quá thì kì"): khung cũ h-8 top-aligned —
    // 1 dòng (16px leading-4) nằm trên đỉnh, 2 dòng chiếm trọn khít không
    // còn đệm → cảm giác chữ tụt. Giờ: khung cố định h-10 + FLEX CENTER
    // DỌC — 1 dòng lơ lửng giữa, 2 dòng (32px) vẫn còn 8px thở chia đều;
    // giữ chiều cao CỐ ĐỊNH để visualizer/seekbar bên dưới không nhảy
    // mỗi khi dòng lời đổi số dòng (no layout shift). Text dài: clamp 2
    // dòng + px-3 đệm ngang để dấu "…" không rơi vào vùng mask mờ 2 mép.
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
          key={`${activeIdx}-${line?.text ?? ""}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          // MOTION v2 2026-09-04: easeDuck expo ([0.16,1,0.3,1]) — dòng chữ
          // "đáp" lên dứt khoát rồi hãm mềm, cùng nhịp vật lý với lyrics
          // pane + scroll (feedback "làm ease vật lý, mượt hơn").
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="line-clamp-2 px-3 text-center text-[13px] font-medium leading-4 tracking-tight text-foreground/85"
        >
          {activeIdx >= 0 && line?.text ? line.text : "· · ·"}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
