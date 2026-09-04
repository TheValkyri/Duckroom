import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { usePlayer, usePlayerTime, usePlayerTimeSnapshot } from "../../lib/player";
import { applyLyricsOffset } from "../../lib/lyrics-formatter";
import { cn } from "../../lib/utils";
import type { LyricLine } from "../../data/library";

/** Dùng nội bộ cho memo dependency ổn định của LyricsPane. */
type LyricLineView = LyricLine;

/**
 * Runtime lyrics offset storage (Master Plan §10.4).
 * Per-track global offset persisted locally; the stored LRC payload itself is
 * NEVER rewritten — offset is applied at display time only.
 */
const OFFSET_STORAGE_PREFIX = "duckroom.lyricsOffset.";
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
 *
 * MOTION v2 (2026-09-04 — feedback "animation lyric không smooth, muốn ease
 * vật lý hơn"): 2 thay đổi về CHẤT vật lý, không thêm hiệu ứng:
 * 1. Easing: cubic-out (đổ dốc nhanh, chậm đều ở cuối) → EXPO-OUT
 *    1 - 2^(-10t) đúng họ với easeDuck [0.16,1,0.3,1] nhưng tính s�� bằng
 *    SIMD-free math nên mỗi frame rẻ hơn. Quan trọng nhất: expo-out có
 *    ĐẦU VẬN TỐC CAO (vào chuyển động NGAY — 20% đầu đi ~50% quãng) rồi
 *    hãm dần rất muộn — đúng cảm giác "vật nặng trôi theo quán tính",
 *    hết cảm giác cubic-out "chùng" ở nửa sau.
 * 2. Duration THÍCH ỨNG quãng đường (400–640ms): cuộn xa chậm hơn chút,
 *    cuộn gần nhanh hơn — cùng một gia tốc cảm nhận (perceptual
 *    uniformity) thay vì 520ms cứng cho mọi quãng → dòng lyric sát nhau
 *    (bài nhanh) không trôi lười, dòng cách xa vẫn kịp.
 */
function animateScrollTo(el: HTMLElement, target: number, maxDuration = 640) {
  const start = el.scrollTop;
  const distance = target - start;
  if (Math.abs(distance) < 1) return () => {};

  // Duration theo quãng: 400ms cho ~120px (1 dòng), vèo tối đa 640ms cho
  // cuộn xa (seek). Sensory scaling sqrt — cảm giác tuyến tính cho mắt.
  const duration = Math.min(maxDuration, 400 + Math.sqrt(Math.abs(distance)) * 12);
  const startTime = performance.now();
  let raf = 0;

  // EXPO-OUT — "duck glide" vật lý: khởi động dứt khoát, hãm mềm muộn.
  // Phân mảnh an toàn cho t lớn (2^-10 lớn hơn mọi số double dương).
  const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    el.scrollTop = start + distance * ease(t);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(raf);
}

/* ---------------------------------------------------------------------------
 * PERF 2026-09-01 — lyric line class constants.
 * Trước đây mỗi tick timeupdate re-render CẢ danh sách (54+ <button> qua
 * React) chỉ để đổi màu 2 dòng. Giờ các class được tính 1 lần, component
 * cha KHÔNG subscribe time; một <LyricsTicker> nhỏ duy nhất subscribe và
 * cập nhật classList trực tiếp trên 2 node cũ/mới — không React re-render
 * nào trong lúc bài chạy. 0 layout thrash, scroll vẫn auto-center.
 *
 * MOTION v2 2026-09-04: transition-ALL → transition đúng 3 thứ thực sự
 * đổi trạng thái ([color,opacity,transform]). `all` khiến browser theo
 * dõi mọi property (kể cả layout-adjacent) mỗi frame — trên phone đó là
 * style-recalc thừa mỗi dòng active đổi. Ease expo [0.16,1,0.3,1] =
 * easeDuck app-wide + duration 340ms khớp nhịp scroll mới.
 * ------------------------------------------------------------------------ */
const LINE_BASE =
  "text-left font-sans font-bold tracking-tight leading-snug md:leading-normal [transition:color_340ms_cubic-bezier(0.16,1,0.3,1),opacity_340ms_cubic-bezier(0.16,1,0.3,1),transform_340ms_cubic-bezier(0.16,1,0.3,1)] transform-gpu cursor-pointer group block w-full outline-none antialiased [text-wrap:balance] [text-wrap:pretty] break-words [word-break:keep-all]";
const LINE_ACTIVE = "text-white opacity-100 scale-[1.02] origin-left";
const LINE_PASSED = "text-white/45 opacity-45 hover:text-white/85 hover:opacity-85 hover:scale-[1.01] origin-left";
const LINE_FUTURE = "text-white/20 opacity-25 hover:text-white/80 hover:opacity-80 hover:scale-[1.01] origin-left";

function lineClass(i: number, activeIndex: number): string {
  if (i === activeIndex) return LINE_ACTIVE;
  if (i < activeIndex) return LINE_PASSED;
  return LINE_FUTURE;
}

export function LyricsPane({ compact = false }: { compact?: boolean }) {
  const { current, seek } = usePlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const cancelScrollRef = useRef<() => void>(() => {});
  const isInitialMountRef = useRef(true);
  /** Vị trí active HIỆN TẠI trên DOM — để ticker chỉ đụng 2 node đổi trạng thái. */
  const activeIndexRef = useRef(-1);

  // §10.4 — global offset: display-time shift only, per-track persistence.
  // Fix 2026-08-25: pill UI chỉnh offset (− / giá trị / +) đã bị XÓA SẠCH theo
  // yêu cầu — không còn bất kỳ control nào trên pane lời. Offset đã lưu trong
  // localStorage (nếu có) vẫn được áp dụng khi hiển thị.
  const [offsetMs, setOffsetMs] = useState(0);
  const trackId = current?.id;
  useEffect(() => {
    setOffsetMs(readStoredOffset(trackId));
  }, [trackId]);

  // Stabilize mảng lines cho useMemo: `current?.lyrics ?? []` tạo array mới
  // mỗi render khi không có lời → useMemo bên dưới chạy lại vô nghĩa.
  const emptyLines = useMemo<LyricLineView[]>(() => [], []);
  const originalLines = current?.lyrics ?? emptyLines;
  const lines = useMemo(
    () => (offsetMs === 0 ? originalLines : applyLyricsOffset(originalLines, offsetMs)),
    [originalLines, offsetMs],
  );

  // Active index KHÔNG nằm trong state của pane — ticker quản qua ref và
  // class trực tiếp. Giá trị khởi tạo -1 (chưa có dòng nào active);
  // render đầu bù bằng initialActive (xem dưới) để không flash FUTURE.

  const handleUserScroll = () => {
    isUserScrollingRef.current = true;
    cancelScrollRef.current(); // người dùng chủ động cuộn -> hủy animation tự động đang chạy dở
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 4500);
  };

  // Reset scroll to top when track changes + khôi phục active đầu tiên
  useEffect(() => {
    isUserScrollingRef.current = false;
    isInitialMountRef.current = true;
    const prev = activeIndexRef.current;
    activeIndexRef.current = -1;
    cancelScrollRef.current();
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    // Đổi bài: mọi dòng về FUTURE (trừ dòng active lúc t=0 nếu có — ticker
    // sẽ tự bắt ở tick đầu, nên ở đây chỉ reset visual state).
    const items = itemRefs.current;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (el && el.dataset["base"]) el.className = `${el.dataset["base"]} ${i < prev ? LINE_PASSED : LINE_FUTURE}`;
    }
  }, [current?.id]);

  /* WP2 2026-09-04 (feedback "lyric chớp chớp khi mở sheet giữa bài"):
   * render đầu của DANH SÁCH sau khi track đổi (hoặc sau khi sheet mở lại)
   * từng vẽ MỌI dòng ở FUTURE rồi chờ ticker tick kế tiếp mới tô ACTIVE
   * → 1 frame "nhá" sai. Đọc time MỘT LẦN (snapshot, không subscribe —
   * pane vẫn không re-render theo tick) và tính active-index ngay trong
   * render để frame đầu tiên đã đúng trạng thái; ticker sau đó vẫn là
   * nguồn chân giá trị theo tick — không đổi kiến trúc subscriber-riêng
   * của pane. */
  const timeNow = usePlayerTimeSnapshot();
  const initialActive = activeIndexRef.current < 0 ? activeFromTime(lines, timeNow) : -2;

  const scrollActiveIntoView = (idx: number) => {
    const container = containerRef.current;
    if (!container) return;
    cancelScrollRef.current();
    const el = itemRefs.current[idx];
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
  };

  useEffect(() => () => cancelScrollRef.current(), []);

  if (!lines.length) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center text-center p-8",
          compact ? "h-full min-h-[240px]" : "h-full min-h-[320px]",
        )}
      >
        <h4 className="font-display text-xl md:text-3xl text-foreground/90 sm:text-2xl">Bài hát này không có lời</h4>
        <p className="text-muted-foreground text-sm mt-2 max-w-sm">
          Bản thu này không có lời hát hoặc chưa gắn tệp lời đồng bộ (.LRC).
        </p>
      </div>
    );
  }

  // `compact` = chế độ phone: phủ toàn bộ container (NowPlaying stage), font
  // nhỏ hơn chút cho mật độ dòng hợp lý trên màn hẹp. Desktop giữ cỡ lớn.
  return (
    <div
      className={cn("relative h-full w-full overflow-hidden select-none")}
      style={{
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)",
      }}
    >
      <motion.div
        key={current?.id || "lyrics-pane"}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        // MOTION v2: easeDuck expo thay easeOut generic — cùng họ đường cong
        // với scroll + line transitions mới (đồng bộ "nhịp" toàn pane).
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="h-full w-full"
      >
        <div
          ref={containerRef}
          onWheel={handleUserScroll}
          onTouchMove={handleUserScroll}
          className="flex h-full flex-col gap-5 sm:gap-6 md:gap-7 overflow-y-auto pt-10 sm:pt-16 pb-32 px-4 md:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {lines.map((line, i) => (
            <button
              key={`${line.time}-${i}`}
              ref={(el) => {
                itemRefs.current[i] = el;
                if (el)
                  el.dataset["base"] = cn(
                    LINE_BASE,
                    compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                  );
              }}
              onClick={() => {
                isUserScrollingRef.current = false;
                seek(line.time);
              }}
              className={cn(
                LINE_BASE,
                // -2 = danh sách render lần sau (state settled) — giữ ref
                // value (đã đúng); giá trị 0..n từ initialActive chỉ dùng ở
                // frame đầu để tránh "flash FUTURE".
                lineClass(i, initialActive === -2 ? activeIndexRef.current : initialActive),
                compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
              )}
            >
              {/* Span con: KHÔNG transition-all (feedback "nhồi hiệu ứng");
                  inherit transition từ cha là đủ — text chỉ đổi màu. */}
              <span className="inline-block">{line.text}</span>
            </button>
          ))}
        </div>
      </motion.div>
      {/* Ticker: subscriber DUY NHẤT của time trong pane. On active-line
          change → cập nhật classList 2 node + auto-center. Không setState
          ở cấp pane → danh sách không bao giờ re-render theo tick. */}
      <LyricsTicker
        lines={lines}
        itemRefs={itemRefs}
        activeIndexRef={activeIndexRef}
        isUserScrollingRef={isUserScrollingRef}
        onActiveChange={(idx) => {
          if (isUserScrollingRef.current) return;
          if (idx <= 0) {
            const c = containerRef.current;
            if (!c) return;
            if (isInitialMountRef.current) {
              c.scrollTop = 0;
              isInitialMountRef.current = false;
            } else {
              cancelScrollRef.current = animateScrollTo(c, 0);
            }
          } else {
            scrollActiveIntoView(idx);
          }
        }}
      />
    </div>
  );
}

function activeFromTime(lines: LyricLineView[], time: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && time >= l.time) idx = i;
  }
  return idx;
}

/** Đổi class trực tiếp giữa node active cũ ↔ mới (không React re-render).
 *  Mỗi node giữ phần class "base + cỡ chữ" trong data-base khi render;
 *  ticker chỉ nối thêm state class — không bao giờ mất cỡ chữ compact. */
function applyActiveClasses(items: (HTMLButtonElement | null)[], prev: number, next: number) {
  const setCls = (i: number, cls: string) => {
    const el = items[i];
    if (!el || !el.dataset["base"]) return;
    el.className = `${el.dataset["base"]} ${cls}`;
  };
  if (prev >= 0) setCls(prev, prev < next ? LINE_PASSED : LINE_FUTURE);
  if (next >= 0) setCls(next, LINE_ACTIVE);
}

/**
 * LyricsTicker — cách ly re-render theo tick (PERF 2026-09-01).
 * Trước đây: LyricsPane subscribe usePlayerTime → mỗi timeupdate (4–15/s)
 * re-render 54+ buttons chỉ để đổi màu 2 dòng (React diff toàn bộ list).
 * Giờ: component RỖNG này subscribe time, và chỉ khi active INDEX đổi mới
 * gọi classList updates trực tiếp. Render count khi phát = 0.
 * Tự tắt khi không có lời hoặc tab ẩn (rAF không chạy — dùng timeupdate
 * store, rẻ hơn nhiều so với rAF polling).
 */
function LyricsTicker({
  lines,
  itemRefs,
  activeIndexRef,
  isUserScrollingRef,
  onActiveChange,
}: {
  lines: LyricLineView[];
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  activeIndexRef: React.RefObject<number>;
  isUserScrollingRef: React.RefObject<boolean>;
  onActiveChange: (idx: number) => void;
}) {
  const time = usePlayerTime();
  useEffect(() => {
    const next = activeFromTime(lines, time);
    const prev = activeIndexRef.current ?? -1;
    if (next === prev) return;
    applyActiveClasses(itemRefs.current ?? [], prev, next);
    activeIndexRef.current = next;
    onActiveChange(next);
  }, [time, lines, itemRefs, activeIndexRef, isUserScrollingRef, onActiveChange]);
  return null;
}
