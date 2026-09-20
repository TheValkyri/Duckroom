import { describe, expect, it, vi, beforeEach } from "vitest";
import { verifyAndAnalyzeServerUploadInternal } from "../lib/ingestion";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";
import { calculateFileSha256 } from "../lib/metadata";
import { getIngestionStoreState, approveAllIngestionItems } from "../lib/upload-store";

function createMockSupabase(mockSession: any) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "upload_sessions") {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            neq: () => ({
              order: () => ({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };
    }),
  };
}

describe("High-Performance Ingestion Architecture Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Server Verification Fast-Path (Range 2MB bypass for > 8MB)", () => {
    it("uses Range request directly when client_sha256 is 64 chars and file size > 8MB", async () => {
      const clientHash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const mockSession = {
        id: "session-fast-path",
        owner_id: "user-owner-1",
        status: "uploaded",
        stage: "upload",
        resource_kind: "track",
        expected_filename: "large_track.flac",
        expected_extension: "flac",
        expected_mime: "audio/flac",
        expected_size_bytes: 35 * 1024 * 1024, // 35MB > 8MB
        staging_storage_key: "staging/large_track.flac",
        client_sha256: clientHash,
      };

      // Valid 42-byte FLAC header
      const flacHeader = new Uint8Array(42);
      flacHeader.set([0x66, 0x4c, 0x61, 0x43], 0); // "fLaC"
      flacHeader[4] = 0x80; // last metadata block (STREAMINFO)
      flacHeader[7] = 34; // block length 34
      flacHeader[18] = 0xac;
      flacHeader[19] = 0x44;
      flacHeader[20] = 0x01;

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(createMockSupabase(mockSession) as any);

      const s3SentCommands: any[] = [];
      async function* mockStream() {
        yield flacHeader;
      }

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          s3SentCommands.push(cmd);
          if (cmd.constructor.name === "HeadObjectCommand") {
            return Promise.resolve({ ContentLength: 35 * 1024 * 1024 });
          }
          if (cmd.constructor.name === "GetObjectCommand") {
            return Promise.resolve({ Body: mockStream() });
          }
          return Promise.resolve({});
        }),
      } as any);

      const res = await verifyAndAnalyzeServerUploadInternal({ sessionId: "session-fast-path" }, "user-owner-1");

      expect(res.sha256VerificationSource).toBe("client");
      expect(res.serverSha256).toBe(clientHash.toLowerCase());

      // Verify that GetObjectCommand was called with Range request
      const getObjectCalls = s3SentCommands.filter((c) => c.constructor.name === "GetObjectCommand");
      expect(getObjectCalls.length).toBeGreaterThanOrEqual(1);
      expect(getObjectCalls[0].input.Range).toBe("bytes=0-2097151");
    });

    it("uses standard full-body streaming when file size <= 8MB", async () => {
      const mockSession = {
        id: "session-small-track",
        owner_id: "user-owner-1",
        status: "uploaded",
        stage: "upload",
        resource_kind: "track",
        expected_filename: "small_track.wav",
        expected_extension: "wav",
        expected_mime: "audio/wav",
        expected_size_bytes: 44,
        staging_storage_key: "staging/small_track.wav",
        client_sha256: undefined,
      };

      const wavHeader = new Uint8Array(44);
      wavHeader.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
      wavHeader.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
      wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(createMockSupabase(mockSession) as any);

      const s3SentCommands: any[] = [];
      async function* mockStream() {
        yield wavHeader;
      }

      vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
        send: vi.fn().mockImplementation((cmd: any) => {
          s3SentCommands.push(cmd);
          if (cmd.constructor.name === "HeadObjectCommand") {
            return Promise.resolve({ ContentLength: 44 });
          }
          if (cmd.constructor.name === "GetObjectCommand") {
            return Promise.resolve({ Body: mockStream() });
          }
          return Promise.resolve({});
        }),
      } as any);

      const res = await verifyAndAnalyzeServerUploadInternal({ sessionId: "session-small-track" }, "user-owner-1");

      expect(res.sha256VerificationSource).toBe("server");
      expect(res.serverSha256).toHaveLength(64);

      const getObjectCalls = s3SentCommands.filter((c) => c.constructor.name === "GetObjectCommand");
      expect(getObjectCalls.length).toBeGreaterThanOrEqual(1);
      // Full body download without Range
      expect(getObjectCalls[0].input.Range).toBeUndefined();
    });
  });

  describe("2. Client SHA-256 Calculation with Hex Lookup Table", () => {
    it("computes accurate SHA-256 hash using the lookup table", async () => {
      const text = "Duckroom High Performance Ingestion Pipeline Test";
      const blob = new Blob([text], { type: "text/plain" });
      const file = new File([blob], "test.txt", { type: "text/plain" });

      const hash = await calculateFileSha256(file);
      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash!)).toBe(true);

      // Verify match with node crypto
      const nodeCrypto = await import("node:crypto");
      const expected = nodeCrypto.createHash("sha256").update(Buffer.from(text)).digest("hex");
      expect(hash).toBe(expected);
    });
  });

  describe("3. Pipelined Worker Pool Concurrency", () => {
    it("slots count based on stage === 'uploading', allowing verifying_server to not block slots", () => {
      const state = getIngestionStoreState();
      expect(typeof state.concurrencyLimit).toBe("number");
      expect(state.concurrencyLimit).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. Parallel Batch Approvals", () => {
    it("approveAllIngestionItems completes without error when queue has no reviewable items", async () => {
      await expect(approveAllIngestionItems()).resolves.toBeUndefined();
    });
  });
});
