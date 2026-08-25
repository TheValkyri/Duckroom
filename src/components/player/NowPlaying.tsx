import { ChevronDown, Mic2, SkipForward } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { albumById, formatTime } from "../../data/library";
import { cropBlackLetterbox } from "../../lib/image-crop";
import { springGentle, springSmooth, springSnappy, tapScale, tweenBase } from "../../lib/motion";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { cn } from "../../lib/utils";
import { Visualizer } from "../Visualizer";
import { SeekBar, TransportControls } from "./Controls";
import { LyricsPane } from "./Lyrics";

// Tách nhãn thời gian ra component riêng: chỉ phần này re-render mỗi tick
// (~4-15 lần/giây), toàn bộ đĩa than/ảnh bìa/gradient không cần tính lại.
function NowPlayingTimeLabel({ duration }: { duration: number }) {
  const time = usePlayerTime();
  return (
    <div className="text-muted-foreground flex justify-between text-xs tabular-nums mt-1">
      <span>{formatTime(time)}</span>
      <span>-{formatTime(duration - time)}</span>
    </div>
  );
}

interface AmbientLayer {
  id: string;
  cover: string;
  accent: string;
}

// Perf/UX fix 2026-08-25 (chuyển bài bị chớp + khựng):
// cropBlackLetterbox là công việc canvas full-res trên main thread. Trước đây
// ảnh bìa chỉ được swap SAU khi crop xong → ảnh cũ linger rồi nhảy đột ngột
// (flash), đồng thời đúng lúc chuyển bài main thread bị chiếm bởi crop.
// Giờ crop được cache + prefetch SỚM cho bài kế tiếp (dedupe bằng promise
// cache) — khi chuyển bài, ảnh đã sẵn sàng, swap tức thì.
const croppedCoverCache = new Map<string, string>();
const cropPromiseCache = new Map<string, Promise<string>>();

function getCroppedCover(url: string): Promise<string> {
  const cached = croppedCoverCache.get(url);
  if (cached) return Promise.resolve(cached);
  let p = cropPromiseCache.get(url);
  if (!p) {
    p = cropBlackLetterbox(url)
      .then((cropped) => {
        const finalUrl = cropped || url;
        if (croppedCoverCache.size > 60) {
          croppedCoverCache.clear();
          cropPromiseCache.clear();
        }
        if (finalUrl !== url) croppedCoverCache.set(url, finalUrl);
        return finalUrl;
      })
      .catch(() => url);
    cropPromiseCache.set(url, p);
  }
  return p;
}

function AmbientCrossfadeBackground({ cover, accent }: { cover: string; accent?: string | undefined }) {
  const currentAccent = accent || "oklch(0.3 0.1 260)";
  const [layers, setLayers] = useState<AmbientLayer[]>([{ id: `init-${cover}`, cover, accent: currentAccent }]);

  useEffect(() => {
    setLayers((prev) => {
      const active = prev[prev.length - 1];
      if (active && active.cover === cover && active.accent === currentAccent) {
        return prev;
      }
      return [
        { id: active?.id || "prev", cover: active?.cover || cover, accent: active?.accent || currentAccent },
        { id: `layer-${cover}-${Date.now()}`, cover, accent: currentAccent },
      ];
    });
  }, [cover, currentAccent]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden select-none -z-10 bg-background">
      <AnimatePresence>
        {layers.map((layer) => (
          <motion.div
            key={layer.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 size-full transform-gpu"
          >
            {/* Dynamic radial color glow */}
            <div
              className="absolute inset-0 opacity-45"
              style={{
                background: `radial-gradient(120% 90% at 50% 30%, ${layer.accent} 0%, transparent 68%)`,
              }}
            />
            {/* Soft blurred artwork aura */}
            <img
              src={layer.cover}
              alt=""
              aria-hidden
              decoding="async"
              className="absolute inset-0 size-full scale-125 object-cover opacity-15 blur-3xl transform-gpu"
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {/* Cinematic vignette */}
      <div className="from-background/90 via-transparent to-background/80 absolute inset-0 bg-gradient-to-t pointer-events-none" />
    </div>
  );
}

export function NowPlaying() {
  const { current, queue, index, expanded, setExpanded, isPlaying, lyricsOpen, setLyricsOpen, next, direction } =
    usePlayer();
  const open = expanded;
  const album = current ? albumById(current.albumId) : undefined;
  // Fallback NỘI BỘ (gradient) — không tải ảnh mạng nữa: trước đây dùng
  // unsplash → mỗi lần chuyển bài lỗi cover là 1 request mạng + flash trắng.
  const fallbackCover =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2327272a'/%3E%3Cstop offset='0.55' stop-color='%233f2d12'/%3E%3Cstop offset='1' stop-color='%23713f12'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='600' fill='url(%23g)'/%3E%3C/svg%3E";
  const rawCover = current?.cover || album?.cover;
  const rawCoverUrl = rawCover && !rawCover.startsWith("blob:") ? rawCover : fallbackCover;
  const nextTrack = queue[(index + 1) % queue.length];
  const nextAlbum = nextTrack ? albumById(nextTrack.albumId) : undefined;
  const nextCoverUrl = nextTrack?.cover || nextAlbum?.cover;

  // Hiển thị tức thì: cache hit (đã crop sẵn) hoặc raw — KHÔNG chờ crop.
  // Crop chỉ chạy nền để nâng cấp ảnh khi xong, tránh flash ảnh cũ.
  const [cleanCoverUrl, setCleanCoverUrl] = useState<string>(() => croppedCoverCache.get(rawCoverUrl) ?? rawCoverUrl);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const cached = croppedCoverCache.get(rawCoverUrl);
    if (cached) {
      setCleanCoverUrl(cached);
      return;
    }
    // Continuity tức thì với ảnh raw (đã preload từ bài trước), crop nền sau.
    setCleanCoverUrl(rawCoverUrl || fallbackCover);
    let isMounted = true;
    void getCroppedCover(rawCoverUrl).then((finalUrl) => {
      if (isMounted && finalUrl !== rawCoverUrl) setCleanCoverUrl(finalUrl);
    });
    return () => {
      isMounted = false;
    };
  }, [rawCoverUrl]);

  // Preload cover bài kế tiếp (raw + bản đã crop) → chuyển bài không phải
  // chờ tải ảnh lẫn chờ canvas crop (chống flash + chống khựng main thread).
  useEffect(() => {
    if (nextCoverUrl) {
      void getCroppedCover(nextCoverUrl);
      if (typeof Image !== "undefined") {
        const img = new Image();
        img.src = nextCoverUrl;
      }
    }
  }, [nextCoverUrl]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth && naturalHeight) {
      setIsLandscape(naturalWidth / naturalHeight > 1.22);
    }
  };

  const handleMinimize = () => {
    setExpanded(false);
    setLyricsOpen(false);
  };

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={springGentle}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleMinimize();
            }
          }}
          className="bg-background grain fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none"
        >
          {/* Ambient Dual-Buffer Crossfading Background */}
          <AmbientCrossfadeBackground cover={rawCoverUrl} accent={album?.accent} />

          {/* Top Header Bar */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleMinimize();
            }}
            className="relative z-20 flex items-center justify-between px-6 py-4 shrink-0"
          >
            <motion.button
              onClick={handleMinimize}
              whileTap={tapScale}
              transition={springSnappy}
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors cursor-pointer"
            >
              <ChevronDown className="size-5" /> Thu nhỏ
            </motion.button>

            {/* Next Track Indicator Pill */}
            {nextTrack && queue.length > 1 && (
              <motion.button
                onClick={() => next(true)}
                whileTap={tapScale}
                whileHover={{ y: -1 }}
                transition={springSnappy}
                className="hidden md:flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground bg-card/60 hover:bg-card/90 border border-white/10 px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm group"
              >
                <SkipForward className="size-3.5 text-primary group-hover:translate-x-0.5 transition-transform" />
                <span>
                  Tiếp theo: <strong className="text-foreground font-medium">{nextTrack.title}</strong> —{" "}
                  {nextTrack.artist}
                </span>
              </motion.button>
            )}

            {/* Nút Lời: chỉ hiện khi bài HAT có lyrics — tránh pill trống lơ lửng */}
            {current?.lyrics && current.lyrics.length > 0 && (
              <motion.button
                onClick={() => setLyricsOpen(!lyricsOpen)}
                whileTap={tapScale}
                transition={springSnappy}
                className={cn(
                  "text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors cursor-pointer px-3.5 py-1.5 rounded-full border border-transparent",
                  lyricsOpen && "text-primary border-primary/30 bg-primary/10 font-medium",
                )}
              >
                <Mic2 className="size-4" /> Lời
              </motion.button>
            )}
          </div>

          {/* Main Content Stage */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleMinimize();
            }}
            className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 py-2 overflow-hidden flex items-center justify-center"
          >
            <div className="w-full h-full flex items-center justify-center relative">
              {/* Left Column: Cover + Vinyl Disc + Title + Controls */}
              <motion.div
                layout
                transition={springSmooth}
                className={cn(
                  "flex flex-col items-center justify-center gap-5 w-full max-w-md shrink-0 z-10",
                  lyricsOpen ? "lg:mr-auto lg:ml-0" : "mx-auto",
                )}
              >
                {/* Vinyl Record & Sleeve Container: Directional Glide & Tactile Disc */}
                <div className="relative flex items-center justify-center my-2 w-full min-h-[min(36vh,290px)]">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={current.id}
                      initial={{
                        opacity: 0,
                        x: direction * 48,
                        scale: 0.94,
                      }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        scale: 1,
                      }}
                      exit={{
                        opacity: 0,
                        x: -direction * 48,
                        scale: 0.94,
                      }}
                      transition={{
                        // Fix 2026-08-25: bỏ rotate + rút ngắn quãng trượt, spring
                        // nhanh hơn — animation nhiều ≠ mượt; chuyển bài phải
                        // "đáp" gọn thay vì lơ lửng nảy vài trăm ms.
                        type: "spring",
                        stiffness: 340,
                        damping: 32,
                        mass: 0.8,
                      }}
                      className="relative flex items-center justify-center w-full"
                    >
                      {/* Spinning Vinyl Record Disc - Slides out from behind the sleeve */}
                      <motion.div
                        initial={{ x: 0, opacity: 0 }}
                        animate={{
                          x: isPlaying ? (lyricsOpen ? 46 : 64) : 0,
                          opacity: isPlaying ? 0.95 : 0,
                        }}
                        exit={{ x: 0, opacity: 0 }}
                        transition={{
                          type: "spring",
                          stiffness: 190,
                          damping: 20,
                          delay: 0.14,
                        }}
                        className="absolute size-[min(34vh,270px)] rounded-full border-4 border-neutral-900 bg-neutral-950 shadow-2xl pointer-events-none z-0"
                      >
                        <motion.div
                          animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                          transition={
                            isPlaying
                              ? { rotate: { repeat: Infinity, duration: 16, ease: "linear" } }
                              : { duration: 0.5 }
                          }
                          style={{ transformOrigin: "center center" }}
                          className="size-full relative rounded-full"
                        >
                          <div className="absolute inset-4 rounded-full border border-neutral-800/60" />
                          <div className="absolute inset-8 rounded-full border border-neutral-800/40" />
                          <div className="absolute inset-12 rounded-full border border-neutral-800/60" />
                          <div className="absolute inset-16 rounded-full border border-neutral-800/40" />
                          <div className="bg-primary/20 border-primary/40 absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full border">
                            <div className="bg-background size-3.5 rounded-full" />
                          </div>
                        </motion.div>
                      </motion.div>

                      {/* Album / Track Jacket (Vỏ bìa đĩa) */}
                      <div
                        className={cn(
                          "relative z-10 rounded-2xl overflow-hidden shadow-[0_25px_80px_-15px_oklch(0_0_0/0.95)] border border-white/10 transition-all duration-500 bg-neutral-900",
                          isLandscape
                            ? "w-full max-w-[min(48vh,400px)] aspect-video"
                            : "aspect-square w-full max-w-[min(34vh,270px)] md:max-w-[min(36vh,290px)]",
                        )}
                      >
                        <motion.img
                          src={cleanCoverUrl || rawCoverUrl}
                          alt={`Bìa ${current.title}`}
                          decoding="async"
                          onLoad={handleImageLoad}
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (target.src !== fallbackCover) {
                              target.src = fallbackCover;
                            }
                          }}
                          animate={{ scale: isPlaying ? 1 : 0.97 }}
                          transition={{ type: "spring", stiffness: 220, damping: 20 }}
                          className="size-full object-cover rounded-2xl"
                        />
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Track Information & Fixed Controls (Permanent & Rock-solid) */}
                <div className="w-full max-w-sm text-center">
                  {/* Only Title & Artist crossfade directionally inside a fixed height box */}
                  <div className="relative min-h-[4.25rem] flex items-center justify-center overflow-hidden">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={`title-${current.id}`}
                        initial={{
                          opacity: 0,
                          x: direction * 35,
                        }}
                        animate={{
                          opacity: 1,
                          x: 0,
                        }}
                        exit={{
                          opacity: 0,
                          x: -direction * 35,
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 320,
                          damping: 30,
                        }}
                        className="w-full"
                      >
                        <h1 className="font-display text-2xl md:text-4xl truncate text-foreground">{current.title}</h1>
                        <p className="text-muted-foreground mt-1 text-xs md:text-sm truncate">
                          {current.artist} — {album?.title || "Single Collection"} ({album?.year || 2026})
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Fixed Stable Visualizer, Seekbar & Controls (NEVER remounts or jumps) */}
                  <Visualizer playing={isPlaying} bars={36} height={38} className="mt-3" />

                  <div className="mt-2">
                    <SeekBar />
                    <NowPlayingTimeLabel duration={current.duration} />
                  </div>

                  <div className="mt-4 flex justify-center">
                    <TransportControls size="lg" />
                  </div>
                </div>
              </motion.div>

              {/* Right Column: Lyrics Pane (Absolute overlay on desktop to eliminate layout reflow jump) */}
              <AnimatePresence>
                {lyricsOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: 60 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 60 }}
                    transition={springSmooth}
                    className="w-full lg:w-1/2 h-[60vh] lg:h-[72vh] lg:absolute lg:right-0 flex flex-col justify-center overflow-hidden z-20"
                  >
                    <LyricsPane />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Padding Bar */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleMinimize();
            }}
            className="h-6 w-full shrink-0 relative z-20"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
