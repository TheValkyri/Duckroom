import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeManifestMigration } from "../lib/manifest-migration.server";
import * as supabaseModule from "../lib/supabase";
import * as masterLibrary from "../lib/master-library";
import * as s3Module from "../lib/s3-functions";

describe("Phase 2 — Deterministic Manifest Migration & Runtime Independence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["S3_ACCESS_KEY_ID"] = "mock-s3-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "mock-s3-secret";
    process.env["S3_ENDPOINT"] = "https://s3.mock.pikamc.vn";
    process.env["S3_REGION"] = "auto";
  });

  const validManifest = {
    tracks: [
      {
        id: "track-canonical-1",
        title: "Song 1",
        artist: "Artist 1",
        albumId: "album-canonical-1",
        duration: 210,
        trackNo: 1,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96000,
        sizeMB: 45.2,
        src: "audio/track-canonical-1/master.flac",
        cover: "artwork/album-canonical-1/cover.jpg",
        lyrics: [{ time: 10, text: "Line 1" }],
      },
    ],
    albums: [
      {
        id: "album-canonical-1",
        title: "Album 1",
        artist: "Artist 1",
        year: 2024,
        cover: "artwork/album-canonical-1/cover.jpg",
        accent: "oklch(0.72 0.15 62)",
        note: "Master album",
      },
    ],
    videos: [
      {
        id: "video-canonical-1",
        title: "Video 1",
        artist: "Artist 1",
        year: 2024,
        thumb: "artwork/video-canonical-1/thumb.jpg",
        duration: 300,
        resolution: "3840 x 2160",
        codec: "H.265",
        bitrate: "120 Mbps",
        sizeMB: 850,
        src: "video/video-canonical-1/master.mp4",
      },
    ],
  };

  it("successfully parses, validates, upserts records in FK order, verifies identities, and logs durable migration marker", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    const mockInsert = vi.fn().mockResolvedValue({ error: null });

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "albums") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [{ id: "album-canonical-1", cover_storage_key: "artwork/album-canonical-1/cover.jpg" }],
              error: null,
            }),
          };
        }
        if (table === "tracks") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "track-canonical-1",
                  album_id: "album-canonical-1",
                  storage_key: "audio/track-canonical-1/master.flac",
                },
              ],
              error: null,
            }),
          };
        }
        if (table === "videos") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [{ id: "video-canonical-1", storage_key: "video/video-canonical-1/master.mp4" }],
              error: null,
            }),
          };
        }
        if (table === "artists") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [{ id: "artist-artist-1", name: "Artist 1", normalized_name: "artist 1" }],
              error: null,
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            insert: mockInsert,
          };
        }
        return {
          upsert: mockUpsert,
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }),
    };
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

    const report = await executeManifestMigration(validManifest, "owner-admin-1");

    expect(report.success).toBe(true);
    expect(report.counts.manifest.tracks).toBe(1);
    expect(report.counts.manifest.albums).toBe(1);
    expect(report.counts.manifest.videos).toBe(1);
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manifest.migration_complete",
        actor_user_id: "owner-admin-1",
      }),
    );
  });

  it("strictly fails migration when writing durable migration marker fails", async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "albums") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({
              data: [{ id: "album-canonical-1", cover_storage_key: "artwork/album-canonical-1/cover.jpg" }],
              error: null,
            }),
          };
        }
        if (table === "tracks") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "track-canonical-1",
                  album_id: "album-canonical-1",
                  storage_key: "audio/track-canonical-1/master.flac",
                },
              ],
              error: null,
            }),
          };
        }
        if (table === "videos") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({
              data: [{ id: "video-canonical-1", storage_key: "video/video-canonical-1/master.mp4" }],
              error: null,
            }),
          };
        }
        if (table === "artists") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({
              data: [{ id: "artist-artist-1", name: "Artist 1", normalized_name: "artist 1" }],
              error: null,
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: "Disk full / Postgres connection lost" } }),
          };
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }),
    };
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

    await expect(executeManifestMigration(validManifest, "owner-admin-1")).rejects.toThrow(
      /\[MIGRATION_MARKER_FAILED\] Failed to record durable migration marker/i,
    );
  });

  it("rejects manifest with duplicate canonical track IDs", async () => {
    const duplicateManifest = {
      ...validManifest,
      tracks: [validManifest.tracks[0]!, { ...validManifest.tracks[0]!, title: "Duplicate ID Song" }],
    };

    await expect(executeManifestMigration(duplicateManifest, "owner-admin-1")).rejects.toThrow(
      /Duplicate track canonical ID found: track-canonical-1/i,
    );
  });

  it("rejects manifest with invalid / path-traversal storage key", async () => {
    const maliciousManifest = {
      ...validManifest,
      tracks: [
        {
          ...validManifest.tracks[0]!,
          src: "audio/../../etc/passwd.flac",
        },
      ],
    };

    await expect(executeManifestMigration(maliciousManifest, "owner-admin-1")).rejects.toThrow(
      /Path traversal or illegal path characters detected/i,
    );
  });

  it("rejects manifest when track references a non-existent albumId", async () => {
    const brokenRelationManifest = {
      ...validManifest,
      tracks: [
        {
          ...validManifest.tracks[0]!,
          albumId: "non-existent-album-999",
        },
      ],
    };

    await expect(executeManifestMigration(brokenRelationManifest, "owner-admin-1")).rejects.toThrow(
      /references non-existent albumId "non-existent-album-999"/i,
    );
  });

  it("proves runtime library readers NEVER query S3 manifest and depend 100% on PostgreSQL", async () => {
    const mockDbTracks = [
      {
        id: "track-db-1",
        title: "Postgres Track 1",
        artist: "Postgres Artist",
        album_id: null,
        duration_seconds: 180,
        format: "FLAC",
        bit_depth: 24,
        sample_rate: 96000,
        size_mb: 40,
        storage_key: "audio/track-db-1/master.flac",
        cover_storage_key: null,
        year: 2024,
        lyrics: [],
        version: 1,
        status: "active",
        visibility: "public",
        updated_at: new Date().toISOString(),
      },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "tracks") {
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  order: vi.fn().mockResolvedValue({ data: mockDbTracks, error: null }),
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

    // Spy on getLibraryManifestInternal to ensure it is NOT called
    const manifestSpy = vi.spyOn(s3Module, "getLibraryManifestInternal");

    const result = await masterLibrary.getPublicMasterLibraryInternal();

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]!.id).toBe("track-db-1");
    // Manifest reader must NOT be invoked at runtime
    expect(manifestSpy).not.toHaveBeenCalled();
  });

  it("NEVER fabricates technical metadata: absent format/bitDepth/sampleRate/resolution/codec/bitrate must persist as NULL (Master Plan §9.3)", async () => {
    const capturedRows: Record<string, any[][]> = {};
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });

    const captureUpsert = (table: string) => (rows: any[]) => {
      (capturedRows[table] ??= []).push(rows);
      return Promise.resolve({ error: null });
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "albums") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [{ id: "album-canonical-1", cover_storage_key: "artwork/album-canonical-1/cover.jpg" }],
              error: null,
            }),
          };
        }
        if (table === "tracks" || table === "videos") {
          return {
            upsert: captureUpsert(table),
            select: vi.fn().mockResolvedValue({
              data:
                table === "tracks"
                  ? [{ id: "track-anon-meta", album_id: null, storage_key: "audio/track-anon-meta/master.flac" }]
                  : [{ id: "video-anon-meta", storage_key: "video/video-anon-meta/master.mp4" }],
              error: null,
            }),
          };
        }
        if (table === "artists") {
          return {
            upsert: mockUpsert,
            select: vi.fn().mockResolvedValue({
              data: [{ id: "artist-artist-1", name: "Artist 1", normalized_name: "artist 1" }],
              error: null,
            }),
          };
        }
        if (table === "audit_logs") {
          return { insert: mockUpsert };
        }
        return { upsert: mockUpsert, select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

    const anonymousMetadataManifest = {
      tracks: [
        {
          id: "track-anon-meta",
          title: "Unknown Quality Song",
          artist: "Artist 1",
          albumId: null,
          duration: 200,
          trackNo: 1,
          // NO format / bitDepth / sampleRate provided
          sizeMB: 40,
          src: "audio/track-anon-meta/master.flac",
          lyrics: [],
        },
      ],
      albums: [],
      videos: [
        {
          id: "video-anon-meta",
          title: "Unknown Quality Video",
          artist: "Artist 1",
          year: 2024,
          thumb: "artwork/video-canonical-1/thumb.jpg",
          duration: 250,
          // NO resolution / codec / bitrate provided
          sizeMB: 700,
          src: "video/video-anon-meta/master.mp4",
        },
      ],
    };

    const report = await executeManifestMigration(anonymousMetadataManifest, "owner-admin-1");
    expect(report.success).toBe(true);

    // The FIRST tracks/videos upsert is the full metadata row; a later
    // artist-linking upsert only patches relations.
    const trackRow = capturedRows["tracks"]?.[0]?.[0];
    expect(trackRow).toBeDefined();
    expect(trackRow.format).toBeNull();
    expect(trackRow.bit_depth).toBeNull();
    expect(trackRow.sample_rate).toBeNull();

    const videoRow = capturedRows["videos"]?.[0]?.[0];
    expect(videoRow).toBeDefined();
    expect(videoRow.resolution).toBeNull();
    expect(videoRow.codec).toBeNull();
    expect(videoRow.bitrate).toBeNull();

    // Explicitly forbid the historical fabricated defaults
    expect(trackRow.format).not.toBe("FLAC");
    expect(trackRow.bit_depth).not.toBe(24);
    expect(trackRow.sample_rate).not.toBe(96000);
    expect(videoRow.resolution).not.toBe("3840 x 2160");
    expect(videoRow.codec).not.toBe("H.265");
    expect(videoRow.bitrate).not.toBe("120 Mbps");
  });
});
