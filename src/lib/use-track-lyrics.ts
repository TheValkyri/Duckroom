import { useEffect, useMemo, useState } from "react";
import type { Track, LyricLine } from "../data/library";
import { applyLyricsOffset, readStoredOffset, parseLrc } from "./lyrics-formatter";
import { findMatchingCommunityLyric } from "./lyrics-search";

export interface TrackLyricsResult {
  lines: LyricLine[];
  originalLines: LyricLine[];
  isPlainLyrics: boolean;
  isSynced: boolean;
  source: string | null;
  offsetMs: number;
}

const AUTO_LYRICS_CACHE_PREFIX = "duckroom.autoLyrics.";

export function useTrackLyrics(track: Track | undefined | null): TrackLyricsResult {
  const trackId = track?.id;
  const [offsetMs, setOffsetMs] = useState<number>(() => readStoredOffset(trackId));
  const [autoLyricsLines, setAutoLyricsLines] = useState<LyricLine[] | null>(null);
  const [autoSource, setAutoSource] = useState<string | null>(null);

  // Sync offset when track changes
  useEffect(() => {
    setOffsetMs(readStoredOffset(trackId));
    setAutoLyricsLines(null);
    setAutoSource(null);
  }, [trackId]);

  // Listen for real-time cross-view offset sync
  useEffect(() => {
    const handleOffsetChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ trackId: string; offsetMs: number }>;
      if (customEvent.detail && customEvent.detail.trackId === trackId) {
        setOffsetMs(customEvent.detail.offsetMs);
      }
    };
    window.addEventListener("duckroom:lyrics-offset-changed", handleOffsetChange);
    return () => window.removeEventListener("duckroom:lyrics-offset-changed", handleOffsetChange);
  }, [trackId]);

  // Listen for auto-resolved lyrics updates
  useEffect(() => {
    const handleAutoLyricsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ trackId: string; lines: LyricLine[]; source: string }>;
      if (customEvent.detail && customEvent.detail.trackId === trackId) {
        setAutoLyricsLines(customEvent.detail.lines);
        setAutoSource(customEvent.detail.source);
      }
    };
    window.addEventListener("duckroom:lyrics-auto-updated", handleAutoLyricsUpdate);
    return () => window.removeEventListener("duckroom:lyrics-auto-updated", handleAutoLyricsUpdate);
  }, [trackId]);

  // Resolve base lyrics:
  // 1. Community Verified Vault (instant offline / studio synced)
  // 2. Track's own lyrics (from library / database)
  // 3. Runtime auto-resolved lyrics (LRCLIB)
  // 4. Cached auto lyrics from localStorage
  const resolved = useMemo(() => {
    if (!track) return { lines: [] as LyricLine[], source: null as string | null };

    // 1. Curated Community Vault (Highest priority for precision sync)
    const community = findMatchingCommunityLyric(track.title, track.artist);
    if (community?.syncedLyrics) {
      const parsed = parseLrc(community.syncedLyrics);
      if (parsed.length > 0) {
        return {
          lines: parsed,
          source: community.source || "Duckroom Community",
        };
      }
    }

    // 2. Track's existing lyrics
    if (Array.isArray(track.lyrics) && track.lyrics.length > 0) {
      return {
        lines: track.lyrics,
        source: track.lyricsSource || null,
      };
    }

    // 3. State-cached auto lyrics
    if (autoLyricsLines && autoLyricsLines.length > 0) {
      return {
        lines: autoLyricsLines,
        source: autoSource || "LRCLIB Synced",
      };
    }

    // 4. Persistent localStorage cache
    if (typeof window !== "undefined" && window.localStorage && trackId) {
      try {
        const cached = window.localStorage.getItem(AUTO_LYRICS_CACHE_PREFIX + trackId);
        if (cached) {
          const parsed = parseLrc(cached);
          if (parsed.length > 0) {
            return {
              lines: parsed,
              source: "LRCLIB Synced (Đã lưu)",
            };
          }
        }
      } catch {
        // quota or security restriction fallback
      }
    }

    return { lines: [] as LyricLine[], source: null as string | null };
  }, [track, autoLyricsLines, autoSource, trackId]);

  // Background auto-resolver for tracks without synced lyrics
  useEffect(() => {
    if (!track || !trackId) return;

    // Skip if community vault already has a verified match
    const comm = findMatchingCommunityLyric(track.title, track.artist);
    if (comm?.syncedLyrics) return;

    // Skip if track already has time-synced lyrics
    const hasSynced = Array.isArray(track.lyrics) && track.lyrics.some((l) => (l.time ?? 0) > 0);
    if (hasSynced) return;

    // Skip if already cached in localStorage
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        if (window.localStorage.getItem(AUTO_LYRICS_CACHE_PREFIX + trackId)) return;
      } catch {
        // ignore
      }
    }

    let isMounted = true;
    const fetchOnline = async () => {
      try {
        const cleanT = track.title.replace(/\(.*?\)|\[.*?\]/g, "").trim();
        const cleanA = (track.artist || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
        if (!cleanT) return;

        const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanT)}&artist_name=${encodeURIComponent(cleanA)}`;
        const res = await fetch(url, { headers: { "User-Agent": "DuckroomLossless/2.0" } });
        if (!res.ok) return;

        const data = await res.json();
        if (data?.syncedLyrics && isMounted) {
          const parsed = parseLrc(data.syncedLyrics);
          if (parsed.length > 0) {
            setAutoLyricsLines(parsed);
            setAutoSource("LRCLIB (Tự động cập nhật)");
            try {
              window.localStorage.setItem(AUTO_LYRICS_CACHE_PREFIX + trackId, data.syncedLyrics);
            } catch {
              // ignore
            }
            window.dispatchEvent(
              new CustomEvent("duckroom:lyrics-auto-updated", {
                detail: { trackId, lines: parsed, source: "LRCLIB (Tự động cập nhật)" },
              }),
            );
          }
        }
      } catch {
        // network error / offline fallback
      }
    };

    fetchOnline();
    return () => {
      isMounted = false;
    };
  }, [track, trackId]);

  const rawLines = resolved.lines;
  const isPlainLyrics = useMemo(
    () => rawLines.length > 0 && rawLines.every((l) => !l.time || l.time === 0),
    [rawLines],
  );

  const lines = useMemo(
    () => (offsetMs === 0 ? rawLines : applyLyricsOffset(rawLines, offsetMs)),
    [rawLines, offsetMs],
  );

  return {
    lines,
    originalLines: rawLines,
    isPlainLyrics,
    isSynced: !isPlainLyrics && lines.length > 0,
    source: resolved.source,
    offsetMs,
  };
}
