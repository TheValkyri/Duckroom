import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { tracks as allTracks, type Track } from "../data/library";
import { createPresignedUrl } from "./s3";
import { extractS3KeyFromUrl } from "./s3-key";

export type RepeatMode = "off" | "all" | "one";

type PlayerState = {
  queue: Track[];
  index: number;
  current: Track | undefined;
  isPlaying: boolean;
  time: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  crossfade: number; // seconds, default 10
  expanded: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playQueue: (list: Track[], startIndex?: number, shuffleNow?: boolean) => void;
  toggle: () => void;
  pause: () => void;
  next: (manual?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setCrossfade: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setExpanded: (v: boolean) => void;
  setLyricsOpen: (v: boolean) => void;
  setQueueOpen: (v: boolean) => void;
  jumpTo: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
};

const Ctx = createContext<PlayerState | null>(null);

export const usePlayer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
};

function shuffled<T>(arr: T[], keepFirst?: T): T[] {
  const rest = arr.filter((x) => x !== keepFirst);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as T, rest[i] as T];
  }
  return keepFirst ? [keepFirst, ...rest] : rest;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [baseQueue, setBaseQueue] = useState<Track[]>(allTracks);
  const [queue, setQueue] = useState<Track[]>(allTracks);
  const [index, setIndex] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [crossfade, setCrossfadeState] = useState<number>(10); // Default 10s crossfade!
  const [expanded, setExpanded] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Active channel selector for dual-buffer gapless crossfade ('A' or 'B')
  const [activeChannel, setActiveChannel] = useState<"A" | "B">("A");

  const current = queue[index];
  const nextTrack = queue[(index + 1) % queue.length];

  const audioRefA = useRef<HTMLAudioElement | null>(null);
  const audioRefB = useRef<HTMLAudioElement | null>(null);

  const primaryAudioRef = activeChannel === "A" ? audioRefA : audioRefB;
  const secondaryAudioRef = activeChannel === "A" ? audioRefB : audioRefA;

  const effectiveVolume = isMuted ? 0 : volume;

  // Sync volume to active primary audio element
  useEffect(() => {
    if (primaryAudioRef.current) {
      primaryAudioRef.current.volume = effectiveVolume;
    }
  }, [effectiveVolume, primaryAudioRef]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (v > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      if (!muted) {
        setPrevVolume(volume > 0 ? volume : 0.8);
        return true;
      } else {
        if (volume === 0) setVolumeState(prevVolume);
        return false;
      }
    });
  }, [volume, prevVolume]);

  const pause = useCallback(() => {
    setPlaying(false);
    if (audioRefA.current && !audioRefA.current.paused) audioRefA.current.pause();
    if (audioRefB.current && !audioRefB.current.paused) audioRefB.current.pause();
  }, []);

  const playQueue = useCallback(
    (list: Track[], startIndex = 0, shuffleNow?: boolean) => {
      const start = list[startIndex];
      const useShuffle = shuffleNow ?? shuffle;
      const nextList = useShuffle && start ? shuffled(list, start) : list;
      setBaseQueue(list);
      setQueue(nextList);
      setIndex(useShuffle ? 0 : startIndex);
      setTime(0);

      // Reset secondary audio
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.src = "";
      }

      if (primaryAudioRef.current) primaryAudioRef.current.currentTime = 0;
      setPlaying(true);
      if (shuffleNow !== undefined) setShuffle(shuffleNow);
    },
    [shuffle, primaryAudioRef, secondaryAudioRef],
  );

  const next = useCallback(
    (manual = false) => {
      setTime(0);
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.src = "";
      }
      if (primaryAudioRef.current) primaryAudioRef.current.currentTime = 0;

      setIndex((i) => {
        if (repeat === "one" && !manual) {
          if (primaryAudioRef.current && current?.src) {
            void primaryAudioRef.current.play().catch(() => undefined);
          }
          return i;
        }
        if (i + 1 < queue.length) return i + 1;
        if (repeat === "all" || manual) return 0;
        setPlaying(false);
        return i;
      });
    },
    [queue.length, repeat, current?.src, primaryAudioRef, secondaryAudioRef],
  );

  const prev = useCallback(() => {
    setTime(0);
    if (secondaryAudioRef.current) {
      secondaryAudioRef.current.pause();
      secondaryAudioRef.current.src = "";
    }
    if (primaryAudioRef.current) primaryAudioRef.current.currentTime = 0;
    if (time > 4) {
      return;
    }
    setIndex((i) => (i - 1 + queue.length) % queue.length);
  }, [queue.length, time, primaryAudioRef, secondaryAudioRef]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const on = !s;
      const cur = queue[index];
      if (on && cur) {
        setQueue(shuffled(baseQueue, cur));
        setIndex(0);
      } else if (cur) {
        setQueue(baseQueue);
        setIndex(Math.max(0, baseQueue.indexOf(cur)));
      }
      return on;
    });
  }, [baseQueue, index, queue]);

  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    [],
  );

  const moveInQueue = useCallback(
    (from: number, to: number) => {
      setQueue((q) => {
        const copy = [...q];
        const [item] = copy.splice(from, 1);
        if (!item) return q;
        copy.splice(to, 0, item);
        return copy;
      });
      setIndex((i) => {
        if (i === from) return to;
        if (from < i && to >= i) return i - 1;
        if (from > i && to <= i) return i + 1;
        return i;
      });
    },
    [],
  );

  const secLoadedTrackIdRef = useRef<string | null>(null);

  // Pre-load next track into secondary audio buffer in advance for 100% gapless crossfade
  useEffect(() => {
    const secEl = secondaryAudioRef.current;
    if (!secEl || !nextTrack || queue.length <= 1 || crossfade <= 0 || repeat === "one") return;

    if (secLoadedTrackIdRef.current === nextTrack.id) return;

    let isCancelled = false;
    async function prepareSecondaryAudio() {
      let targetSrc = nextTrack.src || `/api/stream/track/${nextTrack.id}`;
      const s3Key = extractS3KeyFromUrl(targetSrc);
      if (s3Key && !targetSrc.includes("X-Amz-Signature")) {
        try {
          const freshSignedUrl = await createPresignedUrl(s3Key);
          if (!isCancelled && freshSignedUrl) {
            targetSrc = freshSignedUrl;
          }
        } catch (err) {
          console.error("Secondary presigned URL fetch failed:", err);
        }
      }

      if (isCancelled || !secEl) return;
      secEl.src = targetSrc;
      secEl.load();
      secLoadedTrackIdRef.current = nextTrack.id;
    }

    void prepareSecondaryAudio();

    return () => {
      isCancelled = true;
    };
  }, [nextTrack?.id, crossfade, queue.length, repeat, secondaryAudioRef]);

  // Unified Primary Audio Source & Play/Pause Controller (Imperative management, zero JSX attribute mutation)
  useEffect(() => {
    const el = primaryAudioRef.current;
    if (!el || !current || !current.src) return;

    let isCancelled = false;

    async function syncAudioSource() {
      let targetSrc = current.src;
      const s3Key = extractS3KeyFromUrl(targetSrc);

      if (s3Key && !targetSrc.includes("X-Amz-Signature")) {
        try {
          const freshSignedUrl = await createPresignedUrl(s3Key);
          if (isCancelled) return;
          if (freshSignedUrl) {
            targetSrc = freshSignedUrl;
          }
        } catch (err) {
          console.error("Presigned URL fetch failed:", err);
        }
      }

      if (isCancelled || !el) return;

      // CRITICAL GAPLESS FIX: If element is ALREADY playing this track (via crossfade handover), NEVER reload or reset!
      if (el.src && (el.src === targetSrc || el.src.includes(current.id))) {
        if (isPlaying && el.paused) {
          try {
            await el.play();
          } catch (err) {
            console.warn("Audio play warning:", err);
          }
        } else if (!isPlaying && !el.paused) {
          el.pause();
        }
        return;
      }

      el.src = targetSrc;
      el.load();

      if (isPlaying) {
        try {
          await el.play();
        } catch (err) {
          console.warn("Audio play warning:", err);
        }
      } else {
        el.pause();
      }
    }

    void syncAudioSource();

    return () => {
      isCancelled = true;
    };
  }, [current?.id, isPlaying, primaryAudioRef]);

  // High-performance Dual-Channel Crossfade & Metadata Listener
  useEffect(() => {
    const el = primaryAudioRef.current;
    const secEl = secondaryAudioRef.current;
    if (!el || !current) return;

    const onMetadata = () => {
      if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
        const realDur = Math.round(el.duration);
        if (current.duration !== realDur) {
          current.duration = realDur;
        }
      }
    };

    const onTime = () => {
      if (!isPlaying) {
        if (el && !el.paused) el.pause();
        if (secEl && !secEl.paused) secEl.pause();
        return;
      }

      const currentTime = el.currentTime;
      setTime(currentTime);

      const dur = el.duration || current.duration || 1;
      const remaining = dur - currentTime;
      const windowSec = Math.min(crossfade, Math.floor(dur / 3));

      // Automated Crossfade Engine (Disabled when Repeat 1 Song is active)
      if (crossfade > 0 && windowSec > 0 && remaining <= windowSec && nextTrack && queue.length > 1 && repeat !== "one") {
        const primaryVol = Math.max(0, Math.min(effectiveVolume, effectiveVolume * (remaining / windowSec)));
        const secVol = Math.max(0, Math.min(effectiveVolume, effectiveVolume * (1 - remaining / windowSec)));

        el.volume = primaryVol;

        if (secEl) {
          secEl.volume = secVol;
          if (secEl.paused && isPlaying) {
            void secEl.play().catch((err) => {
              console.warn("Secondary audio play error:", err);
            });
          }
        }
      } else {
        el.volume = effectiveVolume;
        if (secEl && !secEl.paused) {
          secEl.pause();
          secEl.currentTime = 0;
        }
      }
    };

    const onEnded = () => {
      if (secEl && !secEl.paused && nextTrack && queue.length > 1 && repeat !== "one") {
        // Dual-Buffer Swap: secondary channel is ALREADY playing nextTrack seamlessly at second 10!
        secEl.volume = effectiveVolume;
        secLoadedTrackIdRef.current = null;
        setActiveChannel((ch) => (ch === "A" ? "B" : "A"));
        setIndex((i) => (i + 1) % queue.length);
      } else {
        secLoadedTrackIdRef.current = null;
        next();
      }
    };

    el.addEventListener("loadedmetadata", onMetadata);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);

    if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
      onMetadata();
    }

    return () => {
      el.removeEventListener("loadedmetadata", onMetadata);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [current, nextTrack, crossfade, effectiveVolume, isPlaying, next, queue.length, repeat, primaryAudioRef, secondaryAudioRef]);

  const seek = useCallback(
    (t: number) => {
      setTime(t);
      if (primaryAudioRef.current) {
        primaryAudioRef.current.currentTime = t;
        primaryAudioRef.current.volume = effectiveVolume;
      }
      // Instantly kill secondary crossfade audio when seeking!
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.volume = 0;
      }
    },
    [primaryAudioRef, secondaryAudioRef, effectiveVolume],
  );

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/input|textarea/i.test(el.tagName) || el.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) next(true);
      else if (e.key === "ArrowLeft" && e.shiftKey) prev();
      else if (e.key.toLowerCase() === "s") toggleShuffle();
      else if (e.key.toLowerCase() === "r") cycleRepeat();
      else if (e.key.toLowerCase() === "l") setLyricsOpen((v) => !v);
      else if (e.key === "Escape") {
        setLyricsOpen(false);
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, prev, toggleShuffle, cycleRepeat]);

  const value = useMemo<PlayerState>(
    () => ({
      queue,
      index,
      current,
      isPlaying,
      time,
      volume,
      isMuted,
      shuffle,
      repeat,
      crossfade,
      expanded,
      lyricsOpen,
      queueOpen,
      audioRef: primaryAudioRef,
      playQueue,
      toggle,
      pause,
      next,
      prev,
      seek,
      setVolume,
      setCrossfade: (v: number) => setCrossfadeState(Math.max(0, Math.min(12, v))),
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setExpanded,
      setLyricsOpen,
      setQueueOpen,
      jumpTo: (i: number) => {
        setIndex(i);
        setTime(0);
        if (primaryAudioRef.current) primaryAudioRef.current.currentTime = 0;
        setPlaying(true);
      },
      moveInQueue,
    }),
    [
      queue,
      index,
      current,
      isPlaying,
      time,
      volume,
      isMuted,
      shuffle,
      repeat,
      crossfade,
      expanded,
      lyricsOpen,
      queueOpen,
      primaryAudioRef,
      playQueue,
      toggle,
      pause,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      moveInQueue,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Pure imperative audio elements (No JSX src attribute mutation to avoid reloading on channel swap) */}
      <audio ref={audioRefA} crossOrigin="anonymous" preload="auto" />
      <audio ref={audioRefB} crossOrigin="anonymous" preload="auto" />
    </Ctx.Provider>
  );
}