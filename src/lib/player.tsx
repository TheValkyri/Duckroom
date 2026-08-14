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
import { useLibrary } from "./useLibrary";

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
  crossfade: number; // seconds (e.g. 10, 12, 5, 3, 0)
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
  const { tracks: libraryTracks } = useLibrary();

  const [baseQueue, setBaseQueue] = useState<Track[]>(() => (libraryTracks.length > 0 ? libraryTracks : allTracks));
  const [queue, setQueue] = useState<Track[]>(() => (libraryTracks.length > 0 ? libraryTracks : allTracks));
  const [index, setIndex] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [crossfade, setCrossfadeState] = useState<number>(10); // Default studio 10s crossfade
  const [expanded, setExpanded] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Sync library updates when user uploads or edits songs
  useEffect(() => {
    if (libraryTracks && libraryTracks.length > 0) {
      setBaseQueue((prev) => {
        if (prev.length === libraryTracks.length) return prev;
        return libraryTracks;
      });
      setQueue((prev) => {
        if (prev.length === libraryTracks.length) return prev;
        return shuffle ? prev : libraryTracks;
      });
    }
  }, [libraryTracks, shuffle]);

  // Dual-buffer gapless crossfade channels ('A' and 'B')
  const [activeChannel, setActiveChannel] = useState<"A" | "B">("A");

  const current = queue[index];
  const nextTrack = queue.length > 1 ? queue[(index + 1) % queue.length] : undefined;

  const audioRefA = useRef<HTMLAudioElement | null>(null);
  const audioRefB = useRef<HTMLAudioElement | null>(null);

  // Tracks which track ID is loaded in Channel A and Channel B
  const channelTrackIdA = useRef<string | null>(null);
  const channelTrackIdB = useRef<string | null>(null);

  const isHandingOverRef = useRef<boolean>(false);

  const primaryAudioRef = activeChannel === "A" ? audioRefA : audioRefB;
  const secondaryAudioRef = activeChannel === "A" ? audioRefB : audioRefA;

  const effectiveVolume = isMuted ? 0 : volume;

  // Sync volume to primary audio element
  useEffect(() => {
    if (primaryAudioRef.current && !isHandingOverRef.current) {
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

      // Reset secondary channel
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.src = "";
      }
      if (activeChannel === "A") {
        channelTrackIdB.current = null;
      } else {
        channelTrackIdA.current = null;
      }

      if (primaryAudioRef.current) {
        primaryAudioRef.current.currentTime = 0;
      }
      setPlaying(true);
      if (shuffleNow !== undefined) setShuffle(shuffleNow);
    },
    [shuffle, activeChannel, primaryAudioRef, secondaryAudioRef],
  );

  const next = useCallback(
    (manual = false) => {
      setTime(0);
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.src = "";
      }
      if (activeChannel === "A") {
        channelTrackIdB.current = null;
      } else {
        channelTrackIdA.current = null;
      }

      if (primaryAudioRef.current) {
        primaryAudioRef.current.currentTime = 0;
      }

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
    [queue.length, repeat, current?.src, activeChannel, primaryAudioRef, secondaryAudioRef],
  );

  const prev = useCallback(() => {
    setTime(0);
    if (secondaryAudioRef.current) {
      secondaryAudioRef.current.pause();
      secondaryAudioRef.current.src = "";
    }
    if (activeChannel === "A") {
      channelTrackIdB.current = null;
    } else {
      channelTrackIdA.current = null;
    }

    if (primaryAudioRef.current) {
      primaryAudioRef.current.currentTime = 0;
    }
    if (time > 4) {
      return;
    }
    setIndex((i) => (i - 1 + queue.length) % queue.length);
  }, [queue.length, time, activeChannel, primaryAudioRef, secondaryAudioRef]);

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

  // Preload next track into secondary channel for 100% gapless DJ crossfade
  useEffect(() => {
    const secEl = secondaryAudioRef.current;
    if (!secEl || !nextTrack || queue.length <= 1 || crossfade <= 0 || repeat === "one") return;

    const currentSecTrackId = activeChannel === "A" ? channelTrackIdB.current : channelTrackIdA.current;
    if (currentSecTrackId === nextTrack.id && secEl.src) return;

    let isCancelled = false;
    async function prepareSecondaryAudio() {
      let targetSrc = nextTrack!.src || `/api/stream/track/${nextTrack!.id}`;
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
      secEl.volume = 0;
      secEl.preload = "auto";
      secEl.load();

      if (activeChannel === "A") {
        channelTrackIdB.current = nextTrack!.id;
      } else {
        channelTrackIdA.current = nextTrack!.id;
      }
    }

    void prepareSecondaryAudio();

    return () => {
      isCancelled = true;
    };
  }, [nextTrack?.id, crossfade, queue.length, repeat, activeChannel, secondaryAudioRef]);

  // Primary Audio Controller (Gapless Handover Protection)
  useEffect(() => {
    const el = primaryAudioRef.current;
    if (!el || !current || !current.src) return;

    const currentPrimaryTrackId = activeChannel === "A" ? channelTrackIdA.current : channelTrackIdB.current;

    // GAPLESS HANDOVER: If element is ALREADY playing this track (via crossfade handover), NEVER reload or reset!
    if (currentPrimaryTrackId === current.id && el.src) {
      if (isPlaying && el.paused) {
        void el.play().catch(() => {});
      } else if (!isPlaying && !el.paused) {
        el.pause();
      }
      return;
    }

    let isCancelled = false;

    async function syncAudioSource() {
      let targetSrc = current!.src;
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

      el.src = targetSrc;
      el.preload = "auto";
      el.load();

      if (activeChannel === "A") {
        channelTrackIdA.current = current!.id;
      } else {
        channelTrackIdB.current = current!.id;
      }

      el.volume = effectiveVolume;

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
  }, [current?.id, isPlaying, activeChannel, primaryAudioRef, effectiveVolume]);

  // High-performance DJ Studio Equal-Power Crossfade Listener
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

      // Studio Equal-Power Crossfade Curve: cos(t)^2 + sin(t)^2 = 1 (constant acoustic energy)
      if (
        crossfade > 0 &&
        windowSec > 0 &&
        remaining <= windowSec &&
        nextTrack &&
        queue.length > 1 &&
        repeat !== "one"
      ) {
        const progress = Math.max(0, Math.min(1, (windowSec - remaining) / windowSec));
        const gainPrimary = Math.cos(progress * 0.5 * Math.PI);
        const gainSecondary = Math.sin(progress * 0.5 * Math.PI);

        el.volume = Math.max(0, Math.min(1, effectiveVolume * gainPrimary));

        if (secEl && secEl.src) {
          secEl.volume = Math.max(0, Math.min(1, effectiveVolume * gainSecondary));
          if (secEl.paused && isPlaying) {
            void secEl.play().catch(() => {});
          }
        }

        // Automatic Smooth Handover right before track ends (0.15s)
        if (remaining <= 0.15 && !isHandingOverRef.current) {
          isHandingOverRef.current = true;
          if (secEl && !secEl.paused) {
            secEl.volume = effectiveVolume;
            setActiveChannel((ch) => (ch === "A" ? "B" : "A"));
            setIndex((i) => (i + 1) % queue.length);
            el.pause();
            el.currentTime = 0;
            if (activeChannel === "A") {
              channelTrackIdA.current = null;
            } else {
              channelTrackIdB.current = null;
            }
          }
          setTimeout(() => {
            isHandingOverRef.current = false;
          }, 300);
        }
      } else {
        if (!isHandingOverRef.current) {
          el.volume = effectiveVolume;
          if (secEl && !secEl.paused && remaining > windowSec) {
            secEl.pause();
            secEl.currentTime = 0;
            secEl.volume = 0;
          }
        }
      }
    };

    const onEnded = () => {
      if (isHandingOverRef.current) return;

      if (secEl && !secEl.paused && nextTrack && queue.length > 1 && repeat !== "one") {
        secEl.volume = effectiveVolume;
        setActiveChannel((ch) => (ch === "A" ? "B" : "A"));
        setIndex((i) => (i + 1) % queue.length);
        el.pause();
        el.currentTime = 0;
        if (activeChannel === "A") {
          channelTrackIdA.current = null;
        } else {
          channelTrackIdB.current = null;
        }
      } else {
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
  }, [
    current,
    nextTrack,
    crossfade,
    effectiveVolume,
    isPlaying,
    next,
    queue.length,
    repeat,
    activeChannel,
    primaryAudioRef,
    secondaryAudioRef,
  ]);

  const seek = useCallback(
    (t: number) => {
      setTime(t);
      if (primaryAudioRef.current) {
        primaryAudioRef.current.currentTime = t;
        primaryAudioRef.current.volume = effectiveVolume;
      }
      // Instantly silence and pause secondary crossfade buffer upon manual seek
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.pause();
        secondaryAudioRef.current.currentTime = 0;
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
        setTime(0);
        if (secondaryAudioRef.current) {
          secondaryAudioRef.current.pause();
          secondaryAudioRef.current.src = "";
        }
        if (primaryAudioRef.current) {
          primaryAudioRef.current.currentTime = 0;
        }
        setIndex(i);
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
      secondaryAudioRef,
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
      {/* Pure imperative dual audio elements for zero-latency seamless crossfade */}
      <audio ref={audioRefA} crossOrigin="anonymous" preload="auto" />
      <audio ref={audioRefB} crossOrigin="anonymous" preload="auto" />
    </Ctx.Provider>
  );
}