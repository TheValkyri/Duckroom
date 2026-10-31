import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./player";

/**
 * useSmoothLyricTime:
 * Provides 60–120 FPS high-precision playback position for the active singing line.
 *
 * Background:
 * Browser `<audio>` elements only dispatch `timeupdate` ~3-4 times per second (~250ms).
 * Relying strictly on coarse timeupdate events causes karaoke syllable fills to jump
 * in jerky increments instead of flowing continuously.
 *
 * Solution:
 * While the song is playing, this hook samples the real audio clock via requestAnimationFrame
 * and interpolates sub-frame progression using performance.now() with stall-capping.
 * When paused or in background tabs, it safely idles with zero extra render overhead.
 */
export function useSmoothLyricTime(fallbackTime: number = 0): number {
  const { audioRef, isPlaying } = usePlayer();
  const [smoothTime, setSmoothTime] = useState<number>(() => {
    const audio = audioRef?.current;
    if (audio && Number.isFinite(audio.currentTime)) {
      return audio.currentTime;
    }
    return fallbackTime;
  });

  const rafIdRef = useRef<number | null>(null);
  const lastAudioTimeRef = useRef<number>(fallbackTime);
  const lastPerfTimeRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);

  // Re-sync immediately on significant delta (e.g. manual seek or track transition)
  useEffect(() => {
    if (Math.abs(fallbackTime - lastAudioTimeRef.current) > 0.25) {
      lastAudioTimeRef.current = fallbackTime;
      lastPerfTimeRef.current = typeof performance !== "undefined" ? performance.now() : 0;
      setSmoothTime(fallbackTime);
    }
  }, [fallbackTime]);

  useEffect(() => {
    if (!isPlaying || typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const audio = audioRef?.current;
      const t = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : fallbackTime;
      lastAudioTimeRef.current = t;
      setSmoothTime(t);
      return;
    }

    let isMounted = true;

    const stopTicker = () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const tick = () => {
      if (!isMounted) return;

      // P2-03: Completely idle ticker when document is hidden (tab in background / screen locked)
      // Zero unnecessary rendering or timer cycles occur.
      if (typeof document !== "undefined" && document.hidden) {
        rafIdRef.current = null;
        return;
      }

      const audio = audioRef?.current;
      const nowPerf = typeof performance !== "undefined" ? performance.now() : 0;

      if (audio && Number.isFinite(audio.currentTime) && !audio.paused) {
        const audioCurrent = audio.currentTime;
        if (audioCurrent !== lastAudioTimeRef.current) {
          lastAudioTimeRef.current = audioCurrent;
          lastPerfTimeRef.current = nowPerf;
        }

        const rate = audio.playbackRate || 1;
        const elapsed = Math.max(0, (nowPerf - lastPerfTimeRef.current) / 1000) * rate;
        // Cap forward extrapolation to 0.25s so buffering/stalls don't runaway
        const estimated = lastAudioTimeRef.current + Math.min(elapsed, 0.25);
        setSmoothTime(estimated);
      } else {
        setSmoothTime(fallbackTime);
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stopTicker();
      } else if (isMounted && isPlaying && rafIdRef.current === null) {
        // Tab restored or screen unlocked: re-sync immediately to real audio clock
        const audio = audioRef?.current;
        const currentAudioTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : fallbackTime;
        lastAudioTimeRef.current = currentAudioTime;
        lastPerfTimeRef.current = typeof performance !== "undefined" ? performance.now() : 0;
        setSmoothTime(currentAudioTime);
        rafIdRef.current = requestAnimationFrame(tick);
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    if (typeof document === "undefined" || !document.hidden) {
      rafIdRef.current = requestAnimationFrame(tick);
    }

    return () => {
      isMounted = false;
      stopTicker();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [isPlaying, audioRef, fallbackTime]);

  return isPlaying ? smoothTime : (audioRef?.current?.currentTime ?? fallbackTime);
}
