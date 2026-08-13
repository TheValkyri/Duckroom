import { ChevronUp, ListMusic, Mic2, Sparkles, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { albumById, formatTime } from "../../data/library";
import { usePlayer } from "../../lib/player";
import { cn } from "../../lib/utils";
import { Visualizer } from "../Visualizer";
import { SeekBar, TransportControls } from "./Controls";
import { QueuePanel } from "./QueuePanel";

export function PlayerBar() {
  const {
    current,
    isPlaying,
    time,
    volume,
    isMuted,
    setVolume,
    toggleMute,
    crossfade,
    setCrossfade,
    setExpanded,
    lyricsOpen,
    setLyricsOpen,
    queueOpen,
    setQueueOpen,
  } = usePlayer();

  if (!current) return null;
  const album = albumById(current.albumId);
  const coverUrl = current.cover || album?.cover;

  return (
    <>
      <AnimatePresence>{queueOpen && <QueuePanel />}</AnimatePresence>
      <motion.footer
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="glass border-border fixed inset-x-0 bottom-0 z-40 border-t"
      >
        <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-8 py-3">
          {/* Left: Track Info & Cover (Stretched to far left) */}
          <div className="flex min-w-0 items-center gap-3 justify-start">
            <button
              onClick={() => setExpanded(true)}
              className="group relative size-14 shrink-0 overflow-hidden rounded-md cursor-pointer"
              aria-label="Mở toàn màn hình"
            >
              <img
                src={coverUrl}
                alt={`Bìa album ${album?.title || current.title}`}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                width={56}
                height={56}
              />
              <span className="bg-background/60 absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                <ChevronUp className="size-5" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{current.title}</p>
              <p className="text-muted-foreground truncate text-xs">
                {current.artist} · {album?.title}
              </p>
            </div>
            <span className="border-border text-primary ml-2 hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] tracking-wide lg:block">
              {current.format} {current.bitDepth}/{current.sampleRate}
            </span>
          </div>

          {/* Center: Controls & WIDER Progress Bar */}
          <div className="flex w-[38vw] max-w-2xl min-w-[280px] flex-col items-center">
            <TransportControls />
            <div className="flex w-full items-center gap-3 mt-0.5">
              <span className="text-muted-foreground w-10 text-right text-[11px] tabular-nums">
                {formatTime(time)}
              </span>
              <div className="flex-1">
                <SeekBar compact />
              </div>
              <span className="text-muted-foreground w-10 text-[11px] tabular-nums">
                {formatTime(current.duration)}
              </span>
            </div>
          </div>

          {/* Right: Controls & Volume (Stretched to far right) */}
          <div className="flex items-center justify-end gap-3 min-w-0">
            <div className="hidden h-6 w-24 shrink-0 items-center overflow-hidden xl:flex">
              <Visualizer
                playing={isPlaying}
                bars={18}
                height={24}
                className="size-full"
              />
            </div>
            <button
              aria-label="Hòa âm Crossfade"
              title={`Hòa âm chuyển bài: ${crossfade > 0 ? `${crossfade} giây (Tự động mix)` : "Tắt"}`}
              onClick={() => setCrossfade(crossfade > 0 ? (crossfade === 10 ? 5 : crossfade === 5 ? 0 : 10) : 10)}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border border-transparent cursor-pointer",
                crossfade > 0 && "text-primary border-primary/30 bg-primary/10",
              )}
            >
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">{crossfade > 0 ? `${crossfade}s` : "Mix Off"}</span>
            </button>
            <button
              aria-label="Lời bài hát"
              onClick={() => setLyricsOpen(!lyricsOpen)}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1.5 rounded-full hover:bg-accent/50",
                lyricsOpen && "text-primary bg-primary/10",
              )}
            >
              <Mic2 className="size-4" />
            </button>
            <button
              aria-label="Hàng đợi"
              onClick={() => setQueueOpen(!queueOpen)}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1.5 rounded-full hover:bg-accent/50",
                queueOpen && "text-primary bg-primary/10",
              )}
            >
              <ListMusic className="size-4" />
            </button>
            <div className="hidden items-center gap-2 md:flex">
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Bật âm thanh" : "Tắt âm thanh"}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="size-4 text-destructive" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                aria-label="Âm lượng"
                onChange={(e) => setVolume(Number(e.target.value))}
                className="accent-primary h-1 w-24 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </motion.footer>
    </>
  );
}