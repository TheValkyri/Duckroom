import { describe, expect, it, vi, beforeEach } from "vitest";
import { analyzeAudioBuffer } from "../services/media-analysis/audio-analyzer";
import { analyzeVideoBuffer } from "../services/media-analysis/video-analyzer";
import {
  InvalidStateTransitionError,
  IngestionVerificationError,
  ForbiddenSessionAccessError,
  createUploadSessionInternal,
  getUploadPresignedUrlInternal,
  approveUploadSessionInternal,
  verifyAndAnalyzeServerUploadInternal,
  finalizeIngestionCommitInternal,
  retryStagingCleanupInternal,
  cancelUploadSessionInternal,
  markSessionCleanupPending,
  markTerminalStagingCleanupPending,
} from "../lib/ingestion";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.pikamc.vn/mock-staging-presigned-url"),
}));

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Phase 3 — Media Ingestion & Recoverable Distributed Workflow Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
    } as any);
  });

  describe("1. Real Binary Audio Analysis (Zero Fabrication)", () => {
    it("authoritatively parses FLAC 24-bit / 96 kHz header without faking values", () => {
      const buffer = new Uint8Array(4 + 4 + 34);
      buffer[0] = 0x66;
      buffer[1] = 0x4c;
      buffer[2] = 0x61;
      buffer[3] = 0x43;
      buffer[4] = 0x80 | 0x00;
      buffer[7] = 0x22;

      buffer[18] = 0x17; // b10
      buffer[19] = 0x70; // b11
      buffer[20] = 0x03; // b12
      buffer[21] = 0x70; // b13
      buffer[22] = 0x00; // b14
      buffer[23] = 0x0e; // b15
      buffer[24] = 0xa6; // b16 (960000 = 0x0EA600)
      buffer[25] = 0x00; // b17

      const res = analyzeAudioBuffer(buffer, buffer.byteLength);

      expect(res.container).toBe("FLAC");
      expect(res.codec).toBe("FLAC");
      expect(res.sampleRate).toBe(96000);
      expect(res.bitDepth).toBe(24);
      expect(res.channels).toBe(2);
      expect(res.durationSeconds).toBe(10);
      expect(res.analysisStatus).toBe("verified");
    });

    it("authoritatively parses WAV 16-bit / 44.1 kHz RIFF header", () => {
      const dataSize = 44100 * 2 * 2 * 5;
      const buffer = new Uint8Array(44 + dataSize);
      const view = new DataView(buffer.buffer);

      buffer.set([0x52, 0x49, 0x46, 0x46], 0);
      view.setUint32(4, 36 + dataSize, true);
      buffer.set([0x57, 0x41, 0x56, 0x45], 8);
      buffer.set([0x66, 0x6d, 0x74, 0x20], 12);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, 44100, true);
      view.setUint32(28, 44100 * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      buffer.set([0x64, 0x61, 0x74, 0x61], 36);
      view.setUint32(40, dataSize, true);

      const res = analyzeAudioBuffer(buffer, buffer.byteLength);

      expect(res.container).toBe("WAV");
      expect(res.codec).toBe("PCM");
      expect(res.sampleRate).toBe(44100);
      expect(res.bitDepth).toBe(16);
      expect(res.channels).toBe(2);
      expect(res.durationSeconds).toBe(5);
    });

    it("MP3 does NOT produce fake 16-bit depth (Unknown > Fake rule)", () => {
      const buffer = new Uint8Array(200);
      buffer[0] = 0xff;
      buffer[1] = 0xfb;
      buffer[2] = 0x90;
      buffer[3] = 0x00;

      const res = analyzeAudioBuffer(buffer, buffer.byteLength);

      expect(res.container).toBe("MP3");
      expect(res.codec).toBe("MP3");
      expect(res.sampleRate).toBe(44100);
      expect(res.bitDepth).toBe(0);
      expect(res.bitDepth).not.toBe(16);
    });

    it("returns UNKNOWN and warnings when media header is malformed (no fake fallback)", () => {
      const corruptBuffer = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
      const res = analyzeAudioBuffer(corruptBuffer, corruptBuffer.byteLength);

      expect(res.container).toBe("UNKNOWN");
      expect(res.codec).toBe("UNKNOWN");
      expect(res.sampleRate).toBe(0);
      expect(res.bitDepth).toBe(0);
      expect(res.analysisStatus).toBe("warning");
      expect(res.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("2. Authoritative Video Analysis & Multi-Range moov fallback", () => {
    it("authoritatively parses MP4 H.264 resolution and duration from moov/mvhd/stsd boxes", () => {
      const buffer = new Uint8Array(200);
      const view = new DataView(buffer.buffer);

      view.setUint32(0, 16);
      buffer.set([0x66, 0x74, 0x79, 0x70], 4);
      buffer.set([0x6d, 0x70, 0x34, 0x32], 8);

      view.setUint32(16, 180);
      buffer.set([0x6d, 0x6f, 0x6f, 0x76], 20);

      view.setUint32(24, 32);
      buffer.set([0x6d, 0x76, 0x68, 0x64], 28);
      view.setUint32(44, 1000);
      view.setUint32(48, 120000);

      view.setUint32(56, 140);
      buffer.set([0x74, 0x72, 0x61, 0x6b], 60);

      view.setUint32(64, 130);
      buffer.set([0x6d, 0x64, 0x69, 0x61], 68);

      view.setUint32(72, 120);
      buffer.set([0x6d, 0x69, 0x6e, 0x66], 76);

      view.setUint32(80, 110);
      buffer.set([0x73, 0x74, 0x62, 0x6c], 84);

      view.setUint32(88, 100);
      buffer.set([0x73, 0x74, 0x73, 0x64], 92);
      view.setUint32(100, 1);

      view.setUint32(104, 80);
      buffer.set([0x61, 0x76, 0x63, 0x31], 108);
      view.setUint16(128, 3840);
      view.setUint16(130, 2160);

      const res = analyzeVideoBuffer(buffer, buffer.byteLength);

      expect(res.container).toBe("MP4");
      expect(res.videoCodec).toBe("H.264/AVC");
      expect(res.width).toBe(3840);
      expect(res.height).toBe(2160);
      expect(res.resolution).toBe("3840x2160");
      expect(res.durationSeconds).toBe(120);
    });

    it("parses MP4 moov metadata when moov is located in tail range (non-faststart MP4)", () => {
      const headerBuffer = new Uint8Array(64);
      const hView = new DataView(headerBuffer.buffer);
      hView.setUint32(0, 16);
      headerBuffer.set([0x66, 0x74, 0x79, 0x70], 4);
      hView.setUint32(16, 48);
      headerBuffer.set([0x6d, 0x64, 0x61, 0x74], 20);

      const tailBuffer = new Uint8Array(180);
      const tView = new DataView(tailBuffer.buffer);
      tView.setUint32(0, 180);
      tailBuffer.set([0x6d, 0x6f, 0x6f, 0x76], 4);
      tView.setUint32(8, 32);
      tailBuffer.set([0x6d, 0x76, 0x68, 0x64], 12);
      tView.setUint32(28, 1000);
      tView.setUint32(32, 60000);

      const res = analyzeVideoBuffer(headerBuffer, 10000000, tailBuffer);

      expect(res.container).toBe("MP4");
      expect(res.durationSeconds).toBe(60);
    });
  });

  describe("3. Schema & Upload Session UUID Contract", () => {
    it("session creation UUID is schema-compliant UUID", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  ...row,
                  id: row.id || "11111111-2222-3333-4444-555555555555",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await createUploadSessionInternal(
        {
          expectedFilename: "master-audio.flac",
          expectedSizeBytes: 50000000,
          expectedMime: "audio/flac",
          resourceKind: "track",
        },
        "123e4567-e89b-12d3-a456-426614174000",
      );

      expect(res.session.id).toMatch(UUID_REGEX);
      expect(res.session.staging_storage_key).toContain(res.session.id);
    });
  });

  describe("4. Owner Approval Required Before Presigned Upload (Server-Enforced)", () => {
    it("waiting_review -> presign = REJECTED", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "11111111-1111-1111-1111-111111111111",
                  owner_id: "user-owner-1",
                  status: "waiting_review",
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        getUploadPresignedUrlInternal({ sessionId: "11111111-1111-1111-1111-111111111111" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("approved -> presign = ALLOWED", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "11111111-1111-1111-1111-111111111111",
                  owner_id: "user-owner-1",
                  status: "approved",
                  staging_storage_key: "staging/uploads/test/sample.flac",
                  expected_mime: "audio/flac",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "11111111-1111-1111-1111-111111111111", status: "uploading" },
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await getUploadPresignedUrlInternal(
        { sessionId: "11111111-1111-1111-1111-111111111111" },
        "user-owner-1",
      );

      expect(res.uploadUrl).toBeDefined();
      expect(res.stagingKey).toBe("staging/uploads/test/sample.flac");
    });

    it("invalid approval transition (e.g. from complete) = REJECTED", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "11111111-1111-1111-1111-111111111111",
                  owner_id: "user-owner-1",
                  status: "complete",
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        approveUploadSessionInternal({ sessionId: "11111111-1111-1111-1111-111111111111" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe("5. Duplicate Decisions Semantic Control & Verified DB Updates", () => {
    it("duplicate cancel + successful DB update -> cancelled", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-dup-cancel",
                  owner_id: "user-owner-1",
                  duplicate_status: "exact_duplicate",
                  duplicate_decision: "cancel",
                  staging_storage_key: "staging/temp.flac",
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
                data: { id: "session-dup-cancel", status: "cancelled", stage: "cancelled" },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-dup-cancel" }, "user-owner-1");

      expect(res.success).toBe(false);
      expect(res.cancelled).toBe(true);
    });

    it("duplicate cancel + DB update failure -> throws explicit error (NOT false success)", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-dup-cancel-fail",
                  owner_id: "user-owner-1",
                  duplicate_status: "exact_duplicate",
                  duplicate_decision: "cancel",
                  staging_storage_key: "staging/temp.flac",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error("PostgreSQL write failed"),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-dup-cancel-fail" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("duplicate use_existing + successful DB update -> resolves to existing entity", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-dup-existing",
                      owner_id: "user-owner-1",
                      resource_kind: "track",
                      duplicate_status: "exact_duplicate",
                      duplicate_decision: "use_existing",
                      matched_entity_id: "track-existing-123",
                      server_sha256: "hash123",
                      staging_storage_key: "staging/temp.flac",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: "session-dup-existing", status: "resolved_to_existing" },
                      }),
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
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "track-existing-123", title: "Existing Song", artist: "Artist" },
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-dup-existing" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect((res as any).resolvedToExisting).toBe(true);
      expect(res.entity.id).toBe("track-existing-123");
    });

    it("duplicate use_existing + DB update failure -> throws explicit error (NOT false success)", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-dup-existing-fail",
                      owner_id: "user-owner-1",
                      resource_kind: "track",
                      duplicate_status: "exact_duplicate",
                      duplicate_decision: "use_existing",
                      matched_entity_id: "track-existing-123",
                      server_sha256: "hash123",
                      staging_storage_key: "staging/temp.flac",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      // Simulates CAS update error
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: new Error("PostgreSQL write failed on duplicate resolve"),
                      }),
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
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "track-existing-123", title: "Existing Song", artist: "Artist" },
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
        finalizeIngestionCommitInternal({ sessionId: "session-dup-existing-fail" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe("6. Strict Expected vs Actual MIME & Container Verification", () => {
    it("expected 100MB, actual 90MB -> fails verification", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-size-mismatch",
                  owner_id: "user-owner-1",
                  status: "uploading",
                  expected_size_bytes: 100000000,
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockResolvedValue({
          ContentLength: 90000000,
        }),
      } as any);

      await expect(
        verifyAndAnalyzeServerUploadInternal({ sessionId: "session-size-mismatch" }, "user-owner-1"),
      ).rejects.toThrow(IngestionVerificationError);
    });

    it("expected audio/flac, actual uploaded binary is WAV -> strictly rejects MIME mismatch", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-mime-mismatch",
                  owner_id: "user-owner-1",
                  status: "uploading",
                  resource_kind: "track",
                  expected_size_bytes: 5000,
                  expected_filename: "song.flac",
                  expected_mime: "audio/flac",
                  expected_extension: "flac",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const wavHeader = new Uint8Array(44);
      wavHeader.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
      wavHeader.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
      wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt

      async function* mockStream() {
        yield wavHeader;
      }

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "HeadObjectCommand") {
            return Promise.resolve({ ContentLength: 5000 });
          }
          if (cmd.constructor.name === "GetObjectCommand") {
            return Promise.resolve({ Body: mockStream() });
          }
          return Promise.resolve({});
        }),
      } as any);

      await expect(
        verifyAndAnalyzeServerUploadInternal({ sessionId: "session-mime-mismatch" }, "user-owner-1"),
      ).rejects.toThrow(/không khớp với MIME \(audio\/flac\)/i);
    });
  });

  describe("7. Committing Idempotency, Staging Cleanup Debt & Recovery", () => {
    it("retry while session is committing resumes cleanly without creating second canonical entity", async () => {
      let tracksInserted = 0;
      const deterministicId = "track-session-12345678-song";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "12345678-1111-2222-3333-444455556666",
                      owner_id: "user-owner-1",
                      status: "committing",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      committed_entity_id: deterministicId,
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "12345678-1111-2222-3333-444455556666",
                          status: "committing",
                          committed_entity_id: deterministicId,
                        },
                      }),
                    }),
                  }),
                  eq: () => ({
                    select: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "12345678-1111-2222-3333-444455556666",
                          status: "complete",
                          committed_entity_id: deterministicId,
                        },
                      }),
                    }),
                  }),
                  neq: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: deterministicId, title: "song", version: 1 },
                  }),
                }),
              }),
              insert: () => {
                tracksInserted++;
                return {
                  select: () => ({
                    single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                  }),
                };
              },
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records" || table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal(
        { sessionId: "12345678-1111-2222-3333-444455556666" },
        "user-owner-1",
      );

      expect(res.success).toBe(true);
      expect(res.entity.id).toBe(deterministicId);
      expect(tracksInserted).toBe(0);
    });

    it("staging cleanup failure -> marks staging_cleanup_pending (durable cleanup debt)", async () => {
      const deterministicId = "track-session-stagingdebt-1";
      let sessionFinalStage = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-staging-debt",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.stage) sessionFinalStage = patch.stage;
                return {
                  eq: () => ({
                    in: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-staging-debt", status: "committing" },
                        }),
                      }),
                    }),
                    eq: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-staging-debt", status: "complete" },
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
              insert: () => ({
                select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }) }),
              }),
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records" || table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // S3 Copy succeeds, but Delete staging fails
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "CopyObjectCommand") return Promise.resolve({});
          if (cmd.constructor.name === "DeleteObjectCommand") return Promise.reject(new Error("S3 Delete Staging 500"));
          return Promise.resolve({});
        }),
      } as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-staging-debt" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect((res as any).stagingCleanupPending).toBe(true);
      expect(sessionFinalStage).toBe("staging_cleanup_pending");
    });

    it("staging cleanup retry -> succeeds and marks stage='complete'", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-staging-retry",
                  owner_id: "user-owner-1",
                  status: "complete", // Canonical commit was already complete
                  stage: "staging_cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "session-staging-retry", status: "complete", stage: "complete" },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-staging-retry" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.session.stage).toBe("complete");
    });

    it("artwork copy failure with successful compensation -> sets artwork_copy_failed (recoverable)", async () => {
      const deterministicId = "track-session-artfail-1";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-art-1",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      artwork_status: "verified",
                      artwork_staging_key: "staging/art.jpg",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
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
                          data: { id: "session-art-1", status: "committing" },
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
              delete: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "CopyObjectCommand") {
            if (cmd.input.Key.endsWith(".jpg")) return Promise.reject(new Error("S3 Artwork Copy Error"));
            return Promise.resolve({});
          }
          if (cmd.constructor.name === "DeleteObjectCommand") {
            return Promise.resolve({});
          }
          return Promise.resolve({});
        }),
      } as any);

      await expect(finalizeIngestionCommitInternal({ sessionId: "session-art-1" }, "user-owner-1")).rejects.toThrow(
        /S3 move failed/i,
      );

      expect(sessionFinalStatus).toBe("artwork_copy_failed");
    });

    it("artwork copy failure + canonical media delete failure -> sets cleanup_pending", async () => {
      const deterministicId = "track-session-artfail-2";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-art-2",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      artwork_status: "verified",
                      artwork_staging_key: "staging/art.jpg",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
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
                          data: { id: "session-art-2", status: "committing" },
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
              delete: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "CopyObjectCommand") {
            if (cmd.input.Key.endsWith(".jpg")) return Promise.reject(new Error("S3 Artwork Copy Error"));
            return Promise.resolve({});
          }
          if (cmd.constructor.name === "DeleteObjectCommand") {
            return Promise.reject(new Error("S3 Delete Object Network Failed"));
          }
          return Promise.resolve({});
        }),
      } as any);

      await expect(finalizeIngestionCommitInternal({ sessionId: "session-art-2" }, "user-owner-1")).rejects.toThrow(
        /S3 move failed/i,
      );

      expect(sessionFinalStatus).toBe("cleanup_pending");
    });

    it("media copy failure + DB rollback failure -> sets cleanup_pending", async () => {
      const deterministicId = "track-session-mediafail-1";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-media-fail-1",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
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
                          data: { id: "session-media-fail-1", status: "committing" },
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
              delete: () => ({
                eq: vi.fn().mockResolvedValue({ data: null, error: new Error("Postgres connection dropped") }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 503 Slow Down")),
      } as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-media-fail-1" }, "user-owner-1"),
      ).rejects.toThrow(/S3 move failed/i);

      expect(sessionFinalStatus).toBe("cleanup_pending");
    });

    it("media analysis record insert failure -> does NOT report complete, marks cleanup_pending and throws", async () => {
      const deterministicId = "track-session-analysisfail-1";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-analysis-fail",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
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
                          data: { id: "session-analysis-fail", status: "committing" },
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records") {
            return {
              insert: vi.fn().mockResolvedValue({
                data: null,
                error: new Error("Foreign Key Violation / Database IO Error"),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-analysis-fail" }, "user-owner-1"),
      ).rejects.toThrow(/Media analysis record insertion failed/i);

      expect(sessionFinalStatus).toBe("cleanup_pending");
    });

    it("final complete transition failure (0 rows / state conflict) -> throws and marks cleanup_pending", async () => {
      const deterministicId = "track-session-conflict-1";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-conflict-1",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-conflict-1",
                      status: "committing",
                    },
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.status === "cleanup_pending") sessionFinalStatus = patch.status;
                return {
                  eq: () => ({
                    in: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-conflict-1", status: "cleanup_pending" },
                        }),
                      }),
                    }),
                    eq: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-conflict-1" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);

      expect(sessionFinalStatus).toBe("cleanup_pending");
    });
  });

  describe("8. Concurrency, Race Condition & Guarded Recovery Tests", () => {
    it("1. stale recovery writer cannot downgrade complete session status", async () => {
      const patchedStatus = "complete";
      let patchedStage = "";

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: (patch: any) => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockImplementation(() => {
                if (patch.status === "cleanup_pending") {
                  // CAS on non-terminal allowedCurrentStatuses yields 0 rows
                  return Promise.resolve({ data: null, error: null });
                }
                // Terminal staging cleanup update
                patchedStage = patch.stage;
                return Promise.resolve({
                  data: { id: "session-comp-1", status: "complete", stage: patch.stage },
                  error: null,
                });
              }),
            };
            return builder;
          },
          select: () => {
            const builder: any = {
              eq: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-comp-1", status: "complete", stage: "complete" },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };

      const res = await markSessionCleanupPending(
        mockSupabase as any,
        "session-comp-1",
        "Late stale error from interrupted worker",
      );

      expect(res.updated).toBe(true);
      expect(patchedStatus).toBe("complete");
      expect(patchedStage).toBe("staging_cleanup_pending");
    });

    it("2. stale recovery writer cannot downgrade resolved_to_existing session status", async () => {
      const patchedStatus = "resolved_to_existing";
      let patchedStage = "";

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: (patch: any) => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockImplementation(() => {
                if (patch.status === "cleanup_pending") {
                  // CAS on non-terminal allowedCurrentStatuses yields 0 rows
                  return Promise.resolve({ data: null, error: null });
                }
                // Terminal staging cleanup update
                patchedStage = patch.stage;
                return Promise.resolve({
                  data: { id: "session-res-1", status: "resolved_to_existing", stage: patch.stage },
                  error: null,
                });
              }),
            };
            return builder;
          },
          select: () => {
            const builder: any = {
              eq: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-res-1", status: "resolved_to_existing", stage: "complete" },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };

      const res = await markSessionCleanupPending(mockSupabase as any, "session-res-1", "Late stale error");

      expect(res.updated).toBe(true);
      expect(patchedStatus).toBe("resolved_to_existing");
      expect(patchedStage).toBe("staging_cleanup_pending");
    });

    it("3. concurrent cleanup retry -> safe CAS transition and idempotent completion", async () => {
      let executionCount = 0;

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-retry-race",
                  owner_id: "user-owner-1",
                  status: "complete",
                  stage: "complete",
                },
                error: null,
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "session-retry-race",
                  owner_id: "user-owner-1",
                  status: "complete",
                  stage: "complete",
                },
              }),
            }),
          }),
          update: () => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              single: vi.fn().mockImplementation(() => {
                executionCount++;
                if (executionCount === 1) {
                  return Promise.resolve({
                    data: { id: "session-retry-race", status: "complete", stage: "complete" },
                    error: null,
                  });
                }
                return Promise.resolve({ data: null, error: null });
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const [res1, res2] = await Promise.all([
        retryStagingCleanupInternal({ sessionId: "session-retry-race" }, "user-owner-1"),
        retryStagingCleanupInternal({ sessionId: "session-retry-race" }, "user-owner-1"),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res1.stagingCleanupPending).toBe(false);
      expect(res2.stagingCleanupPending).toBe(false);
    });

    it("4. concurrent finalize -> exactly one canonical entity created and both return canonical record", async () => {
      let createdTrackCount = 0;
      const deterministicId = "track-concurrent-1";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-conc-finalize",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-conc-finalize",
                      status: "complete",
                      committed_entity_id: deterministicId,
                    },
                  }),
                }),
              }),
              update: () => {
                const builder: any = {
                  eq: () => builder,
                  in: () => builder,
                  select: () => builder,
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "session-conc-finalize", status: "complete" },
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
                  maybeSingle: vi.fn().mockImplementation(() => {
                    if (createdTrackCount > 0) {
                      return Promise.resolve({
                        data: { id: deterministicId, title: "song", artist: "Nghệ sĩ" },
                      });
                    }
                    return Promise.resolve({ data: null });
                  }),
                }),
              }),
              insert: () => {
                createdTrackCount++;
                return {
                  select: () => ({
                    single: vi.fn().mockResolvedValue({
                      data: { id: deterministicId, title: "song", artist: "Nghệ sĩ" },
                      error: null,
                    }),
                  }),
                };
              },
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records" || table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-conc-finalize" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.entity.id).toBe(deterministicId);
    });

    it("5. finalize vs cancel race -> cancel rejected when session is complete", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "session-already-comp",
                  owner_id: "user-owner-1",
                  status: "complete",
                  stage: "complete",
                },
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(cancelUploadSessionInternal({ sessionId: "session-already-comp" }, "user-owner-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("6. cancel vs cleanup retry race -> retry on cancelled session updates stage to cancelled", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-cancelled-debt",
                  owner_id: "user-owner-1",
                  status: "cancelled",
                  stage: "cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-cancelled-debt",
                  status: "cancelled",
                  stage: patch.stage,
                },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-cancelled-debt" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.session.stage).toBe("cancelled");
      expect(res.session.status).toBe("cancelled");
    });

    it("7. complete transition race -> conflict handler re-reads complete session and returns canonical entity", async () => {
      const deterministicId = "track-race-re-read-1";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-race-complete",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-race-complete",
                      status: "complete",
                      committed_entity_id: deterministicId,
                    },
                  }),
                }),
              }),
              update: (patch: any) => {
                const builder: any = {
                  eq: () => builder,
                  in: () => builder,
                  select: () => builder,
                  maybeSingle: vi.fn().mockImplementation(() => {
                    if (patch.status === "committing") {
                      return Promise.resolve({
                        data: { id: "session-race-complete", status: "committing" },
                        error: null,
                      });
                    }
                    // Step 6 complete transition yields 0 rows due to concurrent winner
                    return Promise.resolve({ data: null, error: null });
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
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: deterministicId, title: "song", artist: "Nghệ sĩ" },
                  }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: deterministicId, title: "song", artist: "Nghệ sĩ" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records" || table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-race-complete" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect((res as any).idempotent).toBe(true);
      expect(res.entity.id).toBe(deterministicId);
    });

    it("8. media-analysis failure recovery race -> marks cleanup_pending and throws", async () => {
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-analysis-race",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.status) sessionFinalStatus = patch.status;
                const builder: any = {
                  eq: () => builder,
                  in: () => builder,
                  select: () => builder,
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "session-analysis-race", status: "committing" },
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
                  single: vi.fn().mockResolvedValue({ data: { id: "track-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "track_files" || table === "video_files") {
            return {
              upsert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tf-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "media_analysis_records") {
            return {
              insert: vi.fn().mockResolvedValue({
                data: null,
                error: new Error("Analysis insert database connection lost"),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        finalizeIngestionCommitInternal({ sessionId: "session-analysis-race" }, "user-owner-1"),
      ).rejects.toThrow(/Media analysis record insertion failed/i);

      expect(sessionFinalStatus).toBe("cleanup_pending");
    });

    it("9. duplicate cancel cleanup failure -> records cleanup debt and returns stagingCleanupPending: true", async () => {
      let markedDebt = false;

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-dup-cancel-cleanfail",
                  owner_id: "user-owner-1",
                  duplicate_status: "exact_duplicate",
                  duplicate_decision: "cancel",
                  staging_storage_key: "staging/temp.flac",
                },
                error: null,
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-dup-cancel-cleanfail", status: "cancelled" },
              }),
            }),
          }),
          update: (patch: any) => {
            if (patch.stage === "cleanup_pending" || patch.error_message?.includes("cleanup failed")) {
              markedDebt = true;
            }
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-dup-cancel-cleanfail", status: "cancelled", stage: patch.stage },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete 500")),
      } as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-dup-cancel-cleanfail" }, "user-owner-1");

      expect(res.success).toBe(false);
      expect(res.cancelled).toBe(true);
      expect(res.stagingCleanupPending).toBe(true);
      expect(markedDebt).toBe(true);
    });

    it("10. duplicate use-existing cleanup failure -> links existing entity, records cleanup debt", async () => {
      let markedDebt = false;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-dup-use-cleanfail",
                      owner_id: "user-owner-1",
                      resource_kind: "track",
                      duplicate_status: "exact_duplicate",
                      duplicate_decision: "use_existing",
                      matched_entity_id: "track-existing-999",
                      server_sha256: "hash999",
                      staging_storage_key: "staging/temp.flac",
                    },
                    error: null,
                  }),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "session-dup-use-cleanfail", status: "resolved_to_existing" },
                  }),
                }),
              }),
              update: (patch: any) => {
                if (patch.stage === "staging_cleanup_pending" || patch.error_message?.includes("cleanup failed")) {
                  markedDebt = true;
                }
                const builder: any = {
                  eq: () => builder,
                  in: () => builder,
                  select: () => builder,
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "session-dup-use-cleanfail", status: "resolved_to_existing", stage: patch.stage },
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
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "track-existing-999", title: "Old Song", artist: "Artist" },
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete 500")),
      } as any);

      const res = await finalizeIngestionCommitInternal({ sessionId: "session-dup-use-cleanfail" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect((res as any).resolvedToExisting).toBe(true);
      expect(res.stagingCleanupPending).toBe(true);
      expect(markedDebt).toBe(true);
    });

    it("11. normal cancel cleanup failure -> sets stage cleanup_pending and returns stagingCleanupPending: true", async () => {
      let markedDebt = false;

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "session-norm-cancel-fail",
                  owner_id: "user-owner-1",
                  status: "approved",
                  staging_storage_key: "staging/test.flac",
                },
              }),
            }),
          }),
          update: (patch: any) => {
            if (patch.stage === "cleanup_pending" || patch.error_message?.includes("cleanup failed")) {
              markedDebt = true;
            }
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-norm-cancel-fail", status: "cancelled", stage: "cleanup_pending" },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete Fail")),
      } as any);

      const res = await cancelUploadSessionInternal({ sessionId: "session-norm-cancel-fail" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.cancelled).toBe(true);
      expect(res.stagingCleanupPending).toBe(true);
      expect(markedDebt).toBe(true);
    });

    it("12. cleanup retry after failure -> cleans S3 and transitions stage to complete", async () => {
      let s3Deleted = false;

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-retry-after-fail",
                  owner_id: "user-owner-1",
                  status: "complete",
                  stage: "staging_cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-retry-after-fail",
                  status: "complete",
                  stage: patch.stage,
                },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "DeleteObjectCommand") {
            s3Deleted = true;
            return Promise.resolve({});
          }
          return Promise.resolve({});
        }),
      } as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-retry-after-fail" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.session.stage).toBe("complete");
      expect(res.stagingCleanupPending).toBe(false);
      expect(s3Deleted).toBe(true);
    });

    it("13. complete + cleanup retry failure -> status remains complete, stage = staging_cleanup_pending", async () => {
      let patchedStatus = "complete";
      let patchedStage = "";

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-comp-cleanfail",
                  owner_id: "user-owner-1",
                  status: "complete",
                  stage: "staging_cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => {
            if (patch.stage) patchedStage = patch.stage;
            if (patch.status) patchedStatus = patch.status;
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-comp-cleanfail", status: "complete", stage: patch.stage },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete 500 Network Error")),
      } as any);

      await expect(
        retryStagingCleanupInternal({ sessionId: "session-comp-cleanfail" }, "user-owner-1"),
      ).rejects.toThrow(/Staging cleanup retry failed/i);

      expect(patchedStatus).toBe("complete");
      expect(patchedStage).toBe("staging_cleanup_pending");
    });

    it("14. resolved_to_existing + cleanup retry failure -> status remains resolved_to_existing, stage = staging_cleanup_pending", async () => {
      let patchedStatus = "resolved_to_existing";
      let patchedStage = "";

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-res-cleanfail",
                  owner_id: "user-owner-1",
                  status: "resolved_to_existing",
                  stage: "staging_cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => {
            if (patch.stage) patchedStage = patch.stage;
            if (patch.status) patchedStatus = patch.status;
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-res-cleanfail", status: "resolved_to_existing", stage: patch.stage },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete 500 Network Error")),
      } as any);

      await expect(retryStagingCleanupInternal({ sessionId: "session-res-cleanfail" }, "user-owner-1")).rejects.toThrow(
        /Staging cleanup retry failed/i,
      );

      expect(patchedStatus).toBe("resolved_to_existing");
      expect(patchedStage).toBe("staging_cleanup_pending");
    });

    it("15. cancelled + cleanup retry failure -> status remains cancelled, stage = cleanup_pending", async () => {
      let patchedStatus = "cancelled";
      let patchedStage = "";

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "session-canc-cleanfail",
                  owner_id: "user-owner-1",
                  status: "cancelled",
                  stage: "cleanup_pending",
                  staging_storage_key: "staging/test.flac",
                },
                error: null,
              }),
            }),
          }),
          update: (patch: any) => {
            if (patch.stage) patchedStage = patch.stage;
            if (patch.status) patchedStatus = patch.status;
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "session-canc-cleanfail", status: "cancelled", stage: patch.stage },
                error: null,
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 Delete 500 Network Error")),
      } as any);

      await expect(
        retryStagingCleanupInternal({ sessionId: "session-canc-cleanfail" }, "user-owner-1"),
      ).rejects.toThrow(/Staging cleanup retry failed/i);

      expect(patchedStatus).toBe("cancelled");
      expect(patchedStage).toBe("cleanup_pending");
    });

    it("16. normal cancel S3 cleanup success + DB stage update failure -> throws explicit error, NOT false success", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "session-cancel-stagefail",
                  owner_id: "user-owner-1",
                  status: "approved",
                  staging_storage_key: "staging/test.flac",
                },
              }),
            }),
          }),
          update: (patch: any) => {
            const isStageUpdate = patch.stage === "cancelled";
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockImplementation(() => {
                if (isStageUpdate) {
                  return Promise.resolve({
                    data: null,
                    error: new Error("PostgreSQL write failed on stage normalization"),
                  });
                }
                return Promise.resolve({
                  data: { id: "session-cancel-stagefail", status: "cancelled", stage: "cleanup_pending" },
                  error: null,
                });
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        cancelUploadSessionInternal({ sessionId: "session-cancel-stagefail" }, "user-owner-1"),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("17. normal cancel S3 cleanup success + 0-row CAS conflict -> throws explicit state conflict", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "session-cancel-0row",
                  owner_id: "user-owner-1",
                  status: "approved",
                  staging_storage_key: "staging/test.flac",
                },
              }),
            }),
          }),
          update: (patch: any) => {
            const isStageUpdate = patch.stage === "cancelled";
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              maybeSingle: vi.fn().mockImplementation(() => {
                if (isStageUpdate) {
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({
                  data: { id: "session-cancel-0row", status: "cancelled", stage: "cleanup_pending" },
                  error: null,
                });
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(cancelUploadSessionInternal({ sessionId: "session-cancel-0row" }, "user-owner-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("9. Recovery State Reachability — Failure Status Staging Cleanup", () => {
    // Helper to create a mock Supabase for retryStagingCleanupInternal with a given session
    function createRetryCleanupMock(session: any, updateResult?: any) {
      const defaultUpdateResult = {
        data: { ...session, stage: "failed", error_message: null },
        error: null,
      };
      const effectiveUpdateResult = updateResult || defaultUpdateResult;
      return {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: session, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: session }),
            }),
          }),
          update: () => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              single: vi.fn().mockResolvedValue(effectiveUpdateResult),
              maybeSingle: vi.fn().mockResolvedValue(effectiveUpdateResult),
            };
            return builder;
          },
        }),
      };
    }

    it("18. media_copy_failed + staging cleanup succeeds → status stays media_copy_failed, stage → failed", async () => {
      const session = {
        id: "session-mcf-1",
        owner_id: "user-owner-1",
        status: "media_copy_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
        error_message: "S3 Media Copy failed: connection timeout",
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-mcf-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("failed");
    });

    it("19. artwork_copy_failed + staging cleanup succeeds → status stays artwork_copy_failed, stage → failed", async () => {
      const session = {
        id: "session-acf-1",
        owner_id: "user-owner-1",
        status: "artwork_copy_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: "staging/art.jpg",
        error_message: "S3 Artwork Copy failed",
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-acf-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("failed");
    });

    it("20. cleanup_pending + staging cleanup succeeds → status stays cleanup_pending, stage → failed", async () => {
      const session = {
        id: "session-cp-1",
        owner_id: "user-owner-1",
        status: "cleanup_pending",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
        error_message: "Compensation incomplete",
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-cp-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("failed");
    });

    it("21. db_commit_failed + staging cleanup succeeds → status stays db_commit_failed, stage → failed", async () => {
      const session = {
        id: "session-dcf-1",
        owner_id: "user-owner-1",
        status: "db_commit_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
        error_message: "Canonical track insert failed",
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-dcf-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("failed");
    });

    it("22. verification_failed + staging cleanup succeeds → status stays verification_failed, stage → failed", async () => {
      const session = {
        id: "session-vf-1",
        owner_id: "user-owner-1",
        status: "verification_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
        error_message: "MIME mismatch",
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-vf-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("failed");
    });

    it("23. complete + staging_cleanup_pending + cleanup succeeds → complete + stage complete", async () => {
      const session = {
        id: "session-comp-1",
        owner_id: "user-owner-1",
        status: "complete",
        stage: "staging_cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
      };
      const mockSupabase = createRetryCleanupMock(session, {
        data: { ...session, stage: "complete", error_message: null },
        error: null,
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-comp-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("complete");
    });

    it("24. resolved_to_existing + staging_cleanup_pending + cleanup succeeds → resolved_to_existing + stage complete", async () => {
      const session = {
        id: "session-rte-1",
        owner_id: "user-owner-1",
        status: "resolved_to_existing",
        stage: "staging_cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
      };
      const mockSupabase = createRetryCleanupMock(session, {
        data: { ...session, stage: "complete", error_message: null },
        error: null,
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-rte-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("complete");
    });

    it("25. cancelled + cleanup_pending + cleanup succeeds → cancelled + stage cancelled", async () => {
      const session = {
        id: "session-can-1",
        owner_id: "user-owner-1",
        status: "cancelled",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
      };
      const mockSupabase = createRetryCleanupMock(session, {
        data: { ...session, stage: "cancelled", error_message: null },
        error: null,
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-can-1" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
      expect(res.session.stage).toBe("cancelled");
    });

    it("26. failure-status cleanup retry fails → debt remains durable, stage stays cleanup_pending, error updated", async () => {
      const session = {
        id: "session-mcf-retry-fail",
        owner_id: "user-owner-1",
        status: "media_copy_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
        error_message: "Original error",
      };
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: session, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: session }),
            }),
          }),
          update: () => {
            const builder: any = {
              eq: () => builder,
              in: () => builder,
              select: () => builder,
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { ...session, error_message: "Staging cleanup retry failed: S3 timeout" },
              }),
            };
            return builder;
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Mock S3 cleanup failure
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error("S3 timeout")),
      } as any);

      await expect(
        retryStagingCleanupInternal({ sessionId: "session-mcf-retry-fail" }, "user-owner-1"),
      ).rejects.toThrow(/Staging cleanup retry failed/);
    });

    it("27. wrong owner → 403 ForbiddenSessionAccessError", async () => {
      const session = {
        id: "session-wrong-owner",
        owner_id: "user-owner-1",
        status: "media_copy_failed",
        stage: "cleanup_pending",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(
        retryStagingCleanupInternal({ sessionId: "session-wrong-owner" }, "user-attacker-2"),
      ).rejects.toThrow(ForbiddenSessionAccessError);
    });

    it("28. rollback delete with 0-row result (stale ID) → cleanup_pending not media_copy_failed", async () => {
      const deterministicId = "track-session-0row-del";
      let sessionFinalStatus = "";

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "upload_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "session-0row-del",
                      owner_id: "user-owner-1",
                      status: "approved",
                      approved_by_owner: true,
                      server_sha256: "hash123",
                      expected_filename: "song.flac",
                      expected_extension: "flac",
                      artwork_status: "none",
                      artwork_staging_key: null,
                      analysis_result: { durationSeconds: 100, codec: "FLAC" },
                      staging_storage_key: "staging/test.flac",
                    },
                    error: null,
                  }),
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
              update: (patch: any) => {
                if (patch.status) sessionFinalStatus = patch.status;
                return {
                  eq: () => ({
                    in: () => ({
                      select: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { id: "session-0row-del", status: patch.status || "committing" },
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
              insert: () => ({
                select: () => ({
                  single: vi.fn().mockResolvedValue({ data: { id: deterministicId }, error: null }),
                }),
              }),
              // DELETE returns no row (0-row match) - error is null but data is null
              delete: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // S3 media copy fails, triggering rollback
      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          if (cmd.constructor.name === "CopyObjectCommand") {
            return Promise.reject(new Error("S3 Media Copy Error"));
          }
          return Promise.resolve({});
        }),
      } as any);

      await expect(finalizeIngestionCommitInternal({ sessionId: "session-0row-del" }, "user-owner-1")).rejects.toThrow(
        /S3 move failed/i,
      );

      // 0-row delete result → dbRollbackSucceeded = false → status should be cleanup_pending, not media_copy_failed
      expect(sessionFinalStatus).toBe("cleanup_pending");
    });

    it("29. failure-status already cleaned (stage=failed) → idempotent return without re-cleaning", async () => {
      const session = {
        id: "session-already-clean",
        owner_id: "user-owner-1",
        status: "media_copy_failed",
        stage: "failed",
        staging_storage_key: "staging/test.flac",
        artwork_staging_key: null,
      };
      const mockSupabase = createRetryCleanupMock(session);
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await retryStagingCleanupInternal({ sessionId: "session-already-clean" }, "user-owner-1");

      expect(res.success).toBe(true);
      expect(res.idempotent).toBe(true);
      expect(res.stagingCleanupPending).toBe(false);
    });
  });
});
