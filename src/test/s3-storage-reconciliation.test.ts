import { describe, expect, it, vi, beforeEach } from "vitest";
import * as ownerData from "../lib/owner-data";
import * as masterLibrary from "../lib/master-library";
import * as s3Functions from "../lib/s3-functions";
import * as supabaseModule from "../lib/supabase";

describe("S3 Storage Reconciliation & Master Library Integrity Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["S3_ACCESS_KEY_ID"] = "mock-access-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "mock-secret-key";
    vi.spyOn(s3Functions, "getS3ServerClient").mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
    } as any);
  });

  describe("reconcileStorageWithDbInternal", () => {
    it("correctly identifies ghost tracks and staging leaks", async () => {
      // Mock S3 listing: only 'audio/albums/hvl/01-song.flac' exists
      vi.spyOn(s3Functions, "listS3ObjectsInternal").mockResolvedValue([
        "audio/albums/hvl/01-song.flac",
        "artwork/cover.jpg",
        "library_manifest.json",
        "orphan-audio.flac",
      ]);

      const mockTracks = [
        {
          id: "track-valid",
          title: "Valid Song",
          album_id: "album-1",
          storage_key: "audio/albums/hvl/01-song.flac",
          cover_storage_key: "artwork/cover.jpg",
          status: "active",
        },
        {
          id: "track-ghost",
          title: "Ghost Song",
          album_id: "album-1",
          storage_key: "audio/albums/hvl/deleted.flac",
          cover_storage_key: "artwork/cover.jpg",
          status: "active",
        },
        {
          id: "track-staging",
          title: "Staging Leak Song",
          album_id: null,
          storage_key: "temp/upload-sessions/123/song.flac",
          cover_storage_key: null,
          status: "active",
        },
      ];

      const mockAlbums = [
        {
          id: "album-1",
          title: "HVL",
          cover_storage_key: "artwork/cover.jpg",
          status: "active",
        },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                neq: vi.fn().mockResolvedValue({ data: mockTracks, error: null }),
              }),
            };
          }
          if (table === "albums") {
            return {
              select: () => ({
                neq: vi.fn().mockResolvedValue({ data: mockAlbums, error: null }),
              }),
            };
          }
          if (table === "videos") {
            return {
              select: () => ({
                neq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }
          if (table === "audit_logs") {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const result = await ownerData.reconcileStorageWithDbInternal(false, "user-admin");

      expect(result.totalDbTracks).toBe(3);
      expect(result.validDbTracks).toBe(1);
      expect(result.ghostTracks.length).toBe(2); // 'track-ghost' and 'track-staging' (not on S3)
      expect(result.stagingLeaks.length).toBe(1);
      expect(result.stagingLeaks[0]?.id).toBe("track-staging");
      expect(result.orphanS3Keys).toContain("orphan-audio.flac");
    });

    it("purges ghost tracks when autoPurgeGhosts is true", async () => {
      vi.spyOn(s3Functions, "listS3ObjectsInternal").mockResolvedValue([
        "audio/albums/hvl/01-song.flac",
        "library_manifest.json",
      ]);

      const mockTracks = [
        {
          id: "track-1",
          title: "Valid Song",
          storage_key: "audio/albums/hvl/01-song.flac",
          status: "active",
        },
        {
          id: "track-ghost-1",
          title: "Dead Song",
          storage_key: "temp/deleted.flac",
          status: "active",
        },
      ];

      const mockDeleteIn = vi.fn().mockResolvedValue({ error: null });
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            const trackResult = {
              data: mockTracks,
              error: null,
              order: vi.fn().mockResolvedValue({ data: mockTracks, error: null }),
            };
            return {
              select: () => ({
                neq: vi.fn().mockImplementation(() => ({
                  ...trackResult,
                  then: (resolve: any) => Promise.resolve(trackResult).then(resolve),
                })),
              }),
              delete: () => ({ in: mockDeleteIn }),
            };
          }
          if (table === "albums") {
            const albumResult = {
              data: [],
              error: null,
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
            return {
              select: () => ({
                neq: vi.fn().mockImplementation(() => ({
                  ...albumResult,
                  then: (resolve: any) => Promise.resolve(albumResult).then(resolve),
                })),
              }),
            };
          }
          if (table === "videos") {
            const videoResult = {
              data: [],
              error: null,
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
            return {
              select: () => ({
                neq: vi.fn().mockImplementation(() => ({
                  ...videoResult,
                  then: (resolve: any) => Promise.resolve(videoResult).then(resolve),
                })),
              }),
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }
          if (
            table === "track_files" ||
            table === "user_favorites" ||
            table === "playback_history" ||
            table === "playlist_tracks" ||
            table === "storage_cleanup_debts"
          ) {
            return {
              delete: () => ({ in: vi.fn().mockResolvedValue({ error: null }) }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);
      vi.spyOn(s3Functions, "saveLibraryManifestInternal").mockResolvedValue(true);

      const result = await ownerData.reconcileStorageWithDbInternal(true, "user-admin");
      expect(result.purgedGhostCount).toBe(1);
      expect(mockDeleteIn).toHaveBeenCalledWith("id", ["track-ghost-1"]);
    });
  });

  describe("getPublicMasterLibraryInternal ghost filtering", () => {
    it("filters out tracks belonging to trashed or non-existent albums", async () => {
      const mockAlbums = [
        {
          id: "album-active-1",
          title: "Active Album",
          artist: "Artist",
          year: 2026,
          cover_storage_key: "artwork/cover.jpg",
          accent: "",
          note: "",
          visibility: "public",
          display_priority: 1,
        },
      ];

      const mockTracks = [
        {
          id: "track-in-active-album",
          title: "Track 1",
          artist: "Artist",
          album_id: "album-active-1",
          track_no: 1,
          duration_seconds: 200,
          format: "FLAC",
          bit_depth: 24,
          sample_rate: 96000,
          size_mb: 40,
          storage_key: "audio/albums/active/01.flac",
          cover_storage_key: "artwork/cover.jpg",
          visibility: "public",
          status: "active",
        },
        {
          id: "track-in-trashed-album",
          title: "Ghost Single Leaker",
          artist: "Artist",
          album_id: "album-trashed-999", // Trashed album not in public albums
          track_no: 2,
          duration_seconds: 180,
          format: "FLAC",
          bit_depth: 24,
          sample_rate: 96000,
          size_mb: 30,
          storage_key: "temp/lost.flac",
          cover_storage_key: "artwork/cover.jpg",
          visibility: "public",
          status: "active",
        },
        {
          id: "track-real-single",
          title: "Real Single",
          artist: "Artist",
          album_id: "singles",
          track_no: 1,
          duration_seconds: 190,
          format: "FLAC",
          bit_depth: 24,
          sample_rate: 96000,
          size_mb: 35,
          storage_key: "audio/singles/single.flac",
          cover_storage_key: "artwork/cover.jpg",
          visibility: "public",
          status: "active",
        },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({ data: mockAlbums, error: null }),
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
                    order: vi.fn().mockResolvedValue({ data: mockTracks, error: null }),
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
                    order: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const res = await masterLibrary.getPublicMasterLibraryInternal();

      // Only 'track-in-active-album' and 'track-real-single' should be returned!
      // 'track-in-trashed-album' must NOT leak as an orphan single!
      expect(res.tracks.length).toBe(2);
      expect(res.tracks.map((t) => t.id)).toEqual(["track-in-active-album", "track-real-single"]);
      expect(res.tracks.map((t) => t.id)).not.toContain("track-in-trashed-album");
    });
  });
});
