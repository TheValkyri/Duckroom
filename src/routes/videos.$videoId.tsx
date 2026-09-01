import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Maximize2, Minimize2, Pause, Play, Trash2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteVideo, formatTime, videoById } from "../data/library";
import { useAuth } from "../lib/useAuth";
import { ShareMenu } from "../components/ShareMenu";
import { useLibrary } from "../lib/useLibrary";
import { usePlayer } from "../lib/player";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/videos/$videoId")({
  loader: ({ params }) => {
    const video = videoById(params.videoId);
    return { video, videoId: params.videoId };
  },
  head: ({ loaderData }) => {
    const t = loaderData?.video?.title ?? "Video";
    const thumb = loaderData?.video?.thumb || "https://duckroom.vercel.app/og-image.jpg";
    return {
      meta: [
        { title: `${t} — Duckroom` },
        { name: "description", content: `Xem ${t} ở độ phân giải và bitrate gốc.` },
        { property: "og:site_name", content: "Duckroom" },
        { property: "og:title", content: `${t} — Duckroom` },
        { property: "og:description", content: `Xem ${t} ở độ phân giải và bitrate gốc.` },
        { property: "og:image", content: thumb },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: thumb },
      ],
    };
  },
  component: VideoPage,
});

function VideoPage() {
  const { video: loadedVideo, videoId: paramVideoId } = Route.useLoaderData();
  const { videos } = useLibrary();
  const { pause: pauseAudioPlayer } = usePlayer();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const video = loadedVideo || videoById(paramVideoId);
  if (!video) {
    throw notFound();
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [videoDuration, setVideoDuration] = useState(video.duration);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimer = useRef<number | null>(null);
  /** Thời gian hiện tại giữ ở ref — label chỉ đọc khi cần (perf: không
   *  setState mỗi tick; label cập nhật theo rAF throttle nội bộ). */
  const timeLabelRef = useRef(0);
  const [timeLabel, setTimeLabel] = useState(0);

  // Fail-closed: only a real signed playback URL is usable. There is no
  // /api/stream route in this app — a fabricated URL would just 404.
  const videoSrc = video.src || "";

  /** BẬT controls + hẹn giờ tự ẩn sau 2.6s (kiểu YouTube/ hệ TV).
   *  Fix 2026-09-01: trước đây control bar chỉ hiện qua group-hover —
   *  TRÊN CẢM ỨNG KHÔNG CÓ HOVER → người dùng không thể tương tác gì
   *  ngoài play/pause (đúng như feedback "MV không ấn vào được"). */
  const showControls = () => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(() => {
      // Không tự ẩn khi đang pause — người dùng cần nhìn thấy nút play.
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2600);
  };
  const hideControlsNow = () => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
  };

  const handleFullscreenChange = () => {
    setIsFullscreen(Boolean(document.fullscreenElement));
  };

  // Đồng bộ icon fullscreen qua DOM event (React types chưa có prop
  // onFullscreenChange; listener thủ công là cách chuẩn).
  useEffect(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  const handleDeleteVideo = async () => {
    if (!isLoggedIn) return;
    if (confirm(`Bạn có chắc chắn muốn xóa MV "${video.title}" khỏi Pikamc S3 không?`)) {
      await deleteVideo(video.id);
      void navigate({ to: "/videos" });
    }
  };

  const handlePlayVideo = () => {
    pauseAudioPlayer(); // Stop audio player if it's currently playing
    setHasStarted(true);
    if (videoRef.current) {
      if (videoRef.current.paused) {
        void videoRef.current.play().then(() => setIsPlaying(true));
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void containerRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-12">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/videos"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" /> Tất cả MV
        </Link>
        <div className="flex items-center gap-2.5">
          <ShareMenu compact resourceType="video" resourceId={video.id} title={video.title} />
          {isLoggedIn && (
            <button
              type="button"
              onClick={handleDeleteVideo}
              className="text-muted-foreground hover:text-destructive border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
            >
              <Trash2 className="size-3.5" />
              <span>Xóa MV này</span>
            </button>
          )}
        </div>
      </div>

      {/* PERF 2026-09-01: bỏ layoutId video-* (đo layout cross-page mỗi
          lần vào trang) và bỏ motion wrapper — container tĩnh. */}
      <div
        ref={containerRef}
        className={cn(
          "group relative overflow-hidden bg-black shadow-2xl",
          // Fullscreen fix 2026-09-01: trước đây container giữ aspect-video
          // + rounded trong fullscreen native → video dính mép TRÊN, hở
          // đen dưới (như ảnh 3). Khi fullscreen: chiếm trọn 100vw/100vh,
          // bỏ radius, video object-contain tự center → chuẩn hệ TV.
          isFullscreen ? "h-screen w-screen rounded-none" : "rounded-xl",
        )}
      >
        <video
          ref={videoRef}
          src={videoSrc || undefined}
          poster={video.thumb || undefined}
          preload="metadata"
          playsInline
          className={cn("w-full object-contain", isFullscreen ? "h-full" : "aspect-video")}
          onPlay={() => {
            pauseAudioPlayer();
            setIsPlaying(true);
            setHasStarted(true);
            showControls();
          }}
          onPause={() => {
            setIsPlaying(false);
            showControls(); // pause → luôn hiện controls
          }}
          onTimeUpdate={() => {
            // PERF: ghi trực tiếp vào DOM (width%) — KHÔNG setState mỗi tick
            // (trước đây re-render cả trang ~4 lần/giây khi phát). Label thời
            // gian đồng bộ 1 lần/giây qua so sánh giây nguyên.
            const el = videoRef.current;
            const bar = progressFillRef.current;
            if (el) {
              const d = el.duration || videoDuration || 1;
              if (bar) bar.style.width = `${Math.min(100, (el.currentTime / d) * 100)}%`;
              const wholeSec = Math.floor(el.currentTime);
              if (wholeSec !== timeLabelRef.current) {
                timeLabelRef.current = wholeSec;
                setTimeLabel(wholeSec);
              }
            }
          }}
          onLoadedMetadata={() => {
            if (videoRef.current) setVideoDuration(videoRef.current.duration);
          }}
        />

        {/* Lớp bắt tap: 1 tap = toggle controls; double tap không dùng
            (tránh tranh full-screen gesture của iOS Safari). Chỉ áp dụng
            khi ĐÃ bắt đầu xem — trước đó tap = play. */}
        {hasStarted && (
          <button
            type="button"
            aria-label={controlsVisible ? "Ẩn điều khiển" : "Hiện điều khiển"}
            onClick={() => (controlsVisible ? hideControlsNow() : showControls())}
            onDoubleClick={handleFullscreen}
            className="absolute inset-0 w-full cursor-pointer bg-transparent"
          />
        )}

        {/* Nút play trung tâm — luôn bấm được bằng ngón (không phụ thuộc
            hover), tự ẩn cùng controls khi đang phát. CSS-only transition. */}
        {(!hasStarted || !controlsVisible || !isPlaying) && (
          <button
            type="button"
            onClick={handlePlayVideo}
            aria-label={isPlaying ? "Tạm dừng video" : "Phát video"}
            className={cn(
              "absolute inset-0 grid place-items-center transition-colors duration-200 cursor-pointer",
              !isPlaying && "bg-black/25",
            )}
          >
            <span className="bg-primary text-primary-foreground grid size-[4.5rem] place-items-center rounded-full shadow-2xl transition-transform duration-200 active:scale-90 sm:size-20">
              {isPlaying ? (
                <Pause className="size-7 sm:size-8" fill="currentColor" />
              ) : (
                <Play className="size-7 translate-x-0.5 sm:size-8" fill="currentColor" />
              )}
            </span>
          </button>
        )}

        {/* Control bar — giờ hiện được bằng TAP (không còn group-hover-only).
            Vào/ra bằng opacity+translate (GPU), 44px+ mọi nút. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 origin-bottom pb-safe transition-[opacity,transform] duration-200 ease-out",
            hasStarted && controlsVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          {/* Seek: vùng 44px, track tùy biến + fill width cập nhật DOM-trực-tiếp */}
          <div
            className="group/seek relative flex h-11 items-center px-3 cursor-pointer"
            onClick={(e) => {
              const el = videoRef.current;
              if (!el || !el.duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              el.currentTime = ratio * el.duration;
              showControls();
            }}
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div ref={progressFillRef} className="h-full rounded-full bg-primary" style={{ width: "0%" }} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-1 text-xs text-white">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePlayVideo}
                aria-label={isPlaying ? "Tạm dừng" : "Phát"}
                className="grid size-11 place-items-center rounded-full transition-colors hover:bg-white/10 cursor-pointer"
              >
                {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" fill="currentColor" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !isMuted;
                  setIsMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                }}
                aria-label={isMuted ? "Bật tiếng" : "Tắt tiếng"}
                className="grid size-11 place-items-center rounded-full transition-colors hover:bg-white/10 cursor-pointer"
              >
                {isMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
              <span className="tabular-nums select-none">
                {formatTime(timeLabel)} / {formatTime(videoDuration)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="border-border hidden rounded border px-2 py-0.5 text-[10px] font-semibold uppercase text-primary sm:block">
                {video.resolution} · {video.codec}
              </span>
              <button
                type="button"
                onClick={handleFullscreen}
                aria-label="Toàn màn hình"
                className="grid size-11 place-items-center rounded-full transition-colors hover:bg-white/10 cursor-pointer"
              >
                {isFullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <h1 className="font-display mt-6 text-4xl">{video.title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {video.artist} · {video.year} · {formatTime(video.duration)}
      </p>

      <dl className="border-border mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border md:grid-cols-4">
        {[
          ["Độ phân giải", video.resolution],
          ["Codec", video.codec],
          ["Bitrate", video.bitrate],
          ["Dung lượng", `${(video.sizeMB / 1024).toFixed(1)} GB`],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-5">
            <dt className="text-muted-foreground text-[11px] tracking-wider uppercase">{k}</dt>
            <dd className="mt-1 text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
