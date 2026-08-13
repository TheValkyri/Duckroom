import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Maximize2, Pause, Play, Trash2, Volume2, VolumeX } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { deleteVideo, formatTime, videoById } from "../data/library";
import { usePlayer } from "../lib/player";

import { useLibrary } from "../lib/useLibrary";

export const Route = createFileRoute("/videos/$videoId")({
  loader: ({ params }) => {
    const video = videoById(params.videoId);
    return { video, videoId: params.videoId };
  },
  head: ({ loaderData }) => {
    const t = loaderData?.video?.title ?? "Video";
    return {
      meta: [
        { title: `${t} — Duckroom` },
        { name: "description", content: `Xem ${t} ở độ phân giải và bitrate gốc.` },
        { property: "og:title", content: `${t} — Duckroom` },
        { property: "og:description", content: `Xem ${t} ở độ phân giải và bitrate gốc.` },
      ],
    };
  },
  component: VideoPage,
});

function VideoPage() {
  const { video: loadedVideo, videoId: paramVideoId } = Route.useLoaderData();
  const { videos } = useLibrary();
  const { pause: pauseAudioPlayer } = usePlayer();
  const navigate = useNavigate();

  const video = loadedVideo || videoById(paramVideoId);
  if (!video) {
    throw notFound();
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(video.duration);
  const [isMuted, setIsMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const videoSrc = video.src || `/api/stream/video/${video.id}`;

  const handleDeleteVideo = async () => {
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
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/videos"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" /> Tất cả MV
        </Link>
        <button
          type="button"
          onClick={handleDeleteVideo}
          className="text-muted-foreground hover:text-destructive border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
        >
          <Trash2 className="size-3.5" />
          <span>Xóa MV này</span>
        </button>
      </div>

      <motion.div
        ref={containerRef}
        layoutId={`video-${video.id}`}
        className="group relative overflow-hidden rounded-xl bg-black shadow-2xl"
      >
        <video
          ref={videoRef}
          src={videoSrc}
          poster={video.thumb}
          playsInline
          className="aspect-video w-full object-contain"
          onPlay={() => {
            pauseAudioPlayer();
            setIsPlaying(true);
            setHasStarted(true);
          }}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={() => {
            if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            if (videoRef.current) setVideoDuration(videoRef.current.duration);
          }}
          onClick={handlePlayVideo}
        />

        {/* Big play button overlay when not started or paused */}
        {(!hasStarted || !isPlaying) && (
          <button
            onClick={handlePlayVideo}
            className="bg-background/30 absolute inset-0 grid place-items-center backdrop-blur-[2px] transition-colors hover:bg-background/20"
            aria-label={isPlaying ? "Tạm dừng video" : "Phát video"}
          >
            <span className="bg-primary text-primary-foreground grid size-20 place-items-center rounded-full shadow-2xl transition-transform hover:scale-105">
              <Play className="size-7 translate-x-px" fill="currentColor" />
            </span>
          </button>
        )}

        {/* Video Control Bar */}
        {hasStarted && (
          <div className="glass absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 opacity-0 transition-opacity group-hover:opacity-100">
            <input
              type="range"
              min={0}
              max={videoDuration || 1}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const t = Number(e.target.value);
                setCurrentTime(t);
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              className="accent-primary h-1 w-full cursor-pointer"
              aria-label="Tiến trình video"
            />
            <div className="flex items-center justify-between text-xs text-white">
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePlayVideo}
                  aria-label={isPlaying ? "Tạm dừng" : "Phát"}
                  className="hover:text-primary transition-colors"
                >
                  {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" fill="currentColor" />}
                </button>
                <button
                  onClick={() => {
                    setIsMuted(!isMuted);
                    if (videoRef.current) videoRef.current.muted = !isMuted;
                  }}
                  aria-label={isMuted ? "Bật tiếng" : "Tắt tiếng"}
                  className="hover:text-primary transition-colors"
                >
                  {isMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </button>
                <span className="tabular-nums">
                  {formatTime(currentTime)} / {formatTime(videoDuration)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="border-border rounded border px-2 py-0.5 text-[10px] uppercase font-semibold text-primary">
                  {video.resolution} · {video.codec}
                </span>
                <button
                  onClick={handleFullscreen}
                  aria-label="Toàn màn hình"
                  className="hover:text-primary transition-colors"
                >
                  <Maximize2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>

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