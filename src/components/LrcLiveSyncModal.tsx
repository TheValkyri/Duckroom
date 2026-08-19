import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  FastForward,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  RotateCcw,
  Sliders,
  Sparkles,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { beautifyLrcString, shiftLrcTime } from "../lib/lyrics-formatter";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";

interface SyncLine {
  id: number;
  text: string;
  timeSec: number | null; // null = unstamped
}

interface LrcLiveSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioFile: File | null;
  initialLyrics: string;
  onSave: (lrcString: string) => void;
}

function formatSecToMmSsMs(sec: number): string {
  if (sec < 0) sec = 0;
  const mm = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((sec % 1) * 100)
    .toString()
    .padStart(2, "0");
  return `${mm}:${ss}.${ms}`;
}

export function LrcLiveSyncModal({
  isOpen,
  onClose,
  audioFile,
  initialLyrics,
  onSave,
}: LrcLiveSyncModalProps) {
  const [lines, setLines] = useState<SyncLine[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [globalOffsetMs, setGlobalOffsetMs] = useState<number>(0);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isWaveformGenerating, setIsWaveformGenerating] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Parse initial lyrics into SyncLine[]
  useEffect(() => {
    if (!isOpen) return;

    const raw = initialLyrics.trim();
    if (!raw) {
      setLines([]);
      return;
    }

    const parsed: SyncLine[] = [];
    const rawLines = raw.split(/\r?\n/);
    let idCounter = 1;

    for (const l of rawLines) {
      const lineStr = l.trim();
      if (!lineStr) continue;

      // Check if line already has [mm:ss.xx]
      const match = lineStr.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/);
      if (match) {
        const mm = parseInt(match[1]!, 10);
        const ss = parseInt(match[2]!, 10);
        const ms = match[3] ? parseInt(match[3]!.padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
        const totalSec = mm * 60 + ss + ms;
        const content = match[4]?.trim() || "";

        const isZero = totalSec === 0 && (content.startsWith("[") || match[1] === "00");
        parsed.push({
          id: idCounter++,
          text: content || lineStr,
          timeSec: isZero ? null : totalSec,
        });
      } else {
        parsed.push({
          id: idCounter++,
          text: lineStr,
          timeSec: null,
        });
      }
    }

    setLines(parsed);
    const firstUnstamped = parsed.findIndex((item) => item.timeSec === null);
    setCurrentIndex(firstUnstamped !== -1 ? firstUnstamped : 0);
  }, [isOpen, initialLyrics]);

  // Create Object URL and generate Waveform peaks for audio file
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      setWaveformPeaks([]);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);

    // Generate real audio waveform peaks using OfflineAudioContext
    let isCancelled = false;
    async function extractWaveform() {
      try {
        setIsWaveformGenerating(true);
        const arrayBuffer = await audioFile!.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0);
        const samples = 180; // Number of waveform bars
        const blockSize = Math.floor(rawData.length / samples);
        const peaks: number[] = [];

        for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j] || 0);
          }
          peaks.push(sum / blockSize);
        }

        // Normalize peaks between 0.1 and 1.0
        const maxPeak = Math.max(...peaks, 0.001);
        const normalized = peaks.map((p) => Math.max(0.12, p / maxPeak));

        if (!isCancelled) {
          setWaveformPeaks(normalized);
        }
        await audioCtx.close();
      } catch (err) {
        console.warn("Waveform extraction fallback to default", err);
        // Fallback synthetic wave
        const fallbackPeaks = Array.from({ length: 180 }, (_, i) => 0.2 + 0.6 * Math.sin(i * 0.15) ** 2);
        if (!isCancelled) setWaveformPeaks(fallbackPeaks);
      } finally {
        if (!isCancelled) setIsWaveformGenerating(false);
      }
    }

    void extractWaveform();

    return () => {
      isCancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  // Audio time update loop
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // In preview mode, auto-advance current line based on timestamp
      if (previewMode) {
        const matchingIdx = lines.findIndex((line, i) => {
          const next = lines[i + 1];
          const curTime = line.timeSec;
          const nextTime = next?.timeSec ?? Infinity;
          return curTime !== null && audio.currentTime >= curTime && audio.currentTime < nextTime;
        });
        if (matchingIdx !== -1 && matchingIdx !== currentIndex) {
          setCurrentIndex(matchingIdx);
        }
      }
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl, previewMode, lines, currentIndex]);

  // Render Interactive Canvas Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformPeaks.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / waveformPeaks.length;
    const progress = duration > 0 ? currentTime / duration : 0;
    const playheadX = progress * width;

    // Draw waveform bars
    waveformPeaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = peak * (height - 8);
      const y = (height - barHeight) / 2;
      const isPast = x <= playheadX;

      ctx.fillStyle = isPast ? "oklch(0.78 0.18 55)" : "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.roundRect(x + 1, y, Math.max(1.5, barWidth - 1.5), barHeight, 2);
      ctx.fill();
    });

    // Draw Lyric Markers along waveform
    if (duration > 0) {
      lines.forEach((line) => {
        if (line.timeSec !== null) {
          const markerX = (line.timeSec / duration) * width;
          ctx.fillStyle = "rgba(56, 189, 248, 0.75)";
          ctx.fillRect(markerX - 1, 0, 2, height);
          ctx.beginPath();
          ctx.arc(markerX, 4, 3, 0, Math.PI * 2);
          ctx.fillStyle = "#38bdf8";
          ctx.fill();
        }
      });
    }

    // Draw active Playhead cursor
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(playheadX - 1.5, 0, 3, height);
    ctx.beginPath();
    ctx.arc(playheadX, height / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = "oklch(0.78 0.18 55)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [waveformPeaks, currentTime, duration, lines]);

  // Handle click / drag on waveform timeline
  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioRef.current || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSec = targetRatio * duration;
    audioRef.current.currentTime = targetSec;
    setCurrentTime(targetSec);
  };

  // Auto scroll to current line in list
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex < lineRefs.current.length) {
      const el = lineRefs.current[currentIndex];
      if (el && listContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentIndex]);

  // Stamp current line with current audio time and advance
  const handleStampCurrentLine = () => {
    if (!audioRef.current || currentIndex >= lines.length) return;
    const stampSec = audioRef.current.currentTime;

    setLines((prev) =>
      prev.map((line, idx) => (idx === currentIndex ? { ...line, timeSec: stampSec } : line))
    );

    if (currentIndex < lines.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // Fine-tune Nudge
  const handleNudgeTime = (index: number, deltaSeconds: number) => {
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== index) return line;
        const baseTime = line.timeSec ?? currentTime;
        const newTime = Math.max(0, parseFloat((baseTime + deltaSeconds).toFixed(2)));
        return { ...line, timeSec: newTime };
      })
    );
  };

  // Apply Global Offset (Shift all lines by ms)
  const handleApplyGlobalOffset = (deltaMs: number) => {
    setGlobalOffsetMs((prev) => prev + deltaMs);
    const deltaSec = deltaMs / 1000;
    setLines((prev) =>
      prev.map((line) => {
        if (line.timeSec === null) return line;
        return { ...line, timeSec: Math.max(0, parseFloat((line.timeSec + deltaSec).toFixed(2))) };
      })
    );
  };

  // Play / Pause toggle
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      void audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (!isPlaying && audioRef.current) {
          void audioRef.current.play();
          setIsPlaying(true);
        }
        handleStampCurrentLine();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        if (currentIndex < lines.length - 1) setCurrentIndex((i) => i + 1);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (currentIndex > 0) setCurrentIndex((i) => i - 1);
      } else if (e.code === "ArrowLeft" && audioRef.current) {
        e.preventDefault();
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 2);
      } else if (e.code === "ArrowRight" && audioRef.current) {
        e.preventDefault();
        audioRef.current.currentTime = Math.min(duration || 9999, audioRef.current.currentTime + 2);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isPlaying, currentIndex, lines.length, duration]);

  // Handle Save
  const handleCompleteAndSave = () => {
    if (!lines.length) {
      onClose();
      return;
    }

    const outputLines = lines.map((l) => {
      const ts = l.timeSec !== null ? formatSecToMmSsMs(l.timeSec) : "00:00.00";
      return `[${ts}] ${l.text}`;
    });

    const lrcResult = beautifyLrcString(outputLines.join("\n"));
    onSave(lrcResult);
    onClose();
  };

  const handleResetTimestamps = () => {
    if (confirm("Bạn có chắc muốn xóa tất cả mốc thời gian để chấm lại từ đầu?")) {
      setLines((prev) => prev.map((l) => ({ ...l, timeSec: null })));
      setCurrentIndex(0);
      setGlobalOffsetMs(0);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={springSnappy}
          className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-card/95 border border-white/10 rounded-3xl shadow-2xl overflow-hidden text-foreground backdrop-blur-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/40">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-bold shadow-sm">
                🎙️
              </div>
              <div>
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                  <span>Timeline Waveform Lyrics Editor</span>
                  <span className="text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Chấm nhịp dạng sóng
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bấm <strong>[Space]</strong> khi ca sĩ hát, hoặc kéo thả trực tiếp trên dạng sóng âm thanh bên dưới.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewMode(!previewMode)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer",
                  previewMode
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground border-border hover:bg-accent",
                )}
              >
                <Eye className="size-3.5" />
                <span>{previewMode ? "Đang Preview" : "Chế độ Preview"}</span>
              </button>
              <button
                onClick={onClose}
                className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Interactive Waveform Strip */}
          {audioUrl && (
            <div className="px-6 py-3 bg-black/40 border-b border-border/70 flex flex-col gap-2">
              <div className="relative w-full h-16 rounded-xl bg-background/80 border border-white/5 overflow-hidden cursor-crosshair group">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={64}
                  onClick={handleWaveformClick}
                  className="w-full h-full block"
                />
                {isWaveformGenerating && (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center text-xs text-muted-foreground">
                    Đang dựng dạng sóng âm thanh…
                  </div>
                )}
              </div>

              {/* Global Offset Bar */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-1.5">
                  <Sliders className="size-3.5 text-primary" />
                  <span>Dịch độ trễ toàn bài (Global Offset):</span>
                  <span className="font-mono font-semibold text-foreground px-1.5 py-0.5 rounded bg-muted/60">
                    {globalOffsetMs >= 0 ? `+${globalOffsetMs}ms` : `${globalOffsetMs}ms`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleApplyGlobalOffset(-500)}
                    className="px-2 py-0.5 rounded bg-muted/60 hover:bg-accent text-[11px] font-mono cursor-pointer"
                  >
                    -500ms
                  </button>
                  <button
                    onClick={() => handleApplyGlobalOffset(-100)}
                    className="px-2 py-0.5 rounded bg-muted/60 hover:bg-accent text-[11px] font-mono cursor-pointer"
                  >
                    -100ms
                  </button>
                  <button
                    onClick={() => handleApplyGlobalOffset(100)}
                    className="px-2 py-0.5 rounded bg-muted/60 hover:bg-accent text-[11px] font-mono cursor-pointer"
                  >
                    +100ms
                  </button>
                  <button
                    onClick={() => handleApplyGlobalOffset(500)}
                    className="px-2 py-0.5 rounded bg-muted/60 hover:bg-accent text-[11px] font-mono cursor-pointer"
                  >
                    +500ms
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Audio Player Controller Bar */}
          {audioUrl && (
            <div className="px-6 py-3 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
              <audio ref={audioRef} src={audioUrl} />

              <div className="flex items-center gap-3">
                <motion.button
                  type="button"
                  whileTap={tapScale}
                  transition={springSnappy}
                  onClick={togglePlay}
                  className="size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform shadow-md cursor-pointer"
                >
                  {isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current ml-0.5" />}
                </motion.button>
                <button
                  type="button"
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = 0;
                      setCurrentIndex(0);
                    }
                  }}
                  className="size-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  title="Phát lại từ đầu (0:00)"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <div className="font-mono text-sm font-semibold tracking-wider">
                  <span className="text-primary">{formatSecToMmSsMs(currentTime)}</span>
                  <span className="text-muted-foreground text-xs mx-1">/</span>
                  <span className="text-muted-foreground text-xs">{formatSecToMmSsMs(duration)}</span>
                </div>
              </div>

              {/* Big spacebar trigger button */}
              <motion.button
                type="button"
                whileTap={tapScale}
                transition={springSnappy}
                onClick={handleStampCurrentLine}
                className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <Zap className="size-4 fill-current" />
                <span>Chấm nhịp câu này [Space]</span>
              </motion.button>
            </div>
          )}

          {/* Body: Lyric Lines View */}
          <div
            ref={listContainerRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 max-h-[48vh] bg-background/50"
          >
            {lines.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Chưa có dòng lời bài hát nào. Vui lòng đóng và nhập lời trước khi chấm nhịp.
              </div>
            ) : (
              lines.map((item, idx) => {
                const isSelected = idx === currentIndex;
                const isStamped = item.timeSec !== null;

                return (
                  <div
                    key={item.id}
                    ref={(el) => {
                      lineRefs.current[idx] = el;
                    }}
                    onClick={() => {
                      setCurrentIndex(idx);
                      if (item.timeSec !== null && audioRef.current) {
                        audioRef.current.currentTime = item.timeSec;
                      }
                    }}
                    className={cn(
                      "group flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all cursor-pointer",
                      isSelected
                        ? "bg-primary/15 border-primary/50 shadow-md ring-1 ring-primary/30"
                        : isStamped
                        ? "bg-card/70 border-white/5 hover:border-white/20"
                        : "bg-muted/20 border-dashed border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          "font-mono text-xs px-2.5 py-1 rounded-lg border text-center min-w-[76px]",
                          isStamped
                            ? "bg-primary/20 text-primary border-primary/30 font-semibold"
                            : "bg-muted/40 text-muted-foreground border-border",
                        )}
                      >
                        {item.timeSec !== null ? formatSecToMmSsMs(item.timeSec) : "--:--.--"}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-medium truncate",
                          isSelected ? "text-primary font-bold" : isStamped ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {item.text}
                      </span>
                    </div>

                    {/* Fine-tune Nudge Buttons (±50ms, ±100ms) */}
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, -0.05);
                        }}
                        className="px-1.5 py-1 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-mono"
                        title="Giảm 50ms"
                      >
                        -50ms
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, -0.1);
                        }}
                        className="px-1.5 py-1 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-mono"
                        title="Giảm 100ms"
                      >
                        -100ms
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, 0.1);
                        }}
                        className="px-1.5 py-1 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-mono"
                        title="Tăng 100ms"
                      >
                        +100ms
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, 0.05);
                        }}
                        className="px-1.5 py-1 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-mono"
                        title="Tăng 50ms"
                      >
                        +50ms
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentIndex(idx);
                          handleStampCurrentLine();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 text-[11px] font-semibold cursor-pointer ml-1"
                      >
                        Gán {formatSecToMmSsMs(currentTime)}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 bg-muted/30 border-t border-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetTimestamps}
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1.5 py-1.5 px-3 rounded-xl border border-border hover:bg-accent transition-colors cursor-pointer"
              >
                <RefreshCw className="size-3" />
                <span>Xóa hết nhịp để chấm lại</span>
              </button>
              <span className="text-xs text-muted-foreground">
                Đã chấm:{" "}
                <strong className="text-foreground">
                  {lines.filter((l) => l.timeSec !== null).length}/{lines.length}
                </strong>{" "}
                câu
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-xl border border-border hover:bg-accent transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <motion.button
                type="button"
                whileTap={tapScale}
                transition={springSnappy}
                onClick={handleCompleteAndSave}
                className="px-5 py-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-md flex items-center gap-2 cursor-pointer"
              >
                <Check className="size-4" />
                <span>Hoàn tất & Áp dụng LRC</span>
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
