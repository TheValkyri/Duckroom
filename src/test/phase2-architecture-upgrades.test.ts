import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeCadenceProgress,
  VIET_STACCATO_CADENCE_RE,
  VOCAL_CHOP_RE,
  OPEN_MELISMA_VOWEL_RE,
} from "../lib/lyrics-formatter";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("Phase 2 Architecture & Performance Hardening", () => {
  const librarySrc = read("src/routes/library.tsx");
  const queuePanelSrc = read("src/components/player/QueuePanel.tsx");
  const playerSrc = read("src/lib/player.tsx");
  const playerBarSrc = read("src/components/player/PlayerBar.tsx");
  const controlsSrc = read("src/components/player/Controls.tsx");
  const phoneLyricSrc = read("src/components/player/PhoneCurrentLyricLine.tsx");
  const lyricsSrc = read("src/components/player/Lyrics.tsx");
  const appShellSrc = read("src/components/AppShell.tsx");
  const trackRowSrc = read("src/components/TrackRow.tsx");
  const routeErrorFallbackSrc = read("src/components/RouteErrorFallback.tsx");
  const s3FunctionsSrc = read("src/lib/s3-functions.ts");
  const s3Src = read("src/lib/s3.ts");

  describe("P2-04: Windowed List Virtualization (@tanstack/react-virtual)", () => {
    it("virtualizes Library track listing with useWindowVirtualizer and dynamic useLayoutEffect scrollMargin", () => {
      expect(librarySrc).toContain('import { useWindowVirtualizer } from "@tanstack/react-virtual"');
      expect(librarySrc).toContain("useWindowVirtualizer({");
      expect(librarySrc).toContain("rowVirtualizer.getTotalSize()");
      expect(librarySrc).toContain("rowVirtualizer.getVirtualItems()");
      expect(librarySrc).toContain("scrollMargin,");
      expect(librarySrc).toContain("useLayoutEffect");
      expect(librarySrc).toContain("setScrollMargin(el.offsetTop)");
    });

    it("virtualizes QueuePanel with useVirtualizer, pins dragging row via rangeExtractor, and decouples contexts", () => {
      expect(queuePanelSrc).toContain("defaultRangeExtractor");
      expect(queuePanelSrc).toContain("useVirtualizer");
      expect(queuePanelSrc).toContain("virtualizer.getTotalSize()");
      expect(queuePanelSrc).toContain("virtualizer.getVirtualItems()");
      expect(queuePanelSrc).toContain("parentRef");
      expect(queuePanelSrc).toContain("rangeExtractor");
      expect(queuePanelSrc).toContain("draggingIndex");
      expect(queuePanelSrc).toContain("usePlayerQueue()");
      expect(queuePanelSrc).toContain("usePlayerUI()");
      expect(queuePanelSrc).toContain("usePlayerActions()");
      expect(queuePanelSrc).not.toContain("usePlayer()");
    });
  });

  describe("P2-05: PlayerContext Fine-Grained Sub-Tree Decoupling", () => {
    it("declares and exports granular context slices and selector hooks in player.tsx", () => {
      expect(playerSrc).toContain("export const usePlaybackState =");
      expect(playerSrc).toContain("export const usePlayerVolume =");
      expect(playerSrc).toContain("export const usePlayerUI =");
      expect(playerSrc).toContain("export const usePlayerQueue =");
      expect(playerSrc).toContain("export function usePlayerCurrentTrack()");
      expect(playerSrc).toContain("export const usePlayerActions =");
    });

    it("nests granular context providers with memoized value projections and CurrentTrackCtx", () => {
      expect(playerSrc).toContain("<CurrentTrackCtx.Provider value={viewCurrent}>");
      expect(playerSrc).toContain("<PlaybackCtx.Provider value={playbackValue}>");
      expect(playerSrc).toContain("<VolumeCtx.Provider value={volumeValue}>");
      expect(playerSrc).toContain("<PlayerUICtx.Provider value={uiValue}>");
      expect(playerSrc).toContain("<QueueCtx.Provider value={queueValue}>");
    });

    it("VolumeBar consumes only usePlayerVolume() to prevent re-renders on track/queue changes", () => {
      expect(playerBarSrc).toContain("usePlayerVolume()");
      expect(playerBarSrc).not.toContain("const { volume, isMuted } = usePlayer()");
    });

    it("SeekBar consumes only usePlayerCurrentTrack() & usePlayerActions()", () => {
      expect(controlsSrc).toContain("usePlayerCurrentTrack()");
      expect(controlsSrc).toContain("usePlayerActions()");
    });

    it("PhoneCurrentLyricLine consumes usePlayerCurrentTrack() to isolate lyric line changes", () => {
      expect(phoneLyricSrc).toContain("usePlayerCurrentTrack()");
    });

    it("LyricsPane in Lyrics.tsx consumes usePlayerCurrentTrack() & usePlayerActions()", () => {
      expect(lyricsSrc).toContain("usePlayerCurrentTrack()");
      expect(lyricsSrc).toContain("usePlayerActions()");
    });
  });

  describe("P2-08: Sidebar Layout Thrashing & CLS Elimination", () => {
    it("leverages GPU transforms and hardware acceleration hints during sidebar collapse/expand", () => {
      expect(appShellSrc).toContain("will-change-[width] transform-gpu");
      expect(appShellSrc).toContain("will-change-[padding] transform-gpu");
    });
  });

  describe("P2-12: Admin Subsystem Code Splitting & Lazy Loading", () => {
    it("dynamically imports EditTrackModal via React.lazy with Suspense boundary in TrackRow and singles route", () => {
      expect(trackRowSrc).toContain("lazy(");
      expect(trackRowSrc).toContain("EditTrackModal");
      expect(trackRowSrc).toContain("<Suspense fallback={null}>");

      const singlesSrc = read("src/routes/singles.tsx");
      expect(singlesSrc).toContain("lazy(");
      expect(singlesSrc).toContain("EditTrackModal");
      expect(singlesSrc).toContain("<Suspense fallback={null}>");
    });
  });

  describe("P2-11: Route-Level Error Boundaries", () => {
    it("provides an isolated RouteErrorFallback component conforming to TanStack Router ErrorComponentProps", () => {
      expect(routeErrorFallbackSrc).toContain("export function RouteErrorFallback");
      expect(routeErrorFallbackSrc).toContain("ErrorComponentProps");
      expect(routeErrorFallbackSrc).toContain("reset");
    });

    it("attaches RouteErrorFallback as errorComponent across all child route definitions", () => {
      const routes = [
        { path: "src/routes/library.tsx", src: librarySrc },
        { path: "src/routes/albums.$albumId.tsx", src: read("src/routes/albums.$albumId.tsx") },
        { path: "src/routes/albums.index.tsx", src: read("src/routes/albums.index.tsx") },
        { path: "src/routes/admin.tsx", src: read("src/routes/admin.tsx") },
        { path: "src/routes/friends.tsx", src: read("src/routes/friends.tsx") },
        { path: "src/routes/index.tsx", src: read("src/routes/index.tsx") },
        { path: "src/routes/login.tsx", src: read("src/routes/login.tsx") },
        { path: "src/routes/my-library.tsx", src: read("src/routes/my-library.tsx") },
        { path: "src/routes/profile.tsx", src: read("src/routes/profile.tsx") },
        { path: "src/routes/s.$token.tsx", src: read("src/routes/s.$token.tsx") },
        { path: "src/routes/singles.tsx", src: read("src/routes/singles.tsx") },
        { path: "src/routes/stats.tsx", src: read("src/routes/stats.tsx") },
        { path: "src/routes/upload.tsx", src: read("src/routes/upload.tsx") },
        { path: "src/routes/videos.$videoId.tsx", src: read("src/routes/videos.$videoId.tsx") },
        { path: "src/routes/videos.index.tsx", src: read("src/routes/videos.index.tsx") },
      ];

      for (const { path, src } of routes) {
        expect(src, `${path} must import RouteErrorFallback`).toContain("RouteErrorFallback");
        expect(src, `${path} must configure errorComponent: RouteErrorFallback`).toContain(
          "errorComponent: RouteErrorFallback",
        );
      }
    });
  });

  describe("P2-06: S3 Presigned URL Cache Normalization & Client In-Memory Cache", () => {
    it("attaches ResponseCacheControl header to GetObjectCommand across all media server functions", () => {
      expect(s3FunctionsSrc).toContain('ResponseCacheControl: "private, max-age=86400"');
      // Must appear multiple times across track audio, video stream, track artwork, album artwork, video thumbnail
      const occurrences = (s3FunctionsSrc.match(/ResponseCacheControl: "private, max-age=86400"/g) || []).length;
      expect(occurrences).toBeGreaterThanOrEqual(4);
    });

    it("implements bounded client-side artwork and thumbnail cache in s3.ts with TTL and FIFO eviction", () => {
      expect(s3Src).toContain("clientArtworkCache");
      expect(s3Src).toContain("MAX_CLIENT_CACHE = 100");
      expect(s3Src).toContain("CACHE_TTL_MS = 10 * 60 * 1000");
      expect(s3Src).toContain("getCachedArtwork");
      expect(s3Src).toContain("setCachedArtwork");
      expect(s3Src).toContain("video:${videoId}");
    });
  });

  describe("Vietnamese Lyric Cadence Engine (computeCadenceProgress)", () => {
    it("handles boundary progress values (0 and 1)", () => {
      expect(computeCadenceProgress(0, "bắt")).toBe(0);
      expect(computeCadenceProgress(1, "bắt")).toBe(1);
      expect(computeCadenceProgress(-0.1, "ơi")).toBe(0);
      expect(computeCadenceProgress(1.2, "ơi")).toBe(1);
    });

    it("detects Vietnamese staccato stop consonants (p, t, c, k, ch) and finishes fill earlier", () => {
      expect(VIET_STACCATO_CADENCE_RE.test("bắt")).toBe(true);
      expect(VIET_STACCATO_CADENCE_RE.test("hát")).toBe(true);
      expect(VIET_STACCATO_CADENCE_RE.test("được")).toBe(true);
      expect(VIET_STACCATO_CADENCE_RE.test("thích")).toBe(true);
      expect(VIET_STACCATO_CADENCE_RE.test("nhịp")).toBe(true);

      // At raw progress 0.85, a staccato syllable should be completely filled (1.0)
      const staccatoVal = computeCadenceProgress(0.85, "bắt");
      expect(staccatoVal).toBe(1);

      // Whereas an open melisma vowel syllable at 0.85 is still smoothly easing and not yet 1.0
      const melismaVal = computeCadenceProgress(0.85, "bay");
      expect(melismaVal).toBeLessThan(1);
    });

    it("detects vocal chop / hyphenated syllables with snappy linear progression", () => {
      expect(VOCAL_CHOP_RE.test("la")).toBe(true);
      expect(VOCAL_CHOP_RE.test("ah")).toBe(true);
      expect(VOCAL_CHOP_RE.test("oh")).toBe(true);

      // Energetic rhythmic pulse response for vocal chops
      const chopVal = computeCadenceProgress(0.5, "la-");
      expect(chopVal).toBeGreaterThan(0.5);
    });

    it("detects open melisma vowels for sustained vocal easing", () => {
      expect(OPEN_MELISMA_VOWEL_RE.test("xa")).toBe(true);
      expect(OPEN_MELISMA_VOWEL_RE.test("bay")).toBe(true);
      expect(OPEN_MELISMA_VOWEL_RE.test("ơi")).toBe(true);
      expect(OPEN_MELISMA_VOWEL_RE.test("mây")).toBe(true);
      expect(OPEN_MELISMA_VOWEL_RE.test("người")).toBe(true);

      // Smooth melisma easing curve
      const midProgress = computeCadenceProgress(0.4, "xa");
      expect(midProgress).toBeGreaterThan(0);
      expect(midProgress).toBeLessThan(1);
    });

    it("inserts breath pause before end of line when syllable ends with punctuation", () => {
      // Syllable with trailing comma at 0.85 should be completed (1.0) to hold breath pause before next phrase
      const pauseVal = computeCadenceProgress(0.85, "sông,");
      expect(pauseVal).toBe(1);
    });

    it("both Lyrics.tsx and PhoneCurrentLyricLine.tsx use the centralized computeCadenceProgress", () => {
      expect(lyricsSrc).toContain("computeCadenceProgress");
      expect(lyricsSrc).toContain("../../lib/lyrics-formatter");

      expect(phoneLyricSrc).toContain("computeCadenceProgress");
      expect(phoneLyricSrc).toContain("../../lib/lyrics-formatter");
    });
  });
});
