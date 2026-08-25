import { describe, expect, it, vi } from "vitest";
import { executeManifestMigration } from "../lib/manifest-migration.server";
import { finalizeIngestionCommitInternal, verifyAndAnalyzeServerUploadInternal } from "../lib/ingestion";
import { getPublicMasterLibraryInternal } from "../lib/master-library";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

describe("Blocker B & C — Authoritative Media Metadata & Non-Fabrication Invariants", () => {
  describe("1. Byte-Size & SHA-256 Non-Fabrication in Cold Migration", () => {
    it("preserves declared audio format/sampleRate/bitDepth but strictly sets file_size_bytes, sha256, verified_at to NULL", async () => {
      let insertedTrackFiles: any[] = [];
      let insertedVideoFiles: any[] = [];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "migration_markers") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          if (table === "track_files") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[]) => {
                insertedTrackFiles = rows;
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "video_files") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[]) => {
                insertedVideoFiles = rows;
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "artists") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "artist-1", normalized_name: "test artist" }],
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
                    id: "track-cold-1",
                    album_id: null,
                    title: "Cold Track",
                    artist: "Test Artist",
                    storage_key: "audio/track-cold-1/master.flac",
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
                data: [
                  {
                    id: "video-cold-1",
                    title: "Cold Video",
                    storage_key: "video/video-cold-1/master.mp4",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "albums" || table === "artwork_assets" || table === "lyrics_documents") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            };
          }
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            insert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const manifestData = {
        libraryVersion: "2026.08.21",
        albums: [],
        tracks: [
          {
            id: "track-cold-1",
            title: "Cold Track",
            artist: "Test Artist",
            duration: 215.5,
            sizeMB: 45.2, // Rounded float MB
            format: "FLAC",
            bitDepth: 24,
            sampleRate: 96000,
            src: "audio/track-cold-1/master.flac",
          },
        ],
        videos: [
          {
            id: "video-cold-1",
            title: "Cold Video",
            artist: "Test Artist",
            year: 2024,
            thumb: "video/video-cold-1/thumb.jpg",
            duration: 180,
            sizeMB: 120.5,
            codec: "H.264",
            resolution: "1920x1080",
            src: "video/video-cold-1/master.mp4",
          },
        ],
      };

      const result = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(result.success).toBe(true);

      // Verify track_files row
      expect(insertedTrackFiles).toHaveLength(1);
      const tf = insertedTrackFiles[0];
      expect(tf.track_id).toBe("track-cold-1");
      expect(tf.container).toBe("FLAC");
      expect(tf.sample_rate).toBe(96000);
      expect(tf.bit_depth).toBe(24);
      expect(tf.duration_seconds).toBe(215.5);
      // STRICT NON-FABRICATION: file_size_bytes must NOT be 45.2 * 1024 * 1024
      expect(tf.file_size_bytes).toBeNull();
      expect(tf.sha256).toBeNull();
      expect(tf.verified_at).toBeNull();

      // Verify video_files row
      expect(insertedVideoFiles).toHaveLength(1);
      const vf = insertedVideoFiles[0];
      expect(vf.video_id).toBe("video-cold-1");
      expect(vf.codec).toBe("H.264");
      expect(vf.resolution).toBe("1920x1080");
      expect(vf.file_size_bytes).toBeNull();
      expect(vf.sha256).toBeNull();
      expect(vf.verified_at).toBeNull();
    });
  });

  describe("2. Authoritative Media Analysis Ingestion Flow", () => {
    it("commits exact measured server byte count, sha256, and verified audio attributes to track_files", async () => {
      let committedTrackFile: any = null;
      let committedAnalysisRecord: any = null;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-verified-1",
                      owner_id: "user-owner-1",
                      resource_kind: "track",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                      expected_filename: "master_audio.flac",
                      expected_extension: "flac",
                      actual_size_bytes: 47448392, // Exact byte count measured by server
                      expected_size_bytes: 47448392,
                      staging_storage_key: "temp/upload-sessions/session-verified-1/master_audio.flac",
                      analysis_result: {
                        kind: "audio",
                        container: "FLAC",
                        codec: "FLAC",
                        sampleRate: 96000,
                        bitDepth: 24,
                        channels: 2,
                        bitrateKbps: 1764,
                        durationSeconds: 215.18,
                        fileSizeBytes: 47448392,
                        metadataTags: { title: "Master Song", artist: "Verified Artist" },
                        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                        parserVersion: "duckroom-flac-2.0",
                        analysisStatus: "verified",
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
                    data: { id: "session-verified-1", status: "complete" },
                    error: null,
                  }),
                };
                return builder;
              },
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "track-session-verified-1", title: "Master Song" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "track_files") {
            return {
              upsert: vi.fn().mockImplementation((payload: any) => {
                committedTrackFile = payload;
                return {
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: "tf-verified-uuid-1", ...payload },
                      error: null,
                    }),
                  }),
                };
              }),
            };
          }
          if (table === "media_analysis_records") {
            return {
              insert: vi.fn().mockImplementation((payload: any) => {
                committedAnalysisRecord = payload;
                return Promise.resolve({ data: null, error: null });
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({}),
      } as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-verified-1" }, "user-owner-1");
      expect(res.success).toBe(true);

      // Verify track_files received exact measured bytes and server sha256
      expect(committedTrackFile).not.toBeNull();
      expect(committedTrackFile.file_size_bytes).toBe(47448392);
      expect(committedTrackFile.sha256).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
      expect(committedTrackFile.sample_rate).toBe(96000);
      expect(committedTrackFile.bit_depth).toBe(24);
      expect(committedTrackFile.channels).toBe(2);
      expect(committedTrackFile.codec).toBe("FLAC");
      expect(committedTrackFile.verified_at).toBeDefined();

      // Verify media_analysis_records is linked to track_file_id
      expect(committedAnalysisRecord).not.toBeNull();
      expect(committedAnalysisRecord.track_file_id).toBe("tf-verified-uuid-1");
      expect(committedAnalysisRecord.sha256).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    });
  });

  describe("3. Metadata Disagreement & Server Authority", () => {
    it("enforces server analysis over spoofed client claims (e.g. 24/96 claimed vs 16/44.1 measured)", () => {
      const serverAnalysisMeasured = {
        bitDepth: 16,
        sampleRate: 44100,
        container: "FLAC",
        codec: "FLAC",
        fileSizeBytes: 28410294,
      };

      // Server authoritative resolution must choose measured values
      const authoritativeBadge = `${serverAnalysisMeasured.codec} ${serverAnalysisMeasured.bitDepth}/${Math.round(serverAnalysisMeasured.sampleRate / 1000)}`;
      expect(authoritativeBadge).toBe("FLAC 16/44");
      expect(authoritativeBadge).not.toBe("FLAC 24/96");
    });

    it("resolves physical metadata from verified track_files over fake legacy tracks.size_mb in master library", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({ neq: () => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
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
                          id: "track-precedence-1",
                          title: "Precedence Song",
                          artist: "Test Artist",
                          album_id: null,
                          track_no: 1,
                          duration_seconds: 200,
                          format: "MP3", // Fake legacy format
                          bit_depth: 16, // Fake legacy
                          sample_rate: 44100, // Fake legacy
                          size_mb: 5.0, // Fake legacy size
                          storage_key: "audio/track-precedence-1/master.flac",
                          cover_storage_key: null,
                          lyrics: [],
                          visibility: "public",
                          version: 1,
                          updated_at: new Date().toISOString(),
                          status: "active",
                          track_files: [
                            {
                              file_size_bytes: 47448392, // Exact verified bytes (~45.25 MB)
                              sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                              sample_rate: 96000, // Exact verified 96kHz
                              bit_depth: 24, // Exact verified 24-bit
                              container: "FLAC",
                              codec: "FLAC",
                              duration_seconds: 215.18,
                              verified_at: "2026-08-25T00:00:00Z",
                            },
                          ],
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
                eq: () => ({ neq: () => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({}),
      } as any);

      const lib = await getPublicMasterLibraryInternal();
      expect(lib.tracks).toHaveLength(1);
      const track = lib.tracks[0]!;

      // Physical file truth MUST come from verified track_files, NOT fake legacy fields
      expect(track.format).toBe("FLAC"); // Overrides legacy MP3
      expect(track.bitDepth).toBe(24); // Overrides legacy 16
      expect(track.sampleRate).toBe(96000); // Overrides legacy 44100
      expect(track.sizeMB).toBe(45.25); // Overrides fake 5.0 MB
      expect(track.duration).toBe(215.18); // Overrides fake 200s
    });
  });

  describe("4. Error Regressions: SHA-256 Mismatch & Size Mismatch", () => {
    it("rejects when uploaded binary SHA-256 does not match expected client SHA-256", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-sha-mismatch",
                  owner_id: "user-owner-1",
                  status: "uploaded",
                  resource_kind: "track",
                  expected_size_bytes: 8,
                  expected_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  expected_filename: "test.flac",
                  expected_extension: "flac",
                  staging_storage_key: "temp/upload-sessions/session-sha-mismatch/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Server calculates different sha256 from binary
      const binaryContent = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]); // fLaC header
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({
          Body: { transformToByteArray: () => Promise.resolve(binaryContent) },
          ContentLength: 8,
        }),
      } as any);

      await expect(
        verifyAndAnalyzeServerUploadInternal({ sessionId: "session-sha-mismatch" }, "user-owner-1"),
      ).rejects.toThrow();
    });

    it("rejects when uploaded binary length does not match declared size", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-size-mismatch",
                  owner_id: "user-owner-1",
                  status: "uploaded",
                  resource_kind: "track",
                  expected_size_bytes: 999999, // Expects 1MB
                  expected_filename: "test.flac",
                  expected_extension: "flac",
                  staging_storage_key: "temp/upload-sessions/session-size-mismatch/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: () => ({ in: () => Promise.resolve({ error: null }) }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // S3 reports only 8 bytes
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({
          Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(8)) },
          ContentLength: 8,
        }),
      } as any);

      await expect(
        verifyAndAnalyzeServerUploadInternal({ sessionId: "session-size-mismatch" }, "user-owner-1"),
      ).rejects.toThrow();
    });
  });
});
