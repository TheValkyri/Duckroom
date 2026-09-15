import { describe, expect, it, vi, beforeEach } from "vitest";
import { validateWaveformPeaks, finalizeIngestionCommitInternal } from "../lib/ingestion";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";
import { fetchWaveformPeaks, clearPeaksCache } from "../lib/waveform-peaks";
import {
  getAudioAnalyser,
  disconnectAudioAnalyser,
  resetAudioAnalyser,
  setUserGestureSeenForTesting,
} from "../lib/audio-analyser";
import { isPresignedUrlValid } from "../lib/player";
import { MASTER_LIBRARY_QUERY_KEY } from "../lib/useLibrary";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Phase 2 — Media Performance & User Experience", () => {
  beforeEach(() => {
    clearPeaksCache();
    resetAudioAnalyser();
    vi.restoreAllMocks();
  });

  describe("P2.1 — 128-byte Waveform Peaks Persistence & Fast-Path", () => {
    it("validates 128-element integer arrays and clamps values to [0, 255]", () => {
      // Valid exact 128 array with out-of-bound numbers
      const raw = Array.from({ length: 128 }, (_, i) => {
        if (i === 0) return -10;
        if (i === 1) return 300;
        if (i === 2) return 128.6;
        return (i * 2) % 256;
      });

      const validated = validateWaveformPeaks(raw);
      expect(validated).not.toBeNull();
      expect(validated).toHaveLength(128);
      expect(validated![0]).toBe(0); // clamped from -10
      expect(validated![1]).toBe(255); // clamped from 300
      expect(validated![2]).toBe(129); // rounded from 128.6
      expect(validated!.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
    });

    it("rejects invalid waveform peaks arrays (wrong length, NaN, null, non-array)", () => {
      expect(validateWaveformPeaks(null)).toBeNull();
      expect(validateWaveformPeaks(undefined)).toBeNull();
      expect(validateWaveformPeaks("not an array")).toBeNull();
      expect(validateWaveformPeaks(new Array(96).fill(100))).toBeNull(); // wrong length (96)
      expect(validateWaveformPeaks(new Array(129).fill(100))).toBeNull(); // wrong length (129)

      const withNan = new Array(128).fill(50);
      withNan[10] = NaN;
      expect(validateWaveformPeaks(withNan)).toBeNull();

      const withInfinity = new Array(128).fill(50);
      withInfinity[10] = Infinity;
      expect(validateWaveformPeaks(withInfinity)).toBeNull();
    });

    it("fetchWaveformPeaks immediately returns precomputed track.waveformPeaks as Uint8Array without fetch", async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const precomputed = Array.from({ length: 128 }, (_, i) => i * 2);
      const track = {
        id: "track-p2-test-1",
        src: "https://example-bucket.s3.amazonaws.com/audio/test.flac?signed=true",
        waveformPeaks: precomputed,
      };

      const peaks = await fetchWaveformPeaks(track);
      expect(peaks).toBeInstanceOf(Uint8Array);
      expect(peaks).toHaveLength(128);
      expect(peaks![0]).toBe(0);
      expect(peaks![1]).toBe(2);
      expect(peaks![127]).toBe(254);

      // CRITICAL: Must not touch network (eliminates 100MB download & decode)
      expect(mockFetch).not.toHaveBeenCalled();

      // Second call hits cache
      const cached = await fetchWaveformPeaks({ id: "track-p2-test-1" });
      expect(cached).toBe(peaks);
    });

    it("fetchWaveformPeaks returns null for missing track or absent data without src", async () => {
      expect(await fetchWaveformPeaks(null)).toBeNull();
      expect(await fetchWaveformPeaks({ id: "track-no-src" })).toBeNull();
    });

    it("database migration exists and adds waveform_peaks SMALLINT[] to track_files", () => {
      const sql = read("supabase/migrations/20260916_duckroom_v2_waveform_peaks.sql");
      expect(sql).toMatch(
        /ALTER TABLE\s+(?:public\.)?track_files\s+ADD COLUMN\s+IF NOT EXISTS\s+waveform_peaks\s+SMALLINT\[\]/i,
      );
    });

    it("finalizeIngestionCommitInternal persists waveform_peaks into track_files", async () => {
      const peaks128 = Array.from({ length: 128 }, (_, i) => i % 256);
      const insertedTrackFiles: any[] = [];

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({}),
      } as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-p2-peaks-1",
                      owner_id: "user-owner-1",
                      status: "waiting_review",
                      approved_by_owner: true,
                      server_sha256: "hash-p2-peaks",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      staging_storage_key: "staging/session-p2-peaks-1/song.flac",
                      actual_size_bytes: 45000000,
                      analysis_result: {
                        waveformPeaks: peaks128,
                        container: "FLAC",
                        codec: "FLAC",
                        sampleRate: 96000,
                        bitDepth: 24,
                        channels: 2,
                        durationSeconds: 215,
                      },
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                const builder: any = {
                  eq: () => builder,
                  in: () => builder,
                  select: () => builder,
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "session-p2-peaks-1", status: "committing" },
                    error: null,
                  }),
                };
                return builder;
              },
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: "track-p2-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "track_files") {
            return {
              upsert: vi.fn().mockImplementation((row: any) => {
                insertedTrackFiles.push(row);
                return {
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-p2-1" }, error: null }),
                  }),
                };
              }),
            };
          }
          if (table === "media_analysis_records" || table === "audit_logs") {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-p2-peaks-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(insertedTrackFiles).toHaveLength(1);
      expect(insertedTrackFiles[0].waveform_peaks).toEqual(peaks128);
    });
  });

  describe("P2.2 — iOS Safari Background Audio & Visualizer Isolation", () => {
    it("PlayerBar does NOT mount or import Visualizer", () => {
      const playerBarSrc = read("src/components/player/PlayerBar.tsx");
      expect(playerBarSrc).not.toContain("import { Visualizer }");
      expect(playerBarSrc).not.toContain("<Visualizer");
    });

    it("NowPlaying defaults visualizer to OFF and includes 'Sóng nhạc' toggle", () => {
      const nowPlayingSrc = read("src/components/player/NowPlaying.tsx");
      expect(nowPlayingSrc).toContain("const [showVisualizer, setShowVisualizer] = useState(false)");
      expect(nowPlayingSrc).toContain("Sóng nhạc");
      expect(nowPlayingSrc).toMatch(/showVisualizer\s*&&/);
    });

    it("audio-analyser cleanly disconnects and suspends AudioContext on disconnectAudioAnalyser", () => {
      const mockDisconnect = vi.fn();
      const mockSuspend = vi.fn().mockResolvedValue(undefined);
      const mockResume = vi.fn().mockResolvedValue(undefined);
      const mockConnect = vi.fn();

      const mockAnalyser = {
        fftSize: 128,
        smoothingTimeConstant: 0.75,
        connect: mockConnect,
        disconnect: mockDisconnect,
      };

      const mockSource = {
        connect: mockConnect,
        disconnect: mockDisconnect,
      };

      class MockAudioContext {
        state = "running";
        destination = {};
        createAnalyser = vi.fn().mockReturnValue(mockAnalyser);
        createMediaElementSource = vi.fn().mockReturnValue(mockSource);
        suspend = mockSuspend;
        resume = mockResume;
        close = vi.fn().mockResolvedValue(undefined);
      }

      (globalThis as any).window = {
        AudioContext: MockAudioContext,
      };
      setUserGestureSeenForTesting(true);

      const audioEl = {} as HTMLAudioElement;
      const analyser = getAudioAnalyser(audioEl);
      expect(analyser).not.toBeNull();

      // Clean disconnect on unmount
      disconnectAudioAnalyser(audioEl);
      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockSuspend).toHaveBeenCalled();

      delete (globalThis as any).window;
    });
  });

  describe("P2.3 — State Management & React Query Consolidation", () => {
    it("useLibrary.ts defines MASTER_LIBRARY_QUERY_KEY and exposes compliant snapshot", () => {
      expect(MASTER_LIBRARY_QUERY_KEY).toEqual(["master-library"]);
      const src = read("src/lib/useLibrary.ts");
      expect(src).toContain("useQuery");
      expect(src).toContain("status: LibrarySyncStatus");
      expect(src).toContain("error: string | null");
      expect(src).toContain("status: librarySyncStatus");
    });
  });

  describe("P2.4 — Optimize Crossfade Preloading (isPresignedUrlValid)", () => {
    it("validates SigV4 presigned URLs with > 2 minutes remaining", () => {
      // Mock Date.now() to 2026-09-15T12:00:00Z
      const now = new Date("2026-09-15T12:00:00Z").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Presigned at 11:55:00Z with TTL 900s (15 min) -> expires at 12:10:00Z (10 min remaining > 2 min)
      const validUrl =
        "https://bucket.s3.amazonaws.com/audio/song.flac?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260915T115500Z&X-Amz-Expires=900&X-Amz-Signature=abcd1234ef";
      expect(isPresignedUrlValid(validUrl, 120_000)).toBe(true);

      // Presigned with only 1 minute remaining (expires at 12:01:00Z -> 60s < 120s)
      const nearExpiredUrl =
        "https://bucket.s3.amazonaws.com/audio/song.flac?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260915T115500Z&X-Amz-Expires=360&X-Amz-Signature=abcd1234ef";
      expect(isPresignedUrlValid(nearExpiredUrl, 120_000)).toBe(false);

      // Already expired URL
      const expiredUrl =
        "https://bucket.s3.amazonaws.com/audio/song.flac?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260915T115000Z&X-Amz-Expires=300&X-Amz-Signature=abcd1234ef";
      expect(isPresignedUrlValid(expiredUrl, 120_000)).toBe(false);
    });

    it("validates SigV2 / Epoch Expires presigned URLs", () => {
      const now = 1000000;
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Expires in 300 seconds (300,000ms > 120,000ms)
      const validUrl = "https://bucket.s3.amazonaws.com/audio/song.flac?Expires=1300&Signature=xyz";
      expect(isPresignedUrlValid(validUrl, 120_000)).toBe(true);

      // Expires in 60 seconds (60,000ms < 120,000ms)
      const expiringUrl = "https://bucket.s3.amazonaws.com/audio/song.flac?Expires=1060&Signature=xyz";
      expect(isPresignedUrlValid(expiringUrl, 120_000)).toBe(false);
    });

    it("rejects non-presigned, malformed, or empty URLs", () => {
      expect(isPresignedUrlValid(null)).toBe(false);
      expect(isPresignedUrlValid(undefined)).toBe(false);
      expect(isPresignedUrlValid("")).toBe(false);
      expect(isPresignedUrlValid("blob:http://localhost:3000/12345")).toBe(false);
      expect(isPresignedUrlValid("https://example.com/audio/song.flac")).toBe(false);
    });
  });
});
