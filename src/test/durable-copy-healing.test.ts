import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getS3DurableClient,
  getS3ServerClient,
  getTrackPlaybackUrlInternal,
  getTrackArtworkUrlInternal,
} from "../lib/s3-functions";
import { copyObjectWithVerifyRetry, finalizeIngestionCommitInternal } from "../lib/ingestion/commit";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";
import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockImplementation(async (_s3, cmd, _opts) => {
    return `https://s3.pikamc.vn/${cmd.input.Bucket}/${cmd.input.Key}?signed=true`;
  }),
}));

describe("Durable Media Ingestion & Self-Healing Playback Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_ENDPOINT: "https://s3.test.local",
      S3_REGION: "vn-hcm-1",
      S3_BUCKET_NAME: "test-bucket",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. S3 Client Configurations", () => {
    it("getS3ServerClient has fast presigning configuration (10s request, 3s connection, maxAttempts 1)", async () => {
      const client = getS3ServerClient();
      const maxAttempts =
        typeof client.config.maxAttempts === "function" ? await client.config.maxAttempts() : client.config.maxAttempts;
      expect(maxAttempts).toBe(1);
      const handlerConfig = await (client.config.requestHandler as any).configProvider;
      expect(handlerConfig.requestTimeout).toBe(10000);
      expect(handlerConfig.connectionTimeout).toBe(3000);
    });

    it("getS3DurableClient has heavy media transfer configuration (60s request, 5s connection, maxAttempts 3)", async () => {
      const client = getS3DurableClient();
      const maxAttempts =
        typeof client.config.maxAttempts === "function" ? await client.config.maxAttempts() : client.config.maxAttempts;
      expect(maxAttempts).toBe(3);
      const handlerConfig = await (client.config.requestHandler as any).configProvider;
      expect(handlerConfig.requestTimeout).toBe(60000);
      expect(handlerConfig.connectionTimeout).toBe(5000);
    });
  });

  describe("2. copyObjectWithVerifyRetry Logic", () => {
    it("succeeds immediately on attempt 1 if CopyObjectCommand succeeds", async () => {
      const mockS3 = {
        send: vi.fn().mockResolvedValue({}),
      };

      await expect(
        copyObjectWithVerifyRetry(
          mockS3,
          "test-bucket",
          "temp/upload-sessions/123/file.flac",
          "audio/canonical.flac",
          3,
          5,
        ),
      ).resolves.toBeUndefined();

      expect(mockS3.send).toHaveBeenCalledTimes(1);
      expect(mockS3.send.mock.calls[0]?.[0]).toBeInstanceOf(CopyObjectCommand);
    });

    it("verifies and succeeds via HeadObjectCommand if CopyObject times out but copy finished on S3", async () => {
      let callCount = 0;
      const mockS3 = {
        send: vi.fn().mockImplementation((cmd: any) => {
          callCount++;
          if (cmd instanceof CopyObjectCommand) {
            const err: any = new Error("ETIMEDOUT: Connection timed out");
            err.code = "ETIMEDOUT";
            return Promise.reject(err);
          }
          if (cmd instanceof HeadObjectCommand) {
            return Promise.resolve({ ContentLength: 40000000 });
          }
          return Promise.resolve({});
        }),
      };

      await expect(
        copyObjectWithVerifyRetry(
          mockS3,
          "test-bucket",
          "temp/upload-sessions/123/file.flac",
          "audio/canonical.flac",
          3,
          5,
        ),
      ).resolves.toBeUndefined();

      // Call 1: CopyObjectCommand (fails with timeout)
      // Call 2: HeadObjectCommand (succeeds! verified complete on S3)
      expect(callCount).toBe(2);
    });

    it("retries up to maxAttempts with backoff if HeadObjectCommand also fails, then throws last error", async () => {
      let copyAttempts = 0;
      let headAttempts = 0;

      const mockS3 = {
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof CopyObjectCommand) {
            copyAttempts++;
            const err: any = new Error("S3 503 Slow Down");
            return Promise.reject(err);
          }
          if (cmd instanceof HeadObjectCommand) {
            headAttempts++;
            return Promise.reject(new Error("NotFound"));
          }
          return Promise.resolve({});
        }),
      };

      await expect(
        copyObjectWithVerifyRetry(
          mockS3,
          "test-bucket",
          "temp/upload-sessions/123/file.flac",
          "audio/canonical.flac",
          3,
          5, // 5ms test backoff
        ),
      ).rejects.toThrow("S3 503 Slow Down");

      expect(copyAttempts).toBe(3);
      expect(headAttempts).toBe(3);
    });
  });

  describe("3. Self-Healing in Playback and Artwork Resolvers", () => {
    it("heals tracks and track_files in DB when track.storage_key is temp/ and canonical exists on S3", async () => {
      let updatedTracksKey: string | null = null;
      let updatedTrackFilesKey: string | null = null;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-heal-1",
                      storage_key: "temp/upload-sessions/session-heal-1/file.flac",
                      visibility: "public",
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => ({
                eq: vi.fn().mockImplementation((col: string, val: string) => {
                  if (patch.storage_key) updatedTracksKey = patch.storage_key;
                  return Promise.resolve({ data: null, error: null });
                }),
              }),
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                or: () => ({
                  not: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            canonical_storage_key: "audio/canonical-album-song.flac",
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "track_files") {
            return {
              update: (patch: any) => ({
                eq: vi.fn().mockImplementation((col: string, val: string) => {
                  if (patch.storage_key) updatedTrackFilesKey = patch.storage_key;
                  return Promise.resolve({ data: null, error: null });
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: any) => {
        if (cmd instanceof HeadObjectCommand) {
          return { ContentLength: 39000000 } as any;
        }
        return {} as any;
      });

      const res = await getTrackPlaybackUrlInternal("track-heal-1");

      // Verifies self-healing updated DB tracks and track_files
      expect(updatedTracksKey).toBe("audio/canonical-album-song.flac");
      expect(updatedTrackFilesKey).toBe("audio/canonical-album-song.flac");

      // Verifies signed URL was generated using the canonical key, NOT the temp key
      expect(res.playbackUrl).toContain("audio/canonical-album-song.flac");
      expect(res.playbackUrl).not.toContain("temp/");
    });

    it("heals track cover in DB when cover_storage_key is temp/ and canonical artwork exists on S3", async () => {
      let updatedCoverKey: string | null = null;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-heal-art-1",
                      cover_storage_key: "temp/upload-sessions/session-art-1/artwork.jpg",
                      visibility: "public",
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => ({
                eq: vi.fn().mockImplementation(() => {
                  if (patch.cover_storage_key) updatedCoverKey = patch.cover_storage_key;
                  return Promise.resolve({ data: null, error: null });
                }),
              }),
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                or: () => ({
                  not: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            artwork_canonical_key: "artwork/track-heal-art-1.jpg",
                          },
                          error: null,
                        }),
                      }),
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

      vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: any) => {
        if (cmd instanceof HeadObjectCommand) {
          return { ContentLength: 50000 } as any;
        }
        return {} as any;
      });

      const res = await getTrackArtworkUrlInternal("track-heal-art-1");

      expect(updatedCoverKey).toBe("artwork/track-heal-art-1.jpg");
      expect(res.assetUrl).toContain("artwork/track-heal-art-1.jpg");
      expect(res.assetUrl).not.toContain("temp/");
    });
  });

  describe("4. Toxic Fallback Elimination in Ingestion Commit", () => {
    it("never writes temp/ staging key to DB when CopyObjectCommand times out or fails with network error", async () => {
      let insertedTrack: any = null;
      let updatedTrack: any = null;
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-toxic-test",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      staging_storage_key: "temp/upload-sessions/session-toxic-test/staging.flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.status) sessionFinalStatus = patch.status;
                return {
                  eq: () => ({
                    in: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-toxic-test", status: "committing" },
                        }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: (row: any) => {
                insertedTrack = row;
                return {
                  select: () => ({
                    single: vi.fn().mockResolvedValue({ data: { id: row.id }, error: null }),
                  }),
                };
              },
              update: (patch: any) => {
                updatedTrack = patch;
                return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
              },
              delete: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "some-track" }, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // S3 client throws ETIMEDOUT network error on CopyObject and HeadObject fails
      const mockS3NetworkFail = {
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof CopyObjectCommand) {
            const err: any = new Error("ETIMEDOUT: Connection timed out");
            err.code = "ETIMEDOUT";
            return Promise.reject(err);
          }
          if (cmd instanceof HeadObjectCommand) {
            return Promise.reject(new Error("NotFound"));
          }
          return Promise.resolve({});
        }),
      };
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue(mockS3NetworkFail as any);
      vi.spyOn(s3FunctionsModule, "getS3DurableClient").mockReturnValue(mockS3NetworkFail as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-toxic-test" }, "user-owner-1"),
      ).rejects.toThrow(/S3 move failed/i);

      // Crucial verification: the toxic fallback is ELIMINATED!
      // tracks table was NEVER updated with temp/ staging key
      expect(updatedTrack).toBeNull();
      // DB rollback succeeded -> session set to media_copy_failed (clean client retry)
      expect(sessionFinalStatus).toBe("media_copy_failed");
    });

    it("never writes temp/ artwork staging key to DB when artwork CopyObjectCommand times out or fails", async () => {
      let updatedTrack: any = null;
      let sessionFinalStatus = "";
      let deletedCanonicalMedia = false;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-toxic-art-test",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      staging_storage_key: "temp/upload-sessions/session-toxic-art-test/staging.flac",
                      artwork_staging_key: "temp/upload-sessions/session-toxic-art-test/artwork.jpg",
                      artwork_status: "verified",
                      artwork_detected_mime: "image/jpeg",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.status) sessionFinalStatus = patch.status;
                return {
                  eq: () => ({
                    in: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-toxic-art-test", status: "committing" },
                        }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: (row: any) => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: row.id }, error: null }),
                }),
              }),
              update: (patch: any) => {
                updatedTrack = patch;
                return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
              },
              delete: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "some-track" }, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const mockS3ArtFail = {
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof CopyObjectCommand) {
            // Media copy succeeds, artwork copy fails with timeout
            if (cmd.input?.Key?.endsWith(".flac")) return Promise.resolve({});
            const err: any = new Error("ETIMEDOUT: Connection timed out on artwork");
            err.code = "ETIMEDOUT";
            return Promise.reject(err);
          }
          if (cmd instanceof HeadObjectCommand) {
            return Promise.reject(new Error("NotFound"));
          }
          if (cmd.constructor.name === "DeleteObjectCommand") {
            deletedCanonicalMedia = true;
            return Promise.resolve({});
          }
          return Promise.resolve({});
        }),
      };
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue(mockS3ArtFail as any);
      vi.spyOn(s3FunctionsModule, "getS3DurableClient").mockReturnValue(mockS3ArtFail as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-toxic-art-test" }, "user-owner-1"),
      ).rejects.toThrow(/S3 move failed/i);

      // Artwork toxic fallback is ELIMINATED: track cover was NEVER bound to temp/
      expect(updatedTrack).toBeNull();
      // Compensation succeeded: canonical media deleted from S3 and DB row rolled back
      expect(deletedCanonicalMedia).toBe(true);
      expect(sessionFinalStatus).toBe("artwork_copy_failed");
    });
  });

  describe("5. Edge Cases in Retry & Self-Healing", () => {
    it("copyObjectWithVerifyRetry recovers on attempt 2 if attempt 1 fails and attempt 2 CopyObject succeeds", async () => {
      let copyAttempts = 0;
      const mockS3 = {
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof CopyObjectCommand) {
            copyAttempts++;
            if (copyAttempts === 1) return Promise.reject(new Error("Transient S3 error"));
            return Promise.resolve({});
          }
          if (cmd instanceof HeadObjectCommand) {
            return Promise.reject(new Error("NotFound"));
          }
          return Promise.resolve({});
        }),
      };

      await expect(
        copyObjectWithVerifyRetry(mockS3, "test-bucket", "temp/file.flac", "audio/canonical.flac", 3, 5),
      ).resolves.toBeUndefined();

      expect(copyAttempts).toBe(2);
    });

    it("skips self-healing upload_sessions query when track.storage_key is already canonical (zero overhead)", async () => {
      let uploadSessionsQueried = false;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-canonical-1",
                      storage_key: "audio/cai-au-tien-song.flac",
                      visibility: "public",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "upload_sessions") {
            uploadSessionsQueried = true;
            return {};
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await getTrackPlaybackUrlInternal("track-canonical-1");

      expect(uploadSessionsQueried).toBe(false);
      expect(res.playbackUrl).toContain("audio/cai-au-tien-song.flac");
    });

    it("gracefully proceeds without DB modification when upload_sessions has no session for temp/ key", async () => {
      let trackUpdated = false;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-no-session",
                      storage_key: "temp/upload-sessions/orphan/file.flac",
                      visibility: "public",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                trackUpdated = true;
                return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
              },
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                or: () => ({
                  not: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                      }),
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

      const res = await getTrackPlaybackUrlInternal("track-no-session");

      expect(trackUpdated).toBe(false);
      expect(res.playbackUrl).toContain("temp/upload-sessions/orphan/file.flac");
    });

    it("gracefully proceeds without DB modification when canonical object does not exist on S3 (404)", async () => {
      let trackUpdated = false;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-s3-404",
                      storage_key: "temp/upload-sessions/session-404/file.flac",
                      visibility: "public",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                trackUpdated = true;
                return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
              },
            };
          }
          if (table === "upload_sessions") {
            return {
              select: () => ({
                or: () => ({
                  not: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { canonical_storage_key: "audio/missing-canonical.flac" },
                          error: null,
                        }),
                      }),
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

      vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: any) => {
        if (cmd instanceof HeadObjectCommand) {
          const notFound: any = new Error("NotFound");
          notFound.name = "NotFound";
          notFound.$metadata = { httpStatusCode: 404 };
          return Promise.reject(notFound);
        }
        return {} as any;
      });

      const res = await getTrackPlaybackUrlInternal("track-s3-404");

      // DB update was NOT performed because canonical file doesn't exist on S3
      expect(trackUpdated).toBe(false);
      expect(res.playbackUrl).toContain("temp/upload-sessions/session-404/file.flac");
    });
  });
});
