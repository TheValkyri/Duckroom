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

export function NowPlaying() {
  const { current, queue, index, expanded, setExpanded, isPlaying, lyricsOpen, setLyricsOpen, next } =
    usePlayer();
  const open = expanded;
  const album = current ? albumById(current.albumId) : undefined;
  const fallbackCover =
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80";
  const rawCover = current?.cover || album?.cover;
  const rawCoverUrl = rawCover && !rawCover.startsWith("blob:") ? rawCover : fallbackCover;
  const nextTrack = queue[(index + 1) % queue.length];

  const [cleanCoverUrl, setCleanCoverUrl] = useState<string | undefined>(rawCoverUrl);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    if (!rawCoverUrl) {
      setCleanCoverUrl(fallbackCover);
      return;
    }
    let isMounted = true;
    cropBlackLetterbox(rawCoverUrl).then((cropped) => {
      if (isMounted) setCleanCoverUrl(cropped || rawCoverUrl || fallbackCover);
    });
    return () => {
      isMounted = false;
    };
  }, [rawCoverUrl]);

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
          {/* Ambient Crossfading Radial Gradient & Artwork Background */}
          <AnimatePresence mode="popLayout">
            <motion.div
              key={current.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-none absolute inset-0"
            >
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  background: `radial-gradient(120% 90% at 50% 30%, ${album?.accent || "oklch(0.3 0.1 260)"} 0%, transparent 65%)`,
                }}
              />
              <img
                src={cleanCoverUrl || fallbackCover}
                alt=""
                aria-hidden
                decoding="async"
                className="absolute inset-0 size-full scale-110 object-cover opacity-15 blur-3xl"
              />
            </motion.div>
          </AnimatePresence>

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
                <span>Tiếp theo: <strong className="text-foreground font-medium">{nextTrack.title}</strong> — {nextTrack.artist}</span>
              </motion.button>
            )}

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
                  "flex flex-col items-center justify-center gap-6 w-full max-w-md shrink-0 z-10",
                  lyricsOpen ? "lg:mr-auto lg:ml-0" : "mx-auto"
                )}
              >
                {/* Vinyl Record & Cover Container. mode="popLayout" (thay vì "wait"):
                    ảnh bìa mới bắt đầu bay vào NGAY khi ảnh cũ bắt đầu bay ra (chạy
                    song song) thay vì đợi ảnh cũ biến mất hết mới hiện ảnh mới —
                    loại bỏ khoảng "đứng hình" ~150-200ms mỗi lần chuyển bài. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={current.id}
                    initial={{ opacity: 0, scale: 0.82, x: -90, rotate: -12 }}
                    animate={{ opacity: 1, scale: 1, x: 0, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.82, x: 130, rotate: 18 }}
                    transition={springSmooth}
                    className="relative flex items-center justify-center my-2 w-full"
                  >
                    {/* Spinning Vinyl Record Disc - Continuous Center Rotation */}
                    <motion.div
                      animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                      transition={
                        isPlaying
                          ? { rotate: { repeat: Infinity, duration: 18, ease: "linear" } }
                          : { duration: 0.5 }
                      }
                      style={{ transformOrigin: "center center" }}
                      className={cn(
                        "absolute size-[min(36vh,280px)] rounded-full border-4 border-neutral-900 bg-neutral-950 shadow-2xl pointer-events-none transition-all duration-700 z-0",
                        isPlaying ? "translate-x-12 md:translate-x-16 opacity-95" : "translate-x-0 opacity-0",
                      )}
                    >
                      <div className="absolute inset-4 rounded-full border border-neutral-800/60" />
                      <div className="absolute inset-8 rounded-full border border-neutral-800/40" />
                      <div className="absolute inset-12 rounded-full border border-neutral-800/60" />
                      <div className="absolute inset-16 rounded-full border border-neutral-800/40" />
                      <div className="bg-primary/20 border-primary/40 absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full border">
                        <div className="bg-background size-4 rounded-full" />
                      </div>
                    </motion.div>

                    {/* Album / Track Artwork Image with Smart Aspect Ratio Auto-Adjustment */}
                    <div
                      className={cn(
                        "relative z-10 rounded-2xl overflow-hidden shadow-[0_25px_80px_-15px_oklch(0_0_0/0.95)] border border-white/10 transition-all duration-500 bg-neutral-900",
                        isLandscape
                          ? "w-full max-w-[min(48vh,400px)] aspect-video"
                          : "aspect-square w-full max-w-[min(36vh,280px)] md:max-w-[min(38vh,300px)]"
                      )}
                    >
                      <motion.img
                        src={cleanCoverUrl || fallbackCover}
                        alt={`Bìa ${current.title}`}
                        decoding="async"
                        onLoad={handleImageLoad}
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (target.src !== fallbackCover) {
                            target.src = fallbackCover;
                          }
                        }}
                        animate={{ scale: isPlaying ? 1 : 0.96 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                        className="size-full object-cover rounded-2xl"
                      />
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Track Title, Visualizer & Controls */}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={`info-${current.id}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={tweenBase}
                    className="w-full max-w-sm text-center"
                  >
                    <h1 className="font-display text-2xl md:text-4xl truncate">{current.title}</h1>
                    <p className="text-muted-foreground mt-1 text-xs md:text-sm truncate">
                      {current.artist} — {album?.title || "Single Collection"} ({album?.year || 2026})
                    </p>

                    <Visualizer playing={isPlaying} bars={36} height={38} className="mt-4" />

                    <div className="mt-2">
                      <SeekBar />
                      <NowPlayingTimeLabel duration={current.duration} />
                    </div>

                    <div className="mt-4 flex justify-center">
                      <TransportControls size="lg" />
                    </div>
                  </motion.div>
                </AnimatePresence>
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