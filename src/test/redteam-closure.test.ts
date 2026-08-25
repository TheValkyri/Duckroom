import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAndAnalyzeServerUploadInternal, IngestionVerificationError } from "../lib/ingestion";
import { analyzeAudioBuffer } from "../services/media-analysis/audio-analyzer";
import { analyzeVideoBuffer } from "../services/media-analysis/video-analyzer";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

/**
 * Red-team closure tests: artwork binary authority, transport-integrity gate,
 * VBR/ISOBMFF parser upgrades.
 */

function makeFlacBytes(sampleRate = 96000, bitDepth = 24): Uint8Array {
  const b = new Uint8Array(46);
  b[0] = 0x66;
  b[1] = 0x4c;
  b[2] = 0x61;
  b[3] = 0x43;
  b[4] = 0x80;
  b[7] = 0x22;
  const srBlock = ((sampleRate << 4) | ((bitDepth - 1) >> 4)) & 0xffff;
  b[18] = (srBlock >> 8) & 0xff;
  b[19] = srBlock & 0xff;
  b[20] = (((bitDepth - 1) & 0x0f) << 4) & 0xff;
  return b;
}

// Minimal standards-compliant JPEG: SOI + SOF0(8x8) + EOI
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);
const GARBAGE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

function installVerifyMocks(opts: {
  sessionExtra?: Record<string, unknown>;
  artworkKey?: string | null;
  artworkBytes?: Uint8Array | null;
}) {
  const capturedUpdates: Record<string, unknown>[] = [];
  const flac = makeFlacBytes();
  const session = {
    id: "session-rt",
    owner_id: "owner-1",
    status: "uploading",
    resource_kind: "track",
    expected_size_bytes: flac.length,
    expected_filename: "song.flac",
    expected_mime: "audio/flac",
    expected_extension: "flac",
    staging_storage_key: "temp/upload-sessions/session-rt/master.flac",
    artwork_staging_key: opts.artworkKey ?? null,
    client_sha256: null,
    ...opts.sessionExtra,
  };

  const mockSupabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "upload_sessions") {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: session, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            capturedUpdates.push(patch);
            const result: any = Promise.resolve({ data: null, error: null });
            result.in = () => result; // support .update().eq().in() CAS chains
            return { eq: () => result };
          },
        };
      }
      if (table === "tracks") {
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
      return {};
    }),
  };
  vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

  async function* mediaStream() {
    yield flac;
  }

  const s3Send = vi.fn().mockImplementation((cmd: any) => {
    if (cmd.constructor.name === "HeadObjectCommand") {
      return Promise.resolve({ ContentLength: flac.length });
    }
    if (cmd.constructor.name === "GetObjectCommand") {
      if (String(cmd.input.Key).includes("artwork")) {
        if (!opts.artworkBytes) throw new Error("no staged artwork");
        return Promise.resolve({
          Body: (async function* () {
            yield opts.artworkBytes!;
          })(),
        });
      }
      return Promise.resolve({ Body: mediaStream() });
    }
    return Promise.resolve({});
  });
  vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({ send: s3Send } as any);

  return { capturedUpdates };
}

describe("Phase 0-4 red-team closure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Artwork binary-inspection authority", () => {
    it("verifies artwork ONLY via magic-byte analysis and persists detected MIME", async () => {
      const { capturedUpdates } = installVerifyMocks({
        artworkKey: "temp/upload-sessions/session-rt/artwork.jpg",
        artworkBytes: JPEG_BYTES,
      });

      const res = await verifyAndAnalyzeServerUploadInternal({ sessionId: "session-rt", hasArtwork: true }, "owner-1");
      expect(res.artworkStatus).toBe("verified");

      const reviewUpdate = capturedUpdates.find((u) => u["artwork_detected_mime"] !== undefined);
      expect(reviewUpdate).toBeDefined();
      expect(reviewUpdate!["artwork_detected_mime"]).toBe("image/jpeg");
    });

    it("fails CLOSED when staged bytes are not a valid image binary", async () => {
      installVerifyMocks({
        artworkKey: "temp/upload-sessions/session-rt/artwork.jpg",
        artworkBytes: GARBAGE_BYTES,
      });

      const res = await verifyAndAnalyzeServerUploadInternal({ sessionId: "session-rt", hasArtwork: true }, "owner-1");
      expect(res.artworkStatus).toBe("failed");
    });
  });

  describe("Transport integrity gate", () => {
    it("rejects upload when client SHA-256 mismatches server hash (corruption in transit)", async () => {
      installVerifyMocks({
        sessionExtra: { client_sha256: "b".repeat(64) },
      });

      await expect(verifyAndAnalyzeServerUploadInternal({ sessionId: "session-rt" }, "owner-1")).rejects.toThrow(
        IngestionVerificationError,
      );
    });

    it("accepts matching client SHA-256 and completes verification", async () => {
      const flac = makeFlacBytes();
      // Compute real sha of fixture so gate passes
      const { createHash } = await import("node:crypto");
      const sha = createHash("sha256").update(flac).digest("hex");
      installVerifyMocks({ sessionExtra: { client_sha256: sha } });

      const res = await verifyAndAnalyzeServerUploadInternal({ sessionId: "session-rt" }, "owner-1");
      expect(res.serverSha256).toBe(sha);
      expect(res.analysis.container).toBe("FLAC");
    });
  });

  describe("Parser upgrades", () => {
    it("extracts exact duration from Xing frame count (VBR MP3)", () => {
      // Build MPEG-1 Layer III 44100 stereo frame header + Xing header
      const bytes = new Uint8Array(200);
      bytes[0] = 0xff;
      bytes[1] = 0xfb; // MPEG-1 L3, 128kbps index later
      bytes[2] = 0x90; // bitrate idx 9 =128k, sample idx 0 =44100
      bytes[3] = 0x00; // channel mode 0 = stereo (side info = 32 bytes)

      const enc = new TextEncoder();
      const xingOffset = 4 + 32; // stereo side info for MPEG-1
      bytes.set(enc.encode("Xing"), xingOffset);
      const view = new DataView(bytes.buffer);
      view.setUint32(xingOffset + 4, 0x0007); // flags: frames+bytes+toc
      const frames = 1000;
      view.setUint32(xingOffset + 8, frames);
      view.setUint32(xingOffset + 12, 500000);

      const res = analyzeAudioBuffer(bytes, bytes.length);
      expect(res.sampleRate).toBe(44100);
      expect(res.durationSeconds).toBe(Math.round((frames * 1152) / 44100));
    });

    it("detects QuickTime MOV container from ftyp qt brand", () => {
      const bytes = new Uint8Array(40);
      const enc = new TextEncoder();
      view32(bytes, 0, 24); // ftyp box size
      bytes.set(enc.encode("ftyp"), 4);
      bytes.set(enc.encode("qt  "), 8); // major brand
      const res = analyzeVideoBuffer(bytes, bytes.length);
      expect(res.container).toBe("MOV");
    });

    it("labels WebM containers as WEBM (not MKV)", () => {
      const bytes = new Uint8Array(64);
      bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0); // EBML
      const enc = new TextEncoder();
      bytes.set(enc.encode("DocType"), 8);
      bytes.set(enc.encode("webm"), 24);
      const res = analyzeVideoBuffer(bytes, bytes.length);
      expect(res.container).toBe("WEBM");
    });
  });
});

function view32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value);
}
