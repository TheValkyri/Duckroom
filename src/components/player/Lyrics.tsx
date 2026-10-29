import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  usePlayer,
  usePlayerTime,
  usePlayerTimeSnapshot,
  useGetPlayerTime,
  useSmoothLyricTime,
} from "../../lib/player";
import {
  applyLyricsOffset,
  computeWordTimings,
  readStoredOffset,
  saveStoredOffset,
  OFFSET_LIMIT_MS,
} from "../../lib/lyrics-formatter";
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
  "text-left font-sans font-bold tracking-tight leading-snug md:leading-normal [transition:filter_380ms_cubic-bezier(0.16,1,0.3,1),opacity_380ms_cubic-bezier(0.16,1,0.3,1),transform_380ms_cubic-bezier(0.16,1,0.3,1),color_280ms_ease] transform-gpu [will-change:transform] cursor-pointer group block w-full outline-none antialiased [text-wrap:balance] break-words";
const LINE_ACTIVE =
  "text-white opacity-100 translate-y-0 scale-[1.03] origin-left font-bold blur-none drop-shadow-[0_2px_14px_rgba(255,255,255,0.22)]";
const LINE_PASSED =
  "text-white/50 opacity-45 -translate-y-0.5 blur-[0.7px] scale-[1.0] origin-left hover:text-white/90 hover:opacity-90 hover:blur-none hover:scale-[1.01] active:blur-none active:opacity-90";
const LINE_FUTURE =
  "text-white/35 opacity-30 translate-y-2 blur-[1.2px] scale-[0.98] origin-left hover:text-white/85 hover:opacity-85 hover:blur-none hover:scale-[1.01] active:blur-none active:opacity-90";
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
  if (i < activeIndex) return LINE_PASSED;
  return LINE_FUTURE;
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
  // localStorage (nếu có) vẫn được áp dụng khi hiển thị.
  const [offsetMs, setOffsetMs] = useState(0);
  const [nudgeToast, setNudgeToast] = useState<string | null>(null);
  const nudgeTimeoutRef = useRef<any>(null);
  const trackId = current?.id;
  const lastTrackIdRef = useRef(trackId);
  if (lastTrackIdRef.current !== trackId) {
    lastTrackIdRef.current = trackId;
    isUserScrollingRef.current = false;
    isInitialMountRef.current = true;
    activeIndexRef.current = -1;
    itemRefs.current = [];
  }

  useEffect(() => {
    setOffsetMs(readStoredOffset(trackId));
  }, [trackId]);

  const handleNudgeOffset = useCallback(
    (deltaMs: number) => {
      if (!trackId) return;
      setOffsetMs((prev) => {
        const next = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, prev + deltaMs));
        saveStoredOffset(trackId, next);
        setNudgeToast(`${next > 0 ? `+${next}` : next}ms`);
        if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
        nudgeTimeoutRef.current = setTimeout(() => setNudgeToast(null), 1800);
        return next;
      });
    },
    [trackId],
  );

  const handleResetOffset = useCallback(() => {
    if (!trackId) return;
    setOffsetMs(0);
    saveStoredOffset(trackId, 0);
    setNudgeToast("0ms (Mặc định)");
    if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
    nudgeTimeoutRef.current = setTimeout(() => setNudgeToast(null), 1800);
  }, [trackId]);

  // Real-time micro-sync keyboard shortcuts: [ earlier, ] later
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/input|textarea|select/i.test(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "[") {
        e.preventDefault();
        const step = e.shiftKey ? -100 : -50;
        handleNudgeOffset(step);
      } else if (e.key === "]") {
        e.preventDefault();
        const step = e.shiftKey ? 100 : 50;
        handleNudgeOffset(step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNudgeOffset]);

  // Stabilize mảng lines cho useMemo: `current?.lyrics ?? []` tạo array mới
  // mỗi render khi không có lời → useMemo bên dưới chạy lại vô nghĩa.
  const emptyLines = useMemo<LyricLineView[]>(() => [], []);
  const originalLines = current?.lyrics ?? emptyLines;
  const lines = useMemo(
    () => (offsetMs === 0 ? originalLines : applyLyricsOffset(originalLines, offsetMs)),
    [originalLines, offsetMs],
  );

  const isPlainLyrics = useMemo(() => lines.length > 0 && lines.every((l) => !l.time || l.time === 0), [lines]);

  const scrollActiveIntoView = useCallback(
    (idx: number) => {
      const container = containerRef.current;
      if (!container) return;
      cancelScrollRef.current();
      if (idx <= 0) {
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
            className="relative flex h-full flex-col gap-5 sm:gap-6 md:gap-7 overflow-y-auto pt-10 sm:pt-16 pb-32 px-4 md:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
                  <span className="inline-block">{line.text}</span>
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
        onActiveChange={(idx) => {
          setActiveLineState(idx);
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
      {/* Quick-offset micro-sync nudge pill (Apple Music style) */}
      {!isPlainLyrics && lines.length > 0 && (
        <div
          className={cn(
            "absolute z-20 flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-xs text-white/90 shadow-xl backdrop-blur-md transition-all select-none hover:border-white/20 hover:bg-black/75",
            compact ? "bottom-20 right-4" : "bottom-6 right-8",
          )}
        >
          <button
            type="button"
            title="Lời sớm hơn 50ms (Phím [ hoặc Shift+[ cho 100ms)"
            onClick={(e) => {
              e.stopPropagation();
              handleNudgeOffset(-50);
            }}
            className="flex size-5 items-center justify-center rounded-full text-white/70 hover:bg-white/20 hover:text-white active:scale-95 transition-all cursor-pointer font-bold text-sm"
            aria-label="Lời sớm hơn 50ms"
          >
            −
          </button>
          <span
            className={cn(
              "px-1.5 font-mono text-[11px] font-medium tracking-tight",
              offsetMs !== 0 ? "text-amber-300 font-semibold" : "text-white/60",
            )}
            title="Độ lệch đồng bộ hiện tại. Nhấn [ hoặc ] trên bàn phím để chỉnh."
          >
            {offsetMs === 0 ? "Sync 0ms" : `${offsetMs > 0 ? `+${offsetMs}` : offsetMs}ms`}
          </span>
          <button
            type="button"
            title="Lời trễ hơn 50ms (Phím ] hoặc Shift+] cho 100ms)"
            onClick={(e) => {
              e.stopPropagation();
              handleNudgeOffset(50);
            }}
            className="flex size-5 items-center justify-center rounded-full text-white/70 hover:bg-white/20 hover:text-white active:scale-95 transition-all cursor-pointer font-bold text-sm"
            aria-label="Lời trễ hơn 50ms"
          >
            +
          </button>
          {offsetMs !== 0 && (
            <button
              type="button"
              title="Đặt lại độ lệch về 0ms"
              onClick={(e) => {
                e.stopPropagation();
                handleResetOffset();
              }}
              className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white/50 hover:bg-white/15 hover:text-white transition-all cursor-pointer"
              aria-label="Đặt lại độ lệch về 0ms"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Floating Nudge Toast Feedback */}
      <AnimatePresence>
        {nudgeToast && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "pointer-events-none absolute z-30 rounded-lg border border-primary/40 bg-neutral-900/90 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-xl backdrop-blur-md",
              compact ? "bottom-28 right-4" : "bottom-14 right-8",
            )}
          >
            Đồng bộ: {nudgeToast}
          </motion.div>
        )}
      </AnimatePresence>
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

function activeFromTime(lines: LyricLineView[], time: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && typeof l.time === "number" && time >= l.time) idx = i;
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
      else setCls(i, LINE_FUTURE);
    }
    return;
  }

  if (prev < 0 || next < 0 || Math.abs(next - prev) > 1) {
    for (let i = 0; i < items.length; i++) {
      if (i === next) setCls(i, LINE_ACTIVE);
      else if (i < next) setCls(i, LINE_PASSED);
      else setCls(i, LINE_FUTURE);
    }
    return;
  }

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
  onActiveChange: (idx: number) => void;
}) {
  const time = usePlayerTime();
  useEffect(() => {
    if (isPlainLyrics || lines.length === 0) return;
    const next = activeFromTime(lines, time);
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
    onActiveChange(next);
  }, [time, lines, itemRefs, containerRef, trackId, activeIndexRef, isUserScrollingRef, isPlainLyrics, onActiveChange]);
  return null;
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
    return <span className="inline-block">{line.text}</span>;
  }

  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
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
          <span
            key={`${idx}-${w.text}`}
            className={cn(
              "relative inline-block transform-gpu transition-transform duration-200 [will-change:transform]",
              isSinging ? "-translate-y-1" : "translate-y-0",
            )}
            style={{
              transitionTimingFunction: isSinging
                ? "cubic-bezier(0.175, 0.885, 0.32, 1.25)"
                : "cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
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
        );
      })}
    </span>
  );
});
