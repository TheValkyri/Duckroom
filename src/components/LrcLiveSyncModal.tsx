import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { beautifyLrcString } from "../lib/lyrics-formatter";
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
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

        // If it was all 00:00.00, treat as unstamped
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
    // Find first unstamped line
    const firstUnstamped = parsed.findIndex((item) => item.timeSec === null);
    setCurrentIndex(firstUnstamped !== -1 ? firstUnstamped : 0);
  }, [isOpen, initialLyrics]);

  // Create Object URL for audio file
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  // Audio time update loop
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
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
  }, [audioUrl]);

  // Auto scroll to current line
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

  // Adjust specific line time
  const handleNudgeTime = (index: number, delta: number) => {
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== index) return line;
        const baseTime = line.timeSec ?? currentTime;
        const newTime = Math.max(0, parseFloat((baseTime + delta).toFixed(2)));
        return { ...line, timeSec: newTime };
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
      // Don't intercept if user is typing in an input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
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
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 3);
      } else if (e.code === "ArrowRight" && audioRef.current) {
        e.preventDefault();
        audioRef.current.currentTime = Math.min(
          duration || 9999,
          audioRef.current.currentTime + 3
        );
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

  // Reset all timestamps
  const handleResetTimestamps = () => {
    if (confirm("Bạn có chắc muốn xóa tất cả mốc thời gian để chấm lại từ đầu?")) {
      setLines((prev) => prev.map((l) => ({ ...l, timeSec: null })));
      setCurrentIndex(0);
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
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-card/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-foreground"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/40">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold">
                🎙️
              </div>
              <div>
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                  <span>Chấm nhịp theo giọng hát nghệ sĩ (Live Sync Editor)</span>
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Khớp 100% từng từ
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  Bật nhạc phát, khi nghệ sĩ hát đến câu nào, bấm <strong>[Phím Cách / Space]</strong>{" "}
                  để gán đúng mốc giây đó.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Audio Player Controller Bar */}
          {audioUrl && (
            <div className="px-6 py-3.5 bg-card border-b border-border flex flex-wrap items-center justify-between gap-4">
              <audio ref={audioRef} src={audioUrl} />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform shadow-md cursor-pointer"
                >
                  {isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = 0;
                      setCurrentIndex(0);
                    }
                  }}
                  className="size-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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

              {/* Scrubber */}
              <div className="flex-1 min-w-[200px] flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCurrentTime(val);
                    if (audioRef.current) audioRef.current.currentTime = val;
                  }}
                  className="w-full accent-primary h-1.5 bg-muted rounded-lg cursor-pointer"
                />
              </div>

              {/* Big spacebar trigger button */}
              <button
                type="button"
                onClick={handleStampCurrentLine}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all hover:scale-102 cursor-pointer active:scale-98"
              >
                <Zap className="size-4 fill-current" />
                <span>Chấm nhịp câu này [Space]</span>
              </button>
            </div>
          )}

          {/* Body: Lyric Lines View */}
          <div
            ref={listContainerRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 max-h-[50vh] bg-background/50"
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
                      "group flex items-center justify-between gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                      isSelected
                        ? "bg-primary/15 border-primary/50 shadow-md ring-1 ring-primary/30"
                        : isStamped
                        ? "bg-card/70 border-white/5 hover:border-white/20"
                        : "bg-muted/20 border-dashed border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          "font-mono text-xs px-2.5 py-1 rounded-md border text-center min-w-[76px]",
                          isStamped
                            ? "bg-primary/20 text-primary border-primary/30 font-semibold"
                            : "bg-muted/40 text-muted-foreground border-border"
                        )}
                      >
                        {item.timeSec !== null ? formatSecToMmSsMs(item.timeSec) : "--:--.--"}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-medium truncate",
                          isSelected ? "text-primary font-bold" : isStamped ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {item.text}
                      </span>
                    </div>

                    {/* Fine-tune Nudge Buttons */}
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, -0.2);
                        }}
                        className="size-7 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-xs"
                        title="Giảm 0.2s"
                      >
                        <Minus className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNudgeTime(idx, 0.2);
                        }}
                        className="size-7 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-xs"
                        title="Tăng 0.2s"
                      >
                        <Plus className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentIndex(idx);
                          handleStampCurrentLine();
                        }}
                        className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 text-[11px] font-semibold"
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
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-border hover:bg-accent transition-colors"
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
                className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-xl border border-border hover:bg-accent transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleCompleteAndSave}
                className="px-5 py-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-md flex items-center gap-2 transition-transform hover:scale-102"
              >
                <Check className="size-4" />
                <span>Hoàn tất & Áp dụng LRC</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
