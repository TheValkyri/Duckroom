import { beforeEach, describe, expect, it, vi } from "vitest";
import { IngestionVerificationError, createUploadSessionInternal } from "../lib/ingestion";
import * as supabaseModule from "../lib/supabase";

/**
 * REAL production tests for SHA-256-first duplicate detection.
 * Drives createUploadSessionInternal (src/lib/ingestion.ts) against a mocked
 * Supabase admin client and asserts BOTH the returned verdict AND the exact
 * database query contract (sha256 equality + trash exclusion).
 */
describe("Media Integrity — production duplicate detection & ingestion guards", () => {
  const KNOWN_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const EXISTING_TRACK = { id: "track-1", title: "Một Đêm Trắng", artist: "Hồ Việt Trung" };

  let maybeSingleSpy: ReturnType<typeof vi.fn>;
  let eqSpy: ReturnType<typeof vi.fn>;

  function installDb(existingTrack: Record<string, unknown> | null) {
    maybeSingleSpy = vi.fn().mockResolvedValue({ data: existingTrack, error: null });
    eqSpy = vi.fn(() => ({ neq: (_col: string, _val: string) => ({ maybeSingle: maybeSingleSpy }) }));

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "tracks" || table === "videos") {
          return {
            select: () => ({ eq: eqSpy }),
          };
        }
        if (table === "upload_sessions") {
          return {
            insert: (row: Record<string, any>) => ({
              select: () => ({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: row["id"] ?? "session-fixed-id", ...row }, error: null }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          };
        }
        return {};
      }),
    };
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);
  }

  const baseInput = {
    expectedFilename: "song.flac",
    expectedSizeBytes: 42_000_000,
    expectedMime: "audio/flac",
    resourceKind: "track" as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue({} as any);
  });

  it("flags an EXACT DUPLICATE when the client SHA-256 matches a live library track", async () => {
    installDb(EXISTING_TRACK);

    const result = await createUploadSessionInternal({ ...baseInput, clientSha256: KNOWN_SHA }, "owner-1");

    expect(result.duplicateStatus).toBe("exact_duplicate");
    expect(result.matchedEntity).toEqual(EXISTING_TRACK);
    expect(result.matchedEntityId).toBe("track-1");

    // Query contract: equality on sha256 AND trash rows excluded
    expect(eqSpy).toHaveBeenCalledWith("sha256", KNOWN_SHA);
    expect(maybeSingleSpy).toHaveBeenCalledTimes(1);
  });

  it("reports NO duplicate when the SHA-256 is unique", async () => {
    installDb(null);

    const result = await createUploadSessionInternal({ ...baseInput, clientSha256: "aaaa".repeat(16) }, "owner-1");

    expect(result.duplicateStatus).toBe("none");
    expect(result.matchedEntity).toBeNull();
    expect(result.matchedEntityId).toBeNull();
  });

  it("skips the duplicate lookup entirely when no client hash is available", async () => {
    installDb(EXISTING_TRACK);

    const result = await createUploadSessionInternal(baseInput, "owner-1");

    expect(result.duplicateStatus).toBe("none");
    expect(eqSpy).not.toHaveBeenCalled();
  });

  it("routes video lookups to the videos table", async () => {
    const fromSpy = vi.fn();
    maybeSingleSpy = vi.fn().mockResolvedValue({
      data: { id: "video-1", title: "MV", artist: "Artist" },
      error: null,
    });
    eqSpy = vi.fn(() => ({ neq: () => ({ maybeSingle: maybeSingleSpy }) }));
    fromSpy.mockImplementation((table: string) =>
      table === "videos"
        ? { select: () => ({ eq: eqSpy }) }
        : {
            insert: (row: Record<string, any>) => ({
              select: () => ({
                single: vi.fn().mockResolvedValue({ data: { id: row["id"] ?? "sid", ...row }, error: null }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          },
    );
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue({ from: fromSpy } as any);

    const result = await createUploadSessionInternal(
      {
        expectedFilename: "mv.mp4",
        expectedSizeBytes: 500_000_000,
        expectedMime: "video/mp4",
        resourceKind: "video",
        clientSha256: KNOWN_SHA,
      },
      "owner-1",
    );

    expect(fromSpy).toHaveBeenCalledWith("videos");
    expect(result.duplicateStatus).toBe("exact_duplicate");
  });

  it("rejects unsupported audio extensions before any DB access", async () => {
    installDb(null);
    await expect(
      createUploadSessionInternal({ ...baseInput, expectedFilename: "song.ogg" }, "owner-1"),
    ).rejects.toThrow(IngestionVerificationError);
    expect(eqSpy).not.toHaveBeenCalled();
  });

  it("rejects files exceeding the 2GB audio ceiling", async () => {
    installDb(null);
    await expect(
      createUploadSessionInternal({ ...baseInput, expectedSizeBytes: 3 * 1024 * 1024 * 1024 }, "owner-1"),
    ).rejects.toThrow(/2GB/);
  });

  it("rejects files exceeding the 10GB video ceiling", async () => {
    installDb(null);
    await expect(
      createUploadSessionInternal(
        {
          ...baseInput,
          resourceKind: "video",
          expectedFilename: "mv.mp4",
          expectedMime: "video/mp4",
          expectedSizeBytes: 11 * 1024 * 1024 * 1024,
        },
        "owner-1",
      ),
    ).rejects.toThrow(/10GB/);
  });
});
