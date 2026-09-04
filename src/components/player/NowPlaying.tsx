import { ChevronDown, ListMusic, Mic2, SkipForward, X } from "lucide-react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { albumById, formatTime } from "../../data/library";
import { fetchTrackArtworkUrl } from "../../lib/s3";
import { cropBlackLetterbox } from "../../lib/image-crop";
import { springGentle, springSmooth, springSnappy, tapScale, tweenBase } from "../../lib/motion";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { cn } from "../../lib/utils";
import { Visualizer } from "../Visualizer";
import { TransportControls } from "./Controls";
import { WaveformSeekBar } from "./WaveformSeekBar";
import { LyricsPane } from "./Lyrics";
import { SleepTimerMenu } from "./SleepTimerMenu";
import { useIsPhoneLayout } from "../../hooks/use-media-query";

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
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity" }}
            className="absolute inset-0 size-full transform-gpu"
          >
            {/* Dynamic radial color glow */}
            <div
              className="absolute inset-0 opacity-45"
              style={{
                background: `radial-gradient(120% 90% at 50% 30%, ${layer.accent} 0%, transparent 68%)`,
              }}
            />
            {/* Soft blurred artwork aura — PERF 2026-09-01: blur-3xl (64px)
                full-screen trên phone là 1 trong những thứ đắt nhất GPU có
                thể vẽ, MUST re-composite khi có bất kỳ layer nào đè lên.
                Phone: chỉ radial accent (đã vẽ ở trên) + opacity artwork
                mờ, không blur. Desktop ≥md giữ blur đậm (đẹp, và GPU
                desktop chịu được). */}
            <img
              src={layer.cover}
              alt=""
              aria-hidden
              decoding="async"
              className="absolute inset-0 size-full scale-125 object-cover opacity-15 transform-gpu blur-none md:blur-3xl"
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
  const {
    current,
    queue,
    index,
    expanded,
    setExpanded,
    isPlaying,
    lyricsOpen,
    setLyricsOpen,
    queueOpen,
    setQueueOpen,
    next,
    direction,
    // QoL: sleep timer cần pause + volume khi hết giờ.
    pause,
    setVolume,
    volume,
    toggle: togglePlayback,
  } = usePlayer();
  const open = expanded;
  // LƯU Ý: KHÔNG scroll-lock ở đây. Fullscreen player là `fixed inset-0`
  // chiếm toàn viewport + mọi input dưới nó không thể chạm → nền không
  // cuộn được từ đầu. body position:fixed (iOS trick) lại làm LỆCH tọa
  // độ của chính fullscreen (QA bắt parentTop=40, sheet transform sai).
  // useScrollLock dành cho sheets/modals KHÔNG phủ kín màn hình.
  const isPhone = useIsPhoneLayout();
  const phoneDragControls = useDragControls();
  const album = current ? albumById(current.albumId) : undefined;
  // Fallback NỘI BỘ (gradient) — không tải ảnh mạng nữa: trước đây dùng
  // unsplash → mỗi lần chuyển bài lỗi cover là 1 request mạng + flash trắng.
  const fallbackCover =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";
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

  // MOBILE GESTURE (§3.2): swipe-down trên vùng header/artwork thu nhỏ
  // player. Chỉ vùng đánh dấu [data-drag-dismiss] khởi tạo kéo (pointer
  // down → dragControls.start), transport/seek không bị ảnh hưởng.
  // Threshold dọc 72px; ý định ngang (|dx|>|dy|) hủy. Mọi hành động vẫn có
  // nút bấm tương đương ("Thu nhỏ").
  const startDragDismiss = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPhone) return;
    if (e.pointerType === "mouse") return; // desktop dùng nút Thu缩小
    phoneDragControls.start(e);
  };
  const handleDragDismissEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > Math.abs(offset.y)) return; // horizontal intent
    if (offset.y > 72 || (velocity.y > 700 && offset.y > 24)) handleMinimize();
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
          className="bg-background grain fixed inset-0 z-50 flex flex-col justify-between overflow-hidden select-none pb-safe"
        >
          {/* Ambient Dual-Buffer Crossfading Background */}
          <AmbientCrossfadeBackground cover={rawCoverUrl} accent={album?.accent} />

          {/* PHONE lyrics sheet — neo TRỰC TIẾP vào fullscreen root
              (fixed inset-0): top-[4.5rem] bottom-0 = gần full màn hình
              dưới header (feedback: "bấm vào lời là fullscreen luôn").
              Render tại root thay vì trong stage vì stage là flex-1
              chiều cao thay đổi → absolute lệch tọa độ (bug đo được:
              sheet top 856px ngoài viewport). Drag chỉ từ handle. */}
          {isPhone && (
            <PhoneLyricsSheet open={lyricsOpen} onClose={() => setLyricsOpen(false)} trackTitle={current.title} />
          )}

          {/* Top Header Bar — cân đối lại (feedback 2026-09-01: nút sát mép
              trên quá, nhìn lệch). py-3 + min-h để luôn có đệm đều trên/dưới
              nút, pt-safe cho notch; grid 3 cột giữ dấu chấm giữa (next
              pill) và 2 cụm nút có KHOẢNG THỞ ngang đều hai bên. */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleMinimize();
            }}
            data-drag-dismiss
            onPointerDown={startDragDismiss}
            className={cn(
              "relative z-20 grid w-full shrink-0 items-center",
              isPhone
                ? "grid-cols-[3rem_1fr_3rem] gap-2 px-4 pb-1 pt-[calc(0.75rem+var(--safe-top))]"
                : "grid-cols-3 px-6 pb-3 pt-[calc(1rem+var(--safe-top))]",
            )}
          >
            <div className="flex items-center justify-start">
              <motion.button
                onClick={handleMinimize}
                whileTap={tapScale}
                transition={springSnappy}
                aria-label="Thu nhỏ trình phát"
                className={cn(
                  "text-muted-foreground hover:text-foreground flex items-center transition-colors cursor-pointer",
                  isPhone ? "gap-0 rounded-full p-2.5" : "gap-2 text-sm",
                )}
              >
                <ChevronDown className={isPhone ? "size-6" : "size-5"} />
                {!isPhone && <span>Thu nhỏ</span>}
              </motion.button>
            </div>

            {/* Next Track Indicator Pill (Always centered) */}
            <div className="flex items-center justify-center">
              {nextTrack && queue.length > 1 && (
                <motion.button
                  onClick={() => next(true)}
                  whileTap={tapScale}
                  whileHover={{ y: -1 }}
                  transition={springSnappy}
                  className="hidden md:flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground bg-card/60 hover:bg-card/90 border border-white/10 px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm group truncate max-w-sm"
                >
                  <SkipForward className="size-3.5 text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
                  <span className="truncate">
                    Tiếp theo: <strong className="text-foreground font-medium">{nextTrack.title}</strong> —{" "}
                    {nextTrack.artist}
                  </span>
                </motion.button>
              )}
            </div>

            {/* Phải: Hẹn giờ + Lời + Hàng đợi (mobile cần nút hàng đợi vì
                PlayerBar mini không có chỗ; desktop giữ nguyên chỉ "Lời") */}
            <div className="flex items-center justify-end">
              {/* QoL A2: hẹn tắt nhạc (fade êm 30s cuối) */}
              <SleepTimerMenu
                onFinish={() => {
                  pause();
                  setVolume(1);
                }}
                onFadeTick={(v) => setVolume(Math.max(0.02, v))}
              />
              {isPhone && (
                <motion.button
                  onClick={() => setQueueOpen(!queueOpen)}
                  whileTap={tapScale}
                  transition={springSnappy}
                  aria-label="Hàng đợi"
                  className={cn(
                    "text-muted-foreground hover:text-foreground grid place-items-center rounded-full p-2.5 transition-colors cursor-pointer",
                    queueOpen && "text-primary",
                  )}
                >
                  <ListMusic className="size-6" />
                </motion.button>
              )}
              <motion.button
                onClick={() => setLyricsOpen(!lyricsOpen)}
                whileTap={tapScale}
                transition={springSnappy}
                aria-label={lyricsOpen ? "Ẩn lời bài hát" : "Xem lời bài hát"}
                className={cn(
                  "text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors cursor-pointer rounded-full border border-transparent",
                  isPhone ? "p-2.5" : "px-3.5 py-1.5 text-sm",
                  lyricsOpen && "text-primary border-primary/30 bg-primary/10 font-medium",
                )}
              >
                <Mic2 className={isPhone ? "size-6" : "size-4"} />
                {!isPhone && <span>Lời</span>}
              </motion.button>
            </div>
          </div>

          {/* Main Content Stage */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleMinimize();
            }}
            className={cn(
              "relative z-10 flex-1 w-full max-w-6xl mx-auto overflow-hidden flex items-center justify-center",
              isPhone ? "px-4 py-1" : "px-6 py-2",
            )}
          >
            <div className="w-full h-full flex items-center justify-center relative">
              {/* Left Column: Cover + Vinyl Disc + Title + Controls.
                  Phone: cột này là vùng kéo-thả xuống để thu nhỏ player —
                  nhưng chỉ khởi tạo drag khi chạm vào header/artwork (vùng
                  [data-drag-dismiss]); vùng tương tác (seek/transport) không
                  kéo được. Ref-based block thay vì dataset để tránh reflow. */}
              <motion.div
                layout
                transition={springSmooth}
                drag={isPhone ? "y" : false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.35 }}
                dragDirectionLock
                dragListener={false}
                dragControls={phoneDragControls}
                onDragEnd={handleDragDismissEnd}
                className={cn(
                  "flex flex-col items-center justify-center w-full max-w-md shrink-0 z-10",
                  isPhone ? "gap-3" : "gap-5",
                  lyricsOpen ? "lg:mr-auto lg:ml-0" : "mx-auto",
                )}
              >
                {/* Vinyl Record & Sleeve Container: Directional Glide & Tactile Disc */}
                <div
                  data-drag-dismiss
                  onPointerDown={startDragDismiss}
                  className={cn(
                    "relative flex items-center justify-center w-full",
                    isPhone ? "my-1 min-h-[min(38vh,300px)]" : "my-2 min-h-[min(36vh,290px)]",
                  )}
                >
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

                      {/* Album / Track Jacket (Vỏ bìa đĩa).
                          Fix "artwork bị crop" 2026-09-01: trước đây
                          object-cover cắt mép mọi artwork không-square.
                          - Portrait artwork (MV-thumbnail, cover dọc):
                            hiển thị NGUYÊN VẸN (object-contain) trong khung
                            rounded — nền phía sau là chính artwork phóng
                            mờ nên khung không bao giờ "hộp đen".
                          - Square/landscape: giữ cover (đúng aspect khung). */}
                      <div
                        className={cn(
                          "relative z-10 rounded-2xl overflow-hidden shadow-[0_25px_80px_-15px_oklch(0_0_0/0.95)] border border-white/10 transition-all duration-500 bg-neutral-900",
                          isLandscape
                            ? "w-full max-w-[min(48vh,400px)] aspect-video"
                            : isPhone
                              ? "aspect-square w-full max-w-[min(44vh,320px)]"
                              : "aspect-square w-full max-w-[min(34vh,270px)] md:max-w-[min(36vh,290px)]",
                        )}
                      >
                        {/* Nền artwork-blur phía trong khung cho chế độ
                            contain (portrait) — che "hộp đen" hai bên */}
                        <img
                          src={cleanCoverUrl || rawCoverUrl}
                          alt=""
                          aria-hidden
                          decoding="async"
                          className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-xl"
                        />
                        <motion.img
                          src={cleanCoverUrl || rawCoverUrl}
                          alt={`Bìa ${current.title}`}
                          decoding="async"
                          onLoad={handleImageLoad}
                          onError={async (e) => {
                            const target = e.currentTarget;
                            if (current?.id) {
                              try {
                                const freshCover = await fetchTrackArtworkUrl(current.id);
                                if (freshCover && freshCover !== target.src) {
                                  target.src = freshCover;
                                  setCleanCoverUrl(freshCover);
                                  return;
                                }
                              } catch {
                                // fallback below
                              }
                            }
                            if (target.src !== fallbackCover) {
                              target.src = fallbackCover;
                            }
                          }}
                          animate={{ scale: isPlaying ? 1 : 0.97 }}
                          transition={{ type: "spring", stiffness: 220, damping: 20 }}
                          className={cn(
                            "relative size-full rounded-2xl",
                            isLandscape ? "object-cover" : "object-contain",
                          )}
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
                        <h1 className="font-display truncate text-foreground text-xl sm:text-2xl md:text-4xl">
                          {current.title}
                        </h1>
                        <p className="text-muted-foreground mt-1 truncate text-xs md:text-sm">
                          {current.artist} — {album?.title || "Single Collection"}
                          {(current.year ?? album?.year) ? ` (${current.year ?? album?.year})` : ""}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Fixed Stable Visualizer, Seekbar & Controls (NEVER remounts or jumps).
                      Phone (feedback "visualizer bị phèn"): visualizer canvas
                      thu gọn thành 1 dải mini 16px phía dưới, và NGAY DƯỚI
                      title là dòng LỜI ĐANG PHÁT (current lyric line) mượt
                      bằng CSS mask fade 2 bên — lời "chảy" trên player ngay
                      cả khi sheet chưa mở. */}
                  {isPhone ? (
                    <PhoneCurrentLyricLine />
                  ) : (
                    <Visualizer playing={isPlaying} bars={36} height={38} className="mt-3" />
                  )}
                  {isPhone && <Visualizer playing={isPlaying} bars={28} height={16} className="mt-2 opacity-70" />}

                  <div className="mt-2">
                    {/* F5 2026-09-04: WAVEFORM SEEKBAR — sóng THẬT của bài
                        (decode client-side, cache per-track) thay thanh
                        trơn. Fallback trung thực về thanh mảnh nếu peaks
                        chưa sẵn (đang fetch/decode lỗi) — không fake. */}
                    <WaveformSeekBar height={isPhone ? 40 : 52} />
                    <NowPlayingTimeLabel duration={current.duration} />
                  </div>

                  <div className="mt-4 flex justify-center pb-safe">
                    <TransportControls size="lg" />
                  </div>
                </div>
              </motion.div>

              {/* Lyrics — REDESIGN PHONE (feedback 2026-09-01: "khung viền
                  đen rất kỳ"). Trước đây: overlay phủ toàn màn với gradient
                  nền đen → cảm giác như một KHUNG đen. Giờ đúng chuẩn app
                  nhạc: LỜI LÀ MỘT BOTTOM SHEET có handle kéo, surface
                  mờ liền mạch (glass), kéo-thả để đóng, NỘI DUNG phía sau
                  (artwork + progress) vẫn nhìn thấy ở trên — mở/đóng là
                  một chuyển động không gian có lý do (từ dưới lên như
                  QueueSheet). Desktop giữ right-half overlay như cũ. */}
              <AnimatePresence>
                {lyricsOpen && !isPhone && (
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

          {/* Bottom Padding Bar (desktop); phone đã được pb-safe ở stage */}
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

/**
 * PhoneCurrentLyricLine — dòng lời đang phát hiển thị ngay dưới title
 * trên phone (feedback: muốn "lời chạy trên player luôn"). Subscriber DUY
 * NHẤT là time; active line được tính bằng binary search rồi setState CHỈ
 * khi index đổi (2-4 lần/phút) — không phải mỗi tick. CSS mask fade 2 bên,
 * đổi chữ bằng key AnimatePresence để dòng mới trượt nhẹ lên (có lý do:
 * người dùng theo dõi lời theo thời gian thực).
 */
function PhoneCurrentLyricLine() {
  const { current } = usePlayer();
  const time = usePlayerTime();
  const lines = current?.lyrics ?? [];
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l && time >= l.time) idx = i;
    }
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, [time, lines]);

  if (!lines.length) return null;
  const line = lines[Math.max(0, activeIdx)];

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

/**
 * PhoneLyricsSheet — lyrics dạng bottom-sheet cho fullscreen phone player
 * (redesign 2026-09-01 theo feedback: bỏ overlay "khung đen", thay bằng
 * sheet kéo lên có handle — cùng ngôn ngữ chuyển động với QueueSheet nên
 * cả app nhất quán: "mở cái gì từ dưới lên, kéo xuống để đóng").
 * Surface dùng glass (blur 12px) trên nền ambient — sheet là MỘT bề mặt
 * liền, không phải khung viền.
 */
function PhoneLyricsSheet({ open, onClose, trackTitle }: { open: boolean; onClose: () => void; trackTitle: string }) {
  // Đóng bằng: nút X, hoặc kéo HANDLE xuống (pointer thủ công).
  // Vào/ra bằng CSS keyframes (PERF + fix bug motion: AnimatePresence lồng
  // trong NowPlaying giữ transform y:100% mãi mãi — QA bắt được
  // matrix(1,0,0,1,0,772) treo; animation CSS keyframes không thể treo vì
  // mỗi lần mount chạy đúng 1 lần, unmount là biến mất).
  const handleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handle = handleRef.current;
    if (!handle) return;
    let startY = 0;
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      if (e.clientY - startY > 80) {
        dragging = false;
        onClose();
      }
    };
    const onUp = () => {
      dragging = false;
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Lời bài hát: ${trackTitle}`}
      className="lyrics-sheet-in absolute inset-x-0 top-[4.5rem] bottom-0 z-40 flex flex-col rounded-t-[28px] border-t border-white/10 bg-card/92 backdrop-blur-md pb-safe"
    >
      {/* Handle: kéo xuống để đóng (pointer capture thủ công) */}
      <div
        ref={handleRef}
        className="flex cursor-grab justify-center pt-2.5 pb-1.5 active:cursor-grabbing touch-none"
        aria-hidden
      >
        <div className="h-1.5 w-10 rounded-full bg-white/25" />
      </div>
      <div className="flex items-center justify-between px-5 pt-1.5 pb-2 shrink-0">
        <span className="text-primary text-[11px] font-semibold uppercase tracking-[0.22em] truncate">
          {trackTitle}
        </span>
        <button
          onClick={onClose}
          aria-label="Đóng lời bài hát"
          className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-9 place-items-center rounded-full transition-colors cursor-pointer"
        >
          <X className="size-4.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <LyricsPane compact />
      </div>
    </div>
  );
}
