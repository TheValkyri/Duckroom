import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as domainMutations from "../lib/domain-mutations";
import * as masterLibrary from "../lib/master-library";
import * as supabaseModule from "../lib/supabase";
import * as libraryData from "../data/library";

describe("Phase 2 — Canonical Data Foundation & Concurrency Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["S3_ACCESS_KEY_ID"] = "mock-s3-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "mock-s3-secret";
    process.env["S3_ENDPOINT"] = "https://s3.mock.pikamc.vn";
    process.env["S3_REGION"] = "auto";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Mandatory Atomic CAS Concurrency Control", () => {
    it("rejects update when expectedVersion is missing or invalid", async () => {
      await expect(
        domainMutations.updateTrackDomainInternal({
          id: "track-cas-1",
          title: "Missing Version Title",
        } as any),
      ).rejects.toThrow(/expectedVersion is mandatory/i);

      await expect(
        domainMutations.updateAlbumDomainInternal({
          id: "album-cas-1",
          title: "Missing Version Album",
        } as any),
      ).rejects.toThrow(/expectedVersion is mandatory/i);

      await expect(
        domainMutations.updateVideoDomainInternal({
          id: "video-cas-1",
          title: "Missing Version Video",
        } as any),
      ).rejects.toThrow(/expectedVersion is mandatory/i);
    });

    it("Writer A with matching expectedVersion succeeds and atomically increments version to V+1", async () => {
      const mockTrack = {
        id: "track-cas-1",
        title: "Original Title",
        artist: "Artist 1",
        version: 5,
        status: "active",
      };

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: (updates: any) => ({
                eq: (col1: string, _val1: any) => ({
                  eq: (col2: string, val2: any) => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data:
                          col2 === "version" && val2 === 5
                            ? {
                                ...mockTrack,
                                ...updates,
                                version: 6,
                                title: "Writer A Title",
                              }
                            : null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await domainMutations.updateTrackDomainInternal({
        id: "track-cas-1",
        expectedVersion: 5,
        title: "Writer A Title",
      });

      expect(result.version).toBe(6);
      expect(result.title).toBe("Writer A Title");
    });

    it("Writer B with stale expectedVersion fails with 409 STALE_REVISION", async () => {
      // Mock DB: version in DB is 6, so update with version=5 returns null (0 rows affected)
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null, // 0 rows returned because version != 5
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "track-cas-1", version: 6 }, // Current DB version is 6
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        domainMutations.updateTrackDomainInternal({
          id: "track-cas-1",
          expectedVersion: 5,
          title: "Writer B Stale Title",
        }),
      ).rejects.toThrow(/Stale revision.*Track track-cas-1 is at version 6, expected 5/i);
    });

    it("two writers using same initial version: first succeeds, second fails with 409", async () => {
      let currentDbVersion = 5;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: (updates: any) => ({
                eq: (_col1: string, _id: any) => ({
                  eq: (_col2: string, expectedVer: any) => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockImplementation(async () => {
                        if (expectedVer === currentDbVersion) {
                          currentDbVersion += 1;
                          return {
                            data: {
                              id: "track-contested",
                              title: updates.title,
                              version: currentDbVersion,
                            },
                            error: null,
                          };
                        }
                        return { data: null, error: null };
                      }),
                    }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockImplementation(async () => ({
                    data: { id: "track-contested", version: currentDbVersion },
                    error: null,
                  })),
                }),
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Writer 1 attempts update at version 5
      const writer1Promise = domainMutations.updateTrackDomainInternal({
        id: "track-contested",
        expectedVersion: 5,
        title: "Writer 1 Title",
      });

      const res1 = await writer1Promise;
      expect(res1.version).toBe(6);
      expect(res1.title).toBe("Writer 1 Title");

      // Writer 2 attempts update at version 5 (now stale because version is 6)
      await expect(
        domainMutations.updateTrackDomainInternal({
          id: "track-contested",
          expectedVersion: 5,
          title: "Writer 2 Title",
        }),
      ).rejects.toThrow(/Stale revision/i);
    });

    it("simultaneous updates to Track A and Track B do not conflict or overwrite each other", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: (updates: any) => ({
                eq: (_col1: string, id: string) => ({
                  eq: (_col2: string, _expectedVer: number) => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id,
                          title: updates.title,
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
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const [resA, resB] = await Promise.all([
        domainMutations.updateTrackDomainInternal({ id: "track-a", expectedVersion: 1, title: "New Title A" }),
        domainMutations.updateTrackDomainInternal({ id: "track-b", expectedVersion: 1, title: "New Title B" }),
      ]);

      expect(resA.id).toBe("track-a");
      expect(resA.title).toBe("New Title A");
      expect(resB.id).toBe("track-b");
      expect(resB.title).toBe("New Title B");
    });
  });

  describe("Resource Not Found vs CAS Conflict", () => {
    it("throws 404 RESOURCE_NOT_FOUND when updating non-existent track", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        domainMutations.updateTrackDomainInternal({
          id: "non-existent-track",
          expectedVersion: 1,
          title: "Phantom",
        }),
      ).rejects.toThrow(/Track non-existent-track not found/i);
    });
  });

  describe("Safe Album Lifecycle (Trash Semantics)", () => {
    it("trashing album marks status as trash without deleting dependent tracks", async () => {
      const mockDbUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "album-1",
                  title: "Album to trash",
                  status: "trash",
                  deleted_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return { update: mockDbUpdate };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const trashed = await domainMutations.trashAlbumDomainInternal("album-1", 1, "user-admin-1");

      expect(trashed.status).toBe("trash");
      expect(trashed.deleted_at).toBeDefined();
    });
  });

  describe("Canonical DB Precedence and Explicit Sync Failure Semantics", () => {
    it("getPublicMasterLibraryServer returns canonical database records even if local snapshot was stale", async () => {
      const canonicalTrack = {
        id: "track-canonical-1",
        title: "Canonical True Title in DB",
        artist: "Real Artist",
        album_id: null,
        track_no: 1,
        duration_seconds: 210,
        format: "FLAC",
        bit_depth: 24,
        sample_rate: 96000,
        size_mb: 45.2,
        storage_key: "audio/track-1/master.flac",
        cover_storage_key: "artworks/track-1.jpg",
        year: 2026,
        lyrics: [],
        visibility: "public",
        version: 3,
        updated_at: "2026-08-21T00:00:00Z",
        status: "active",
      };

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [canonicalTrack],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "albums" || table === "videos") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [],
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

      const res = await masterLibrary.getPublicMasterLibraryInternal();

      expect(res.tracks).toHaveLength(1);
      expect(res.tracks![0]!.title).toBe("Canonical True Title in DB");
      expect(res.tracks![0]!.version).toBe(3);
    });

    it("throws explicit error when canonical database is unreachable (does not mask as empty library)", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => ({
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "Database connection terminated unexpectedly" },
                }),
              }),
            }),
          }),
        })),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(masterLibrary.getPublicMasterLibraryInternal()).rejects.toThrow(
        /\[Duckroom Database\] Master library fetch failed/i,
      );
    });

    it("returns clean empty arrays when database is legitimately empty (not an error)", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => ({
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        })),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await masterLibrary.getPublicMasterLibraryInternal();

      expect(res.tracks).toEqual([]);
      expect(res.albums).toEqual([]);
      expect(res.videos).toEqual([]);
    });

    it("DB request failure in syncLibraryWithS3 rejects, sets error status and marks cache as stale", async () => {
      // Simulate existing cache
      libraryData.tracks.push({
        id: "cached-track-1",
        title: "Stale Cached Title",
        artist: "Cached Artist",
        albumId: "singles",
        duration: 180,
        trackNo: 1,
        format: "FLAC",
        bitDepth: 16,
        sampleRate: 44.1,
        sizeMB: 30,
        lyrics: [],
        version: 1,
      });

      vi.spyOn(masterLibrary, "getPublicMasterLibraryServer").mockRejectedValue(
        new Error("[Duckroom Database] Master library fetch failed: Postgres unreachable"),
      );

      // Verify that sync rejects with explicit error
      await expect(libraryData.syncLibraryWithS3(true)).rejects.toThrow(
        /\[Duckroom Library\] Synchronizing canonical library failed: \[Duckroom Database\] Master library fetch failed: Postgres unreachable/i,
      );

      // Verify explicit error states
      expect(libraryData.librarySyncStatus).toBe("error");
      expect(libraryData.librarySyncError).toContain("Postgres unreachable");
      expect(libraryData.isLibraryStale).toBe(true);

      // Clean up test cache
      libraryData.clearAllTracks();
    });
  });

  describe("RLS Visibility & Lifecycle Constraints", () => {
    it("filters out trash records and non-public records in canonical public reader", async () => {
      const activePublicTrack = {
        id: "track-pub",
        title: "Public Track",
        visibility: "public",
        status: "active",
      };
      const trashTrack = {
        id: "track-trash",
        title: "Trash Track",
        visibility: "public",
        status: "trash",
      };
      const privateTrack = {
        id: "track-priv",
        title: "Private Track",
        visibility: "members",
        status: "active",
      };

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: (_col: string, visVal: string) => ({
                  neq: (_statusCol: string, statusVal: string) => ({
                    order: vi.fn().mockImplementation(async () => {
                      const all = [activePublicTrack, trashTrack, privateTrack];
                      const filtered = all.filter((t) => t.visibility === visVal && t.status !== statusVal);
                      return { data: filtered, error: null };
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

      const res = await masterLibrary.getPublicMasterLibraryInternal();

      expect(res.tracks).toHaveLength(1);
      expect(res.tracks![0]!.id).toBe("track-pub");
    });
  });

  describe("Master Library Reconciliation & Mass Deletion Safety Guard", () => {
    it("rejects destructive reconciliation without explicit allowMassDeletion", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "[SAFETY_GUARD] Destructive reconciliation rejected without allowMassDeletion" },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Attempt to replace 10 tracks with only 2 tracks (destructive) without allowMassDeletion
      await expect(
        masterLibrary.replaceMasterLibraryInternal(
          {
            tracks: [
              {
                id: "track-1",
                title: "T1",
                artist: "A1",
                duration: 100,
                trackNo: 1,
                format: "FLAC",
                bitDepth: 24,
                sampleRate: 96000,
                sizeMB: 30,
                lyrics: [],
              },
              {
                id: "track-2",
                title: "T2",
                artist: "A1",
                duration: 100,
                trackNo: 2,
                format: "FLAC",
                bitDepth: 24,
                sampleRate: 96000,
                sizeMB: 30,
                lyrics: [],
              },
            ],
            albums: [],
            videos: [],
            allowMassDeletion: false,
            expectedLibraryRevision: 1,
          },
          "owner-1",
        ),
      ).rejects.toThrow(/\[SAFETY_GUARD\] Destructive reconciliation rejected/i);
    });

    it("allows mass deletion when allowMassDeletion is explicitly set to true", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, deleted: { tracks: 9, albums: 0, videos: 0 } },
        error: null,
      });

      const mockSupabase = {
        rpc: mockRpc,
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await masterLibrary.replaceMasterLibraryInternal(
        {
          tracks: [
            {
              id: "track-1",
              title: "T1",
              artist: "A1",
              duration: 100,
              trackNo: 1,
              format: "FLAC",
              bitDepth: 24,
              sampleRate: 96000,
              sizeMB: 30,
              lyrics: [],
            },
          ],
          albums: [],
          videos: [],
          allowMassDeletion: true,
          expectedLibraryRevision: 1,
        },
        "owner-1",
      );

      expect(res.success).toBe(true);
      expect(res.deleted.tracks).toBe(9);
      expect(mockRpc).toHaveBeenCalledWith(
        "replace_master_library_atomic",
        expect.objectContaining({ p_allow_mass_deletion: true }),
      );
    });

    it("rejects empty payload wipeout without allowMassDeletion when DB has existing records", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "[SAFETY_GUARD] Empty library replacement rejected" },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        masterLibrary.replaceMasterLibraryInternal(
          {
            tracks: [],
            albums: [],
            videos: [],
            allowMassDeletion: false,
            expectedLibraryRevision: 1,
          },
          "owner-1",
        ),
      ).rejects.toThrow(/\[SAFETY_GUARD\] Empty library replacement rejected/i);
    });

    it("fails closed when DB fetch of current records returns an error during reconciliation", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "[RECONCILE_READ_FAILED] Tracks fetch failed: Connection reset by peer" },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        masterLibrary.replaceMasterLibraryInternal(
          {
            tracks: [],
            albums: [],
            videos: [],
            allowMassDeletion: true,
            expectedLibraryRevision: 1,
          },
          "owner-1",
        ),
      ).rejects.toThrow(/\[RECONCILE_READ_FAILED\] Tracks fetch failed/i);
    });
  });

  describe("CAS Concurrency on Trash & Lifecycle Operations", () => {
    it("trashTrackDomainInternal throws ConcurrencyConflictError when expectedVersion is stale", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              update: () => ({
                eq: (_col1: string, _val1: string) => ({
                  eq: (_col2: string, _val2: string) => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "track-1", version: 5 }, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(domainMutations.trashTrackDomainInternal("track-1", 3, "owner-1")).rejects.toThrow(
        /Stale revision: Track track-1 is at version 5, expected 3/i,
      );
    });
  });
});

// Release-gate hardening: full-library replacement must carry an explicit global revision.
describe("Global master-library revision guard", () => {
  it("passes expectedLibraryRevision to the atomic RPC", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { success: true, libraryRevision: 2 },
      error: null,
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue({ rpc: mockRpc } as any);

    const result = await masterLibrary.replaceMasterLibraryInternal(
      {
        tracks: [],
        albums: [],
        videos: [],
        allowMassDeletion: true,
        expectedLibraryRevision: 1,
      },
      "owner-1",
    );

    expect(result.libraryRevision).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith(
      "replace_master_library_atomic",
      expect.objectContaining({
        p_expected_library_revision: 1,
      }),
    );
  });

  it("surfaces stale global revision as a hard failure", async () => {
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "STALE_LIBRARY_REVISION: expected 1, current 2" },
      }),
    } as any);

    await expect(
      masterLibrary.replaceMasterLibraryInternal(
        {
          tracks: [],
          albums: [],
          videos: [],
          allowMassDeletion: true,
          expectedLibraryRevision: 1,
        },
        "owner-1",
      ),
    ).rejects.toThrow(/STALE_LIBRARY_REVISION/);
  });
});
