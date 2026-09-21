import { describe, expect, it, vi, beforeEach } from "vitest";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as s3Functions from "../lib/s3-functions";
import * as albumMutations from "../lib/domain-mutations/album-mutations";
import * as supabaseModule from "../lib/supabase";
import * as masterLibrary from "../lib/master-library";
import * as libraryData from "../data/library";

describe("Deletion Lifecycle & S3 Storage Reconciliation Suite", () => {
  let s3SentCommands: any[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    s3SentCommands = [];
    process.env["S3_ACCESS_KEY_ID"] = "mock-access-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "mock-secret-key";
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: any) => {
      s3SentCommands.push(command);
      return {} as any;
    });
    vi.spyOn(masterLibrary, "getPublicMasterLibraryServer").mockImplementation(async () => ({
      albums: libraryData.albums as any,
      tracks: libraryData.tracks as any,
      videos: libraryData.videos as any,
    }));
  });

  describe("Track Deletion & Artwork Reference Counting (deleteTrackDomainInternal)", () => {
    it("deletes both audio and artwork when artwork is unique to the deleted track", async () => {
      const mockTrack = {
        id: "track-unique-1",
        title: "Unique Song",
        storage_key: "audio/singles/unique.flac",
        cover_storage_key: "artwork/unique-cover.jpg",
        version: 1,
      };

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: vi.fn().mockImplementation((cols?: string) => {
                if (cols?.includes("storage_key")) {
                  return {
                    eq: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: mockTrack, error: null }),
                    }),
                  };
                }
                // Reference count check
                return {
                  eq: () => ({
                    neq: () => ({
                      neq: () => ({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      }),
                    }),
                  }),
                };
              }),
              delete: () => ({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: { id: mockTrack.id }, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "storage_cleanup_debts") {
            return {
              insert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "debt-1" }, error: null }),
                }),
              }),
              update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const res = await s3Functions.deleteTrackDomainInternal("track-unique-1", 1, "owner-1");
      expect(res.success).toBe(true);

      const deletedKeys = s3SentCommands
        .filter((cmd) => cmd instanceof DeleteObjectCommand)
        .map((cmd) => cmd.input.Key);

      expect(deletedKeys).toContain("audio/singles/unique.flac");
      expect(deletedKeys).toContain("artwork/unique-cover.jpg");
    });

    it("deletes audio on S3 but PRESERVES artwork when another track or album uses the same cover", async () => {
      const mockTrack = {
        id: "track-shared-1",
        title: "Shared Artwork Song",
        storage_key: "audio/albums/danh-doi/01-song.flac",
        cover_storage_key: "artwork/shared-danh-doi.jpg",
        version: 1,
      };

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: vi.fn().mockImplementation((cols?: string) => {
                if (cols?.includes("storage_key")) {
                  return {
                    eq: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: mockTrack, error: null }),
                    }),
                  };
                }
                // Reference count check: Another track uses the same cover!
                return {
                  eq: () => ({
                    neq: () => ({
                      neq: () => ({
                        limit: vi.fn().mockResolvedValue({ data: [{ id: "track-shared-2" }], error: null }),
                      }),
                    }),
                  }),
                };
              }),
              delete: () => ({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: { id: mockTrack.id }, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "storage_cleanup_debts") {
            return {
              insert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "debt-2" }, error: null }),
                }),
              }),
              update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const res = await s3Functions.deleteTrackDomainInternal("track-shared-1", 1, "owner-1");
      expect(res.success).toBe(true);

      const deletedKeys = s3SentCommands
        .filter((cmd) => cmd instanceof DeleteObjectCommand)
        .map((cmd) => cmd.input.Key);

      expect(deletedKeys).toContain("audio/albums/danh-doi/01-song.flac");
      expect(deletedKeys).not.toContain("artwork/shared-danh-doi.jpg");
    });
  });

  describe("Album Deletion Modes (trashAlbumDomainInternal)", () => {
    it("dissolve mode unbinds tracks to album_id = null and keeps audio/artwork intact", async () => {
      const mockTrackUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "album-dissolve-1",
                          title: "Gieo",
                          cover_storage_key: "artwork/gieo.jpg",
                          status: "trash",
                          version: 2,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return { update: mockTrackUpdate };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const result = await albumMutations.trashAlbumDomainInternal("album-dissolve-1", 1, "owner-1", "dissolve");

      expect(result.status).toBe("trash");
      expect(mockTrackUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          album_id: null,
          track_no: 0,
        }),
      );
    });

    it("cascade_delete mode marks tracks trash and deletes S3 audio files", async () => {
      const mockAlbumTracks = [
        { id: "track-c1", storage_key: "audio/albums/bad/01.flac", cover_storage_key: "artwork/bad.jpg" },
        { id: "track-c2", storage_key: "audio/albums/bad/02.flac", cover_storage_key: "artwork/bad.jpg" },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "album-cascade-1",
                          title: "Bad Album",
                          cover_storage_key: "artwork/bad.jpg",
                          status: "trash",
                          version: 2,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: vi.fn().mockImplementation((cols?: string) => {
                if (cols?.includes("storage_key")) {
                  return {
                    eq: vi.fn().mockResolvedValue({ data: mockAlbumTracks, error: null }),
                  };
                }
                return {
                  eq: () => ({
                    neq: () => ({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                };
              }),
              update: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {
            delete: () => ({
              in: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const result = await albumMutations.trashAlbumDomainInternal("album-cascade-1", 1, "owner-1", "cascade_delete");

      expect(result.status).toBe("trash");

      const deletedKeys = s3SentCommands
        .filter((cmd) => cmd instanceof DeleteObjectCommand)
        .map((cmd) => cmd.input.Key);

      expect(deletedKeys).toContain("audio/albums/bad/01.flac");
      expect(deletedKeys).toContain("audio/albums/bad/02.flac");
      expect(deletedKeys).toContain("audio/albums/bad-album/.keep");
    });
  });

  describe("Client Library deleteAlbum Mutation (data/library.ts)", () => {
    it("dissolve mode converts tracks to albumId = singles in memory", async () => {
      const mockAlbum = {
        id: "album-test-dissolve",
        title: "Test Dissolve",
        artist: "Artist",
        version: 1,
      } as unknown as libraryData.Album;
      const mockTrack1 = {
        id: "t-d1",
        title: "Track 1",
        artist: "Artist",
        albumId: "album-test-dissolve",
        trackNo: 1,
        duration: 180,
      } as unknown as libraryData.Track;
      const mockTrack2 = {
        id: "t-d2",
        title: "Track 2",
        artist: "Artist",
        albumId: "album-test-dissolve",
        trackNo: 2,
        duration: 200,
      } as unknown as libraryData.Track;

      libraryData.albums.length = 0;
      libraryData.albums.push(mockAlbum);
      libraryData.tracks.length = 0;
      libraryData.tracks.push(mockTrack1, mockTrack2);

      vi.spyOn(albumMutations, "trashAlbumDomainServer").mockResolvedValue({
        id: mockAlbum.id,
        status: "trash",
        version: 2,
      } as any);

      const ok = await libraryData.deleteAlbum("album-test-dissolve", "dissolve");
      expect(ok).toBe(true);

      // Album removed
      expect(libraryData.albums.find((a) => a.id === "album-test-dissolve")).toBeUndefined();

      // Tracks converted to singles
      const t1 = libraryData.tracks.find((t) => t.id === "t-d1");
      const t2 = libraryData.tracks.find((t) => t.id === "t-d2");
      expect(t1?.albumId).toBe("singles");
      expect(t2?.albumId).toBe("singles");
    });

    it("cascade_delete mode removes tracks from memory entirely", async () => {
      const mockAlbum = {
        id: "album-test-cascade",
        title: "Test Cascade",
        artist: "Artist",
        version: 1,
      } as unknown as libraryData.Album;
      const mockTrack1 = {
        id: "t-c1",
        title: "Track 1",
        artist: "Artist",
        albumId: "album-test-cascade",
        trackNo: 1,
        duration: 180,
      } as unknown as libraryData.Track;

      libraryData.albums.length = 0;
      libraryData.albums.push(mockAlbum);
      libraryData.tracks.length = 0;
      libraryData.tracks.push(mockTrack1);

      vi.spyOn(albumMutations, "trashAlbumDomainServer").mockResolvedValue({
        id: mockAlbum.id,
        status: "trash",
        version: 2,
      } as any);

      const ok = await libraryData.deleteAlbum("album-test-cascade", "cascade_delete");
      expect(ok).toBe(true);

      // Both album and tracks removed
      expect(libraryData.albums.find((a) => a.id === "album-test-cascade")).toBeUndefined();
      expect(libraryData.tracks.find((t) => t.id === "t-c1")).toBeUndefined();
    });
  });
});
