import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as supabaseModule from "../lib/supabase";
import * as ssrLoaders from "../lib/ssr-loaders";

describe("SSR Loaders (R2 & R4)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    ssrLoaders.clearSsrArtworkCache();
    process.env = {
      ...originalEnv,
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_ENDPOINT: "https://s3.test.local",
      S3_REGION: "us-east-1",
      S3_BUCKET_NAME: "test-bucket",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("getAlbumByIdSsrInternal", () => {
    it("returns null for non-existent album", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await ssrLoaders.getAlbumByIdSsrInternal("nonexistent-album");
      expect(res).toBeNull();
    });

    it("returns null for non-public album", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "private-album",
                        title: "Private Album",
                        visibility: "owner",
                        cover_storage_key: "artworks/private.jpg",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await ssrLoaders.getAlbumByIdSsrInternal("private-album");
      expect(res).toBeNull();
    });

    it("returns public album and tracks with signed cover and empty src for audio", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "album-1",
                        title: "Album 1",
                        artist: "Artist 1",
                        year: 2024,
                        cover_storage_key: "artworks/album1.jpg",
                        accent: "oklch(0.65 0.15 240)",
                        note: "Test note",
                        visibility: "public",
                        version: 1,
                        updated_at: new Date().toISOString(),
                        status: "active",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "track-1",
                          title: "Track 1",
                          artist: "Artist 1",
                          album_id: "album-1",
                          track_no: 1,
                          duration_seconds: 195,
                          format: "FLAC",
                          bit_depth: 24,
                          sample_rate: 96000,
                          size_mb: 48.5,
                          storage_key: "audio/track-1/master.flac",
                          cover_storage_key: "artworks/track1.jpg",
                          year: 2024,
                          lyrics: [],
                          lyrics_source: null,
                          visibility: "public",
                          version: 1,
                          updated_at: new Date().toISOString(),
                          status: "active",
                          track_files: [],
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await ssrLoaders.getAlbumByIdSsrInternal("album-1");

      expect(res).not.toBeNull();
      expect(res?.album.id).toBe("album-1");
      expect(res?.album.title).toBe("Album 1");
      expect(res?.album.cover).toContain("artworks/album1.jpg");
      expect(res?.tracks).toHaveLength(1);
      expect(res?.tracks[0]?.id).toBe("track-1");
      expect(res?.tracks[0]?.src).toBe(""); // R4: Lazy on-demand audio signing
      expect(res?.tracks[0]?.cover).toContain("artworks/track1.jpg");
    });
  });

  describe("getVideoByIdSsrInternal", () => {
    it("returns null for non-existent video", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await ssrLoaders.getVideoByIdSsrInternal("nonexistent-video");
      expect(res).toBeNull();
    });

    it("returns public video with signed thumbnail and empty src for playback", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "video-1",
                    title: "Music Video 1",
                    artist: "Artist 1",
                    year: 2024,
                    thumb_storage_key: "thumbnails/video1.jpg",
                    storage_key: "videos/video-1/master.mp4",
                    duration_seconds: 240,
                    resolution: "4K",
                    codec: "h264",
                    bitrate: "8000k",
                    size_mb: 320,
                    visibility: "public",
                    version: 1,
                    updated_at: new Date().toISOString(),
                    status: "active",
                    video_files: [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await ssrLoaders.getVideoByIdSsrInternal("video-1");

      expect(res).not.toBeNull();
      expect(res?.id).toBe("video-1");
      expect(res?.title).toBe("Music Video 1");
      expect(res?.thumb).toContain("thumbnails/video1.jpg");
      expect(res?.src).toBe(""); // R4: Lazy on-demand video signing
    });
  });

  describe("getPublicLibrarySummaryInternal", () => {
    it("returns summary counts and metadata without signed playback URLs", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "album-1",
                            title: "Album 1",
                            artist: "Artist 1",
                            year: 2024,
                            cover_storage_key: "artworks/album1.jpg",
                            accent: "oklch(0.5 0.2 240)",
                            note: "",
                            visibility: "public",
                            version: 1,
                            updated_at: new Date().toISOString(),
                            status: "active",
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "track-1",
                            title: "Track 1",
                            artist: "Artist 1",
                            album_id: "album-1",
                            track_no: 1,
                            duration_seconds: 180,
                            format: "FLAC",
                            bit_depth: 24,
                            sample_rate: 96000,
                            size_mb: 45.2,
                            storage_key: "audio/track-1/master.flac",
                            cover_storage_key: "artworks/track1.jpg",
                            year: 2024,
                            lyrics: [],
                            lyrics_source: null,
                            visibility: "public",
                            version: 1,
                            updated_at: new Date().toISOString(),
                            status: "active",
                            track_files: [],
                          },
                          {
                            id: "track-single",
                            title: "Single 1",
                            artist: "Artist 1",
                            album_id: "singles",
                            track_no: 1,
                            duration_seconds: 210,
                            format: "FLAC",
                            bit_depth: 24,
                            sample_rate: 96000,
                            size_mb: 50.0,
                            storage_key: "audio/single-1/master.flac",
                            cover_storage_key: "artworks/single1.jpg",
                            year: 2024,
                            lyrics: [],
                            lyrics_source: null,
                            visibility: "public",
                            version: 1,
                            updated_at: new Date().toISOString(),
                            status: "active",
                            track_files: [],
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }
          if (table === "videos") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "video-1",
                            title: "Video 1",
                            artist: "Artist 1",
                            year: 2024,
                            thumb_storage_key: "thumbnails/video1.jpg",
                            storage_key: "videos/video-1/master.mp4",
                            duration_seconds: 240,
                            resolution: "1080p",
                            codec: "h264",
                            bitrate: "5000k",
                            size_mb: 150,
                            visibility: "public",
                            version: 1,
                            updated_at: new Date().toISOString(),
                            status: "active",
                            video_files: [],
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const summary = await ssrLoaders.getPublicLibrarySummaryInternal();

      expect(summary.totalAlbums).toBe(1);
      expect(summary.totalTracks).toBe(2);
      expect(summary.totalVideos).toBe(1);
      expect(summary.totalSingles).toBe(1);
      expect(summary.primaryCover).toContain("artworks/album1.jpg");
      expect(summary.tracks.every((t) => t.src === "")).toBe(true);
      expect(summary.videos.every((v) => v.src === "")).toBe(true);
    });
  });

  describe("signArtworkUrl", () => {
    it("uses 21600s TTL for signing", async () => {
      const url = await ssrLoaders.signArtworkUrl("artworks/cover.jpg");
      expect(url).toContain("X-Amz-Expires=21600");
    });

    it("returns empty string on invalid storage key", async () => {
      const url = await ssrLoaders.signArtworkUrl("audio/dangerous.flac");
      expect(url).toBe("");
    });

    it("returns empty string on null or empty input", async () => {
      expect(await ssrLoaders.signArtworkUrl("")).toBe("");
      expect(await ssrLoaders.signArtworkUrl(null)).toBe("");
      expect(await ssrLoaders.signArtworkUrl(undefined)).toBe("");
    });

    it("bounds in-memory cache and evicts oldest entries when exceeding MAX_SSR_CACHE_ENTRIES", async () => {
      ssrLoaders.clearSsrArtworkCache();
      expect(ssrLoaders.getSsrArtworkCacheSize()).toBe(0);

      // Pre-fill cache up to 1005 entries
      for (let i = 0; i < 1005; i++) {
        await ssrLoaders.signArtworkUrl(`artworks/cover_${i}.jpg`);
      }

      // Should have triggered prune and stayed well under runaway memory growth
      expect(ssrLoaders.getSsrArtworkCacheSize()).toBeLessThanOrEqual(ssrLoaders.MAX_SSR_CACHE_ENTRIES);
      expect(ssrLoaders.getSsrArtworkCacheSize()).toBeGreaterThan(0);
    }, 45000);
  });

  describe("Error and Timeout Resilience", () => {
    it("throws error when album query fails in DB", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: "connection refused" },
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(ssrLoaders.getAlbumByIdSsrInternal("err-album")).rejects.toThrow(
        "[Duckroom SSR] Album query failed: connection refused",
      );
    });

    it("throws error when tracks query fails in DB instead of silently returning empty array", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "album-err-tracks",
                        title: "Album Error Tracks",
                        visibility: "public",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: "relation track_files does not exist" },
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(ssrLoaders.getAlbumByIdSsrInternal("album-err-tracks")).rejects.toThrow(
        "[Duckroom SSR] Album tracks query failed: relation track_files does not exist",
      );
    });

    it("throws error when video query fails in DB", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "timeout querying videos" },
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(ssrLoaders.getVideoByIdSsrInternal("err-video")).rejects.toThrow(
        "[Duckroom SSR] Video query failed: timeout querying videos",
      );
    });

    it("withTimeout rejects when operation exceeds duration", async () => {
      const hangingPromise = new Promise((resolve) => setTimeout(resolve, 500));
      await expect(ssrLoaders.withTimeout(hangingPromise, 50, "Hanging operation")).rejects.toThrow(
        "[Duckroom SSR] Hanging operation timed out after 50ms",
      );
    });

    it("withTimeout resolves cleanly when operation finishes within duration", async () => {
      const fastPromise = Promise.resolve("ok");
      const result = await ssrLoaders.withTimeout(fastPromise, 500, "Fast operation");
      expect(result).toBe("ok");
    });
  });
});
