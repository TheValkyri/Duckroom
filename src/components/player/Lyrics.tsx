import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  usePlayer,
  usePlayerTime,
  usePlayerTimeSnapshot,
  useGetPlayerTime,
  useSmoothLyricTime,
} from "../../lib/player";
import { computeWordTimings } from "../../lib/lyrics-formatter";
import { useTrackLyrics } from "../../lib/use-track-lyrics";
import { cn } from "../../lib/utils";
import type { LyricLine } from "../../data/library";

/** Dùng nội bộ cho memo dependency ổn định của LyricsPane. */
type LyricLineView = LyricLine;

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
/**
 * Thời gian đón đầu (anticipation lead time) để dòng lyric trôi lên vị trí trước
 * khi ca sĩ cất giọng hát câu tiếp theo.
 * Khi audio time đạt T - 0.32s, animation cuộn mượt (smootherstep) khởi hành.
 * Đến đúng mốc T (khi ca từ bắt đầu chạy fluid fill), dòng chữ đã hạ cánh
 * vững vàng tại vị trí 35% mắt nhìn mà không hề bị rung lắc hay khựng giật.
 */
const SCROLL_LEAD_SECONDS = 0.32;

/**
 * Cuộn mượt tự nhiên (Smooth Physics-Based Easing).
 *
 * Sử dụng Perlin C2-continuous smootherstep: 6t^5 - 15t^4 + 10t^3.
 * - Khởi động với đạo hàm bằng 0 (ease-in nhẹ nhàng, hoàn toàn không giật cục / khựng).
 * - Lướt êm ái ở dải vận tốc chuyển động tự nhiên.
 * - Hãm phanh mềm mại ở cuối (cushioned landing) tiếp cận tâm nhìn 35%.
 */
function animateScrollTo(el: HTMLElement, target: number, maxDuration = 520) {
  const start = el.scrollTop;
  const distance = target - start;
  if (Math.abs(distance) < 1) return () => {};

  // Duration thích ứng: ~340ms cho 1 dòng (khoảng 60-100px), tối đa 520ms cho cuộn xa
  const duration = Math.min(maxDuration, 310 + Math.sqrt(Math.abs(distance)) * 4);
  const startTime = performance.now();
  let raf = 0;

  // C2-continuous smootherstep: không bao giờ giật tốc độ đột ngột tại t=0
  const ease = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : t * t * t * (t * (t * 6 - 15) + 10));

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
  "text-left font-sans font-bold tracking-tight leading-snug md:leading-normal [transition:filter_380ms_cubic-bezier(0.16,1,0.3,1),opacity_380ms_cubic-bezier(0.16,1,0.3,1),transform_380ms_cubic-bezier(0.16,1,0.3,1),color_280ms_ease] transform-gpu [will-change:transform] cursor-pointer group block w-full outline-none antialiased [text-wrap:pretty] break-words";
const LINE_ACTIVE =
  "text-white opacity-100 translate-y-0 scale-[1.03] origin-left font-bold blur-none drop-shadow-[0_2px_14px_rgba(255,255,255,0.22)]";
const LINE_PASSED =
  "text-white/50 opacity-45 -translate-y-0.5 blur-[0.7px] scale-[1.0] origin-left hover:text-white/90 hover:opacity-90 hover:blur-none hover:scale-[1.01] active:blur-none active:opacity-90";
const LINE_PASSED_DISTANT =
  "text-white/35 opacity-25 -translate-y-1 blur-[1.5px] scale-[0.96] origin-left hover:text-white/80 hover:opacity-80 hover:blur-none hover:scale-[1.0] active:blur-none active:opacity-90";
const LINE_FUTURE =
  "text-white/35 opacity-30 translate-y-2 blur-[1.2px] scale-[0.98] origin-left hover:text-white/85 hover:opacity-85 hover:blur-none hover:scale-[1.01] active:blur-none active:opacity-90";
const LINE_FUTURE_DISTANT =
  "text-white/20 opacity-20 translate-y-3 blur-[2.0px] scale-[0.95] origin-left hover:text-white/75 hover:opacity-75 hover:blur-none hover:scale-[1.0] active:blur-none active:opacity-90";
const LINE_PRELUDE =
  "text-white/70 opacity-70 translate-y-0.5 blur-none scale-[1.01] origin-left hover:text-white/90 hover:opacity-90 hover:scale-[1.02] active:blur-none active:opacity-90";
const LINE_PLAIN =
  "font-bold text-white/85 opacity-85 blur-none translate-y-0 scale-100 origin-left hover:text-white hover:opacity-100";

function lineClass(i: number, activeIndex: number, isPlain = false): string {
  if (isPlain) return LINE_PLAIN;
  if (activeIndex === -1) {
    return i === 0 ? LINE_PRELUDE : LINE_FUTURE;
  }
  if (i === activeIndex) return LINE_ACTIVE;
  if (i === activeIndex - 1) return LINE_PASSED;
  if (i < activeIndex - 1) return LINE_PASSED_DISTANT;
  if (i === activeIndex + 1) return LINE_FUTURE;
  return LINE_FUTURE_DISTANT;
}

function getOrHydrateItems(
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  expectedTrackId?: string | undefined,
): (HTMLButtonElement | null)[] {
  let items = itemRefs.current ?? [];
  const container = containerRef.current;
  if (!container) return items;

  // Prevent cross-track button leakage: if container is still tagged with a previous track during exit animation, do not hydrate from it
  if (expectedTrackId && container.dataset["lyricsTrack"] && container.dataset["lyricsTrack"] !== expectedTrackId) {
    return [];
  }

  if ((!items || items.length === 0 || !items[0]) && container) {
    const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    if (found.length > 0) {
      itemRefs.current = found;
      items = found;
    }
  }
  return items;
}

export function LyricsPane({ compact = false }: { compact?: boolean }) {
  const { current, seek } = usePlayer();
  const getPlayerTime = useGetPlayerTime();
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
  const trackId = current?.id;
  const lastTrackIdRef = useRef(trackId);
  if (lastTrackIdRef.current !== trackId) {
    lastTrackIdRef.current = trackId;
    isUserScrollingRef.current = false;
    isInitialMountRef.current = true;
    activeIndexRef.current = -1;
    itemRefs.current = [];
  }

  const { lines } = useTrackLyrics(current);

  const isPlainLyrics = useMemo(() => lines.length > 0 && lines.every((l) => !l.time || l.time === 0), [lines]);

  const scrollActiveIntoView = useCallback(
    (idx: number) => {
      const container = containerRef.current;
      if (!container) return;
      cancelScrollRef.current();
      if (idx < 0) {
        if (isInitialMountRef.current) {
          container.scrollTop = 0;
          isInitialMountRef.current = false;
        } else {
          cancelScrollRef.current = animateScrollTo(container, 0);
        }
        return;
      }
      const items = getOrHydrateItems(itemRefs, containerRef, trackId);
      const el = items[idx];
      if (el) {
        // Invariant rect-based scroll computation: immune to offsetParent nesting, padding, or CSS transforms
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const elTopInContainer = elRect.top - containerRect.top + container.scrollTop;
        const targetScroll = Math.max(0, elTopInContainer - container.clientHeight * 0.35);
        if (isInitialMountRef.current) {
          container.scrollTop = targetScroll;
          isInitialMountRef.current = false;
        } else {
          cancelScrollRef.current = animateScrollTo(container, targetScroll);
        }
      }
    },
    [trackId],
  );

  const handleUserScroll = () => {
    isUserScrollingRef.current = true;
    cancelScrollRef.current(); // người dùng chủ động cuộn -> hủy animation tự động đang chạy dở
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      if (!isPlainLyrics && lines.length > 0) {
        const active = activeIndexRef.current;
        scrollActiveIntoView(active);
      }
    }, 2500);
  };

  // Reset scroll to top when track changes + khôi phục active đầu tiên
  useEffect(() => {
    isUserScrollingRef.current = false;
    isInitialMountRef.current = true;
    activeIndexRef.current = -1;
    cancelScrollRef.current();
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [trackId]);

  // Window focus & tab visibility recovery: when tab wakes or Alt-Tab returns, immediately re-align
  useEffect(() => {
    const handleWake = () => {
      if (document.hidden) return;
      if (isPlainLyrics || lines.length === 0) return;
      const items = getOrHydrateItems(itemRefs, containerRef, trackId);
      if (!items || items.length === 0) return;
      const snapTime = getPlayerTime();
      const idx = activeFromTime(lines, snapTime);
      activeIndexRef.current = idx;
      applyActiveClasses(items, -1, idx, isPlainLyrics);
      if (!isUserScrollingRef.current) {
        scrollActiveIntoView(idx);
      }
    };
    window.addEventListener("focus", handleWake);
    document.addEventListener("visibilitychange", handleWake);
    return () => {
      window.removeEventListener("focus", handleWake);
      document.removeEventListener("visibilitychange", handleWake);
    };
  }, [trackId, lines, isPlainLyrics, scrollActiveIntoView, getPlayerTime]);

  // Anti-deadlock failsafe: ensure lines are hydrated and active line scrolled into view after transition
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isPlainLyrics || lines.length === 0) return;
      const items = getOrHydrateItems(itemRefs, containerRef);
      if (items.length > 0) {
        const snapTime = getPlayerTime();
        const idx = activeFromTime(lines, snapTime);
        activeIndexRef.current = idx;
        applyActiveClasses(items, -1, idx, isPlainLyrics);
        if (!isUserScrollingRef.current) {
          scrollActiveIntoView(idx);
        }
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [trackId, lines, isPlainLyrics, scrollActiveIntoView, getPlayerTime]);

  useEffect(
    () => () => {
      cancelScrollRef.current();
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    },
    [],
  );

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
  const [activeLineState, setActiveLineState] = useState<number>(() =>
    initialActive === -2 ? activeIndexRef.current : initialActive,
  );

  useEffect(() => {
    setActiveLineState(-1);
  }, [trackId]);

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
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current?.id || "lyrics-pane"}
          initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="h-full w-full transform-gpu [will-change:opacity,transform]"
        >
          <div
            ref={containerRef}
            data-lyrics-track={trackId}
            onWheel={handleUserScroll}
            onTouchStart={handleUserScroll}
            onTouchMove={handleUserScroll}
            className={cn(
              "relative flex h-full flex-col gap-5 sm:gap-6 md:gap-7 overflow-y-auto px-4 md:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
              compact ? "pt-[30vh] pb-[40vh]" : "pt-[35vh] pb-[45vh]",
            )}
          >
            {lines.map((line, i) => (
              <button
                key={`${line.time}-${i}`}
                ref={(el) => {
                  if (el) {
                    itemRefs.current[i] = el;
                    el.dataset["base"] = cn(
                      LINE_BASE,
                      compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                    );
                  }
                }}
                onClick={() => {
                  if (isPlainLyrics) return;
                  isUserScrollingRef.current = false;
                  setActiveLineState(i);
                  seek(line.time);
                }}
                className={cn(
                  LINE_BASE,
                  // -2 = danh sách render lần sau (state settled) — giữ ref
                  // value (đã đúng); giá trị 0..n từ initialActive chỉ dùng ở
                  // frame đầu để tránh "flash FUTURE".
                  lineClass(i, initialActive === -2 ? activeIndexRef.current : initialActive, isPlainLyrics),
                  compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl md:text-[1.75rem] lg:text-[1.95rem]",
                )}
              >
                {/* Active line with Word-by-Word syllable fluid fill (Apple Music style) */}
                {i ===
                  (activeLineState >= 0
                    ? activeLineState
                    : initialActive >= 0
                      ? initialActive
                      : activeIndexRef.current) && !isPlainLyrics ? (
                  <WordByWordActiveLine line={line} nextLineTime={lines[i + 1]?.time} />
                ) : (
                  <span className="inline">{line.text}</span>
                )}
              </button>
            ))}
          </div>
          <LyricsMountSync
            lines={lines}
            itemRefs={itemRefs}
            activeIndexRef={activeIndexRef}
            isUserScrollingRef={isUserScrollingRef}
            containerRef={containerRef}
            isPlainLyrics={isPlainLyrics}
            trackId={trackId}
            scrollActiveIntoView={scrollActiveIntoView}
          />
        </motion.div>
      </AnimatePresence>
      {/* Ticker: subscriber DUY NHẤT của time trong pane. On active-line
          change → cập nhật classList 2 node + auto-center. Không setState
          ở cấp pane → danh sách không bao giờ re-render theo tick. */}
      <LyricsTicker
        lines={lines}
        itemRefs={itemRefs}
        containerRef={containerRef}
        trackId={trackId}
        activeIndexRef={activeIndexRef}
        isUserScrollingRef={isUserScrollingRef}
        isPlainLyrics={isPlainLyrics}
        onActiveChange={(idx, isScrollOnly) => {
          if (isScrollOnly) {
            if (!isUserScrollingRef.current && idx >= 0) {
              scrollActiveIntoView(idx);
            }
            return;
          }
          setActiveLineState(idx);
          if (isUserScrollingRef.current) return;
          if (idx < 0) {
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

function LyricsMountSync({
  lines,
  itemRefs,
  activeIndexRef,
  isUserScrollingRef,
  containerRef,
  isPlainLyrics,
  trackId,
  scrollActiveIntoView,
}: {
  lines: LyricLineView[];
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  activeIndexRef: React.RefObject<number>;
  isUserScrollingRef: React.RefObject<boolean>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isPlainLyrics: boolean;
  trackId?: string | undefined;
  scrollActiveIntoView: (idx: number) => void;
}) {
  const mountTime = usePlayerTimeSnapshot();
  useEffect(() => {
    if (isPlainLyrics) {
      applyActiveClasses(itemRefs.current ?? [], -1, -1, true);
      return;
    }
    const items = getOrHydrateItems(itemRefs, containerRef, trackId);
    const currentIdx = activeFromTime(lines, mountTime);
    applyActiveClasses(items, -1, currentIdx, false);
    activeIndexRef.current = currentIdx;
    if (!isUserScrollingRef.current) {
      scrollActiveIntoView(currentIdx);
    }
  }, [
    lines,
    mountTime,
    isPlainLyrics,
    itemRefs,
    activeIndexRef,
    isUserScrollingRef,
    containerRef,
    trackId,
    scrollActiveIntoView,
  ]);

  return null;
}

function activeFromTime(lines: LyricLineView[], time: number, leadSeconds = SCROLL_LEAD_SECONDS): number {
  let idx = -1;
  const effectiveTime = time + leadSeconds;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && typeof l.time === "number" && effectiveTime >= l.time) idx = i;
  }
  return idx;
}

/** Đổi class trực tiếp giữa node active cũ ↔ mới (không React re-render).
 *  Mỗi node giữ phần class "base + cỡ chữ" trong data-base khi render;
 *  ticker chỉ nối thêm state class — không bao giờ mất cỡ chữ compact. */
function applyActiveClasses(items: (HTMLButtonElement | null)[], prev: number, next: number, isPlain = false) {
  if (isPlain) {
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (!el || !el.dataset["base"]) continue;
      el.className = `${el.dataset["base"]} ${LINE_PLAIN}`;
    }
    return;
  }

  const setCls = (i: number, cls: string) => {
    const el = items[i];
    if (!el) return;
    const base = el.dataset["base"] || LINE_BASE;
    el.className = `${base} ${cls}`;
  };

  if (next === -1) {
    for (let i = 0; i < items.length; i++) {
      if (i === 0) setCls(i, LINE_PRELUDE);
      else if (i === 1) setCls(i, LINE_FUTURE);
      else setCls(i, LINE_FUTURE_DISTANT);
    }
    return;
  }

  if (prev < 0 || next < 0 || Math.abs(next - prev) > 1) {
    for (let i = 0; i < items.length; i++) {
      if (i === next) setCls(i, LINE_ACTIVE);
      else if (i === next - 1) setCls(i, LINE_PASSED);
      else if (i < next - 1) setCls(i, LINE_PASSED_DISTANT);
      else if (i === next + 1) setCls(i, LINE_FUTURE);
      else setCls(i, LINE_FUTURE_DISTANT);
    }
    return;
  }

  // Multi-tier optical blur window around prev and next
  const minIdx = Math.max(0, Math.min(prev - 2, next - 2));
  const maxIdx = Math.min(items.length - 1, Math.max(prev + 2, next + 2));

  for (let i = minIdx; i <= maxIdx; i++) {
    if (i === next) setCls(i, LINE_ACTIVE);
    else if (i === next - 1) setCls(i, LINE_PASSED);
    else if (i < next - 1) setCls(i, LINE_PASSED_DISTANT);
    else if (i === next + 1) setCls(i, LINE_FUTURE);
    else setCls(i, LINE_FUTURE_DISTANT);
  }
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
  containerRef,
  trackId,
  activeIndexRef,
  isUserScrollingRef,
  isPlainLyrics,
  onActiveChange,
}: {
  lines: LyricLineView[];
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  trackId?: string | undefined;
  activeIndexRef: React.RefObject<number>;
  isUserScrollingRef: React.RefObject<boolean>;
  isPlainLyrics: boolean;
  onActiveChange: (idx: number, isScrollOnly?: boolean) => void;
}) {
  const fallbackTime = usePlayerTime();
  const time = useSmoothLyricTime(fallbackTime);
  const scrollTargetIdxRef = useRef(-1);

  useEffect(() => {
    if (isPlainLyrics || lines.length === 0) return;

    // 1. Scroll anticipation: begins 0.32s ahead of vocal onset so viewport glides smoothly into place
    const scrollIdx = activeFromTime(lines, time, SCROLL_LEAD_SECONDS);
    if (scrollIdx !== scrollTargetIdxRef.current) {
      scrollTargetIdxRef.current = scrollIdx;
      if (!isUserScrollingRef.current && scrollIdx >= 0) {
        onActiveChange(scrollIdx, true /* isScrollOnly */);
      }
    }

    // 2. Active singing highlight: switches right at vocal onset (~40ms lead for visual-auditory sync)
    // NEVER cut off active line 320ms early while singer is still singing the final word!
    const next = activeFromTime(lines, time, 0.04);
    const prev = activeIndexRef.current ?? -1;
    const items = getOrHydrateItems(itemRefs, containerRef, trackId);
    if (!items || items.length === 0) return;

    // Self-healing: if active line is the same index but its element lacks active styling (e.g. after transition),
    // force apply so song transition never freezes.
    const activeEl = next >= 0 ? items[next] : null;
    const needsSync = activeEl && !activeEl.className.includes("scale-[1.03]");

    if (next === prev && !needsSync) return;

    applyActiveClasses(items, prev, next, false);
    activeIndexRef.current = next;
    onActiveChange(next, false /* isScrollOnly */);
  }, [time, lines, itemRefs, containerRef, trackId, activeIndexRef, isUserScrollingRef, isPlainLyrics, onActiveChange]);
  return null;
}

const STOP_CONSONANT_RE = /(?:[cptk]|ch|ck|pt|ct|ft|d|b|g)$/i;
const PROLONGED_CHAR_RE = /(.)\1{2,}|[~]{1,}/i;

function computeCadenceProgress(linear: number, text: string): number {
  if (linear <= 0) return 0;
  if (linear >= 1) return 1;

  const clean = text.replace(/[.,!?;:…"“”'’\-–—()[\]{}]/g, "");
  const isHyphenChop = text.endsWith("-");
  const isStopConsonant = STOP_CONSONANT_RE.test(clean);
  const isProlonged = PROLONGED_CHAR_RE.test(clean) || /~/.test(text);

  if (isStopConsonant && !isProlonged) {
    // Staccato (nhấp nhả): reach 100% active fill at ~80% of syllable window and hold for crisp micro-rest
    return Math.min(1, linear / 0.82);
  }

  if (isHyphenChop) {
    // Vocal chop runs ("ah-", "oh-", "la-"): energetic ease-out pulse on each syllable beat
    return 1 - Math.pow(1 - linear, 1.8);
  }

  if (isProlonged) {
    // Melisma / prolonged vowels (kéo hơi): silky smooth sine easing across the sustained note
    return Math.sin((linear * Math.PI) / 2);
  }

  // Standard word singing cadence: smooth natural ease
  return linear < 0.5 ? 2 * linear * linear : 1 - Math.pow(-2 * linear + 2, 2) / 2;
}

/**
 * WordByWordActiveLine — dòng lời đang phát tô chữ theo từng âm tiết (Visuals & Lyrics 2.0).
 * Phong cách Apple Music / Karaoke fluid fill, chỉ subscribe usePlayerTime() trên
 * đúng 1 dòng active duy nhất để giữ hiệu năng tối đa 0-layout thrash.
 */
const WordByWordActiveLine = memo(function WordByWordActiveLine({
  line,
  nextLineTime,
}: {
  line: LyricLineView;
  nextLineTime?: number | undefined;
}) {
  const fallbackTime = usePlayerTime();
  const time = useSmoothLyricTime(fallbackTime);
  const words = useMemo(() => computeWordTimings(line, nextLineTime), [line, nextLineTime]);

  if (!words.length) {
    return <span className="inline">{line.text}</span>;
  }

  return (
    <span className="inline">
      {words.map((w, idx) => {
        const isPast = time >= w.endTime;
        const isFuture = time < w.startTime;
        const isSinging = !isPast && !isFuture;

        const linearProgress = isPast
          ? 1
          : isFuture
            ? 0
            : Math.min(1, Math.max(0, (time - w.startTime) / Math.max(0.01, w.endTime - w.startTime)));

        const progress = isPast || isFuture ? linearProgress : computeCadenceProgress(linearProgress, w.text);

        const pct = (progress * 100).toFixed(1);
        const feather = Math.min(12, Math.max(0, (1 - progress) * 24));
        const leadStart = Math.max(0, Number(pct) - feather).toFixed(1);

        return (
          <span key={`${idx}-${w.text}`} className="inline">
            <span className="relative inline-block font-bold align-baseline">
              {/* Base text: 100% visible font glyphs, immune to CSS text background clipping glitches */}
              <span className={cn("inline-block", isPast ? "text-white" : "text-white/40")}>{w.text}</span>

              {/* Active syllable fluid fill overlay */}
              {isSinging && (
                <span
                  className="absolute inset-0 whitespace-nowrap text-white select-none pointer-events-none"
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
            {idx < words.length - 1 && !w.text.endsWith("-") ? " " : ""}
          </span>
        );
      })}
    </span>
  );
});
