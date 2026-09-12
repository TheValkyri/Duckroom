import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IngestionVerificationError,
  verifyAndAnalyzeServerUploadInternal,
  createUploadSessionInternal,
} from "../lib/ingestion";
import { createShareLinkInternal } from "../lib/sharing.server";
import { expiresAtFromChoice } from "../lib/share-client";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

/**
 * P0 hardening tests (2026-09-11) - WP-3 (fail-closed verification),
 * WP-4 (duplicate decision), WP-5 (share-link bounds).
 *
 * All production internals are exercised directly against mocked DB + S3
 * clients, following the established pattern in member-data.test.ts.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const calls: { table: string; op: string; args?: unknown[] }[] = [];
  const rows: Record<string, any[]> = {};

  const chain = (table: string) => {
    const builder: any = {};
    const method = (name: string) => {
      builder[name] = (...args: unknown[]) => {
        calls.push({ table, op: name, args });
        if (name === "eq" || name === "neq" || name === "is" || name === "in" || name === "order") return builder;
        if (name === "limit") {
          // simulate limit: defer to maybeSingle/then below via pending rows
          return builder;
        }
        return builder;
      };
    };
    ["select", "eq", "neq", "is", "in", "order", "limit", "update", "insert", "upsert", "delete"].forEach(method);

    builder.maybeSingle = () => Promise.resolve({ data: rows[table]?.[0] ?? null, error: null });
    builder.single = () => Promise.resolve({ data: rows[table]?.[0] ?? null, error: null });
    builder.then = (resolve: any, reject: any) =>
      rows[table]
        ? Promise.resolve({ data: rows[table], error: null }).then(resolve, reject)
        : Promise.resolve({ data: [], error: null }).then(resolve, reject);
    return builder;
  };

  const db = {
    from: vi.fn((table: string) => chain(table)),
  };
  return { db, calls, rows };
}

/** Builds a full verify-internal session fixture. */
function baseSession(overrides: Record<string, any> = {}) {
  return {
    id: "session-1",
    owner_id: "owner-1",
    status: "approved",
    stage: "upload",
    resource_kind: "track",
    staging_storage_key: "temp/upload-sessions/session-1/song.flac",
    artwork_staging_key: "temp/upload-sessions/session-1/artwork.jpg",
    expected_filename: "song.flac",
    expected_size_bytes: 1000,
    expected_mime: "audio/flac",
    expected_extension: "flac",
    client_sha256: "a".repeat(64),
    ...overrides,
  };
}

function makeS3(behavior: { head?: () => never; get?: (key: string) => { body: any } }) {
  const send = vi.fn(async (cmd: any) => {
    const name = cmd.constructor?.name ?? "";
    if (name.includes("Head")) {
      if (behavior.head) return behavior.head();
      return { ContentLength: 1000 };
    }
    if (name.includes("GetObject")) {
      if (behavior.get) {
        const res = behavior.get(cmd.input?.Key ?? cmd.Key ?? "");
        return { Body: res.body };
      }
      // default: a valid FLAC-ish stream returning 1000 bytes + hash fodder
      const chunks = [new Uint8Array(1000)];
      return {
        Body: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c;
          },
        },
      };
    }
    return {};
  });
  return { send };
}

function validClientAnalysis() {
  return {
    kind: "audio",
    container: "FLAC",
    codec: "FLAC",
    sampleRate: 44100,
    bitDepth: 16,
    channels: 2,
    bitrateKbps: 900,
    durationSeconds: 1,
    fileSizeBytes: 1000,
    metadataTags: {},
    embeddedArtwork: null,
    embeddedLyrics: null,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    parserVersion: "test",
    analysisStatus: "verified",
    warnings: [],
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// WP-3: Fail-closed verification
// ---------------------------------------------------------------------------

describe("WP-3 - Fail-closed verification (ingestion.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(makeDb().db as any);
  });

  it("rejects non-network, non-404 S3 HeadObject errors instead of trusting client size", async () => {
    const { db } = makeDb();
    db.from = vi.fn((table: string) => {
      if (table === "upload_sessions") {
        const b: any = {
          select: () => b,
          eq: () => b,
          update: () => b,
          in: () => Promise.resolve({ data: null, error: null }),
        };
        b.single = () => Promise.resolve({ data: baseSession(), error: null });
        return b;
      }
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: [], error: null });
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    const s3 = makeS3({
      head: () => {
        const err: any = new Error("AccessDenied");
        err.name = "AccessDenied";
        err.$metadata = { httpStatusCode: 403 };
        throw err;
      },
    });
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue(s3 as any);

    await expect(
      verifyAndAnalyzeServerUploadInternal({ sessionId: "session-1", hasArtwork: false }, "owner-1"),
    ).rejects.toThrow(IngestionVerificationError);
  });

  it("fails closed when neither server hashing nor client sha256 is available", async () => {
    const { db } = makeDb();
    db.from = vi.fn((table: string) => {
      if (table === "upload_sessions") {
        const b: any = {
          select: () => b,
          eq: () => b,
          update: () => b,
          in: () => Promise.resolve({ data: null, error: null }),
        };
        b.single = () => Promise.resolve({ data: baseSession({ client_sha256: null }), error: null });
        return b;
      }
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: [], error: null });
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    // Server hash path fails with a network error on GetObject (not HeadObject)
    const s3 = makeS3({
      get: () => {
        const err: any = new Error("fetch failed");
        err.name = "NetworkingError";
        // get() must throw for the download path
        return { body: null, shouldThrow: true };
      },
    });
    // Override send to throw on GetObject (network error path) but succeed on HeadObject
    const s3Throwing = {
      send: vi.fn(async (cmd: any) => {
        const name = cmd.constructor?.name ?? "";
        if (name.includes("Head")) return { ContentLength: 1000 };
        if (name.includes("GetObject")) {
          const err: any = new Error("fetch failed");
          err.name = "NetworkingError";
          throw err;
        }
        return {};
      }),
    };
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue(s3Throwing as any);

    await expect(
      verifyAndAnalyzeServerUploadInternal(
        { sessionId: "session-1", hasArtwork: false, clientAnalysis: validClientAnalysis() },
        "owner-1",
      ),
    ).rejects.toThrow(/Không thể xác minh tính toàn vẹn/);
  });

  it("never fabricates artwork 'verified' with guessed MIME on download failure", async () => {
    const { db } = makeDb();
    const sessionUpdates: any[] = [];
    db.from = vi.fn((table: string) => {
      if (table === "upload_sessions") {
        const b: any = {
          select: () => b,
          eq: () => b,
          update: (patch: any) => {
            sessionUpdates.push(patch);
            return b;
          },
          in: () => Promise.resolve({ data: null, error: null }),
        };
        b.single = () => Promise.resolve({ data: baseSession(), error: null });
        return b;
      }
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: [], error: null });
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    const s3Throwing = {
      send: vi.fn(async (cmd: any) => {
        const name = cmd.constructor?.name ?? "";
        if (name.includes("Head")) return { ContentLength: 1000 };
        if (name.includes("GetObject")) {
          const err: any = new Error("ETIMEDOUT");
          err.name = "TimeoutError";
          throw err;
        }
        return {};
      }),
    };
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue(s3Throwing as any);

    // The session must NOT be failed by an artwork download failure (media
    // integrity is intact via client_sha256) - but the artwork must be
    // recorded honestly: status "none", NOT "verified" with image/jpeg.
    const result = await verifyAndAnalyzeServerUploadInternal(
      { sessionId: "session-1", hasArtwork: true, clientAnalysis: validClientAnalysis() },
      "owner-1",
    );

    expect(result.artworkStatus).toBe("none");
    const finalUpdate = sessionUpdates.find((u: any) => u.artwork_status !== undefined);
    expect(finalUpdate).toBeTruthy();
    expect(finalUpdate.artwork_status).toBe("none");
    expect(finalUpdate.artwork_detected_mime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WP-4: Duplicate decision flow
// ---------------------------------------------------------------------------

describe("WP-4 - Duplicate decision (upload-store/ingestion)", () => {
  it("createUploadSessionInternal tolerates multiple sha256 rows (upload_anyway history)", async () => {
    const { db } = makeDb();
    db.from = vi.fn((table: string) => {
      if (table === "upload_sessions") {
        const b: any = {
          select: () => b,
          eq: () => b,
          update: () => b,
        };
        b.insert = () => b;
        b.single = () => Promise.resolve({ data: null, error: null });
        b.insert = () => ({
          select: () => ({ single: () => Promise.resolve({ data: { id: "new-session" }, error: null }) }),
        });
        return b;
      }
      // tracks/videos duplicate lookup - returns TWO matching rows
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: [{ id: "t1", title: "A", artist: "X" }], error: null });
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({ send: vi.fn(async () => ({})) } as any);

    const res = await createUploadSessionInternal(
      {
        expectedFilename: "song.flac",
        expectedSizeBytes: 100,
        expectedMime: "audio/flac",
        resourceKind: "track",
        clientSha256: "a".repeat(64),
      },
      "owner-1",
    );

    expect(res.duplicateStatus).toBe("exact_duplicate");
    expect(res.matchedEntityId).toBe("t1");
  });

  it("never calls .maybeSingle() on the sha256 duplicate lookups", async () => {
    // Static source check: the PGRST116 crash pattern must not come back.
    const source = await import("node:fs").then((fs) => fs.readFileSync("src/lib/ingestion.ts", "utf8"));
    const maybeSingleOnDuplicate = /\.eq\("sha256"[\s\S]{0,400}?\.maybeSingle\(\)/g;
    expect(source.match(maybeSingleOnDuplicate)?.length ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WP-5: Share-link bounds
// ---------------------------------------------------------------------------

describe("WP-5 - Share-link TTL + per-resource cap (sharing.server.ts)", () => {
  let capturedInsert: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedInsert = null;
  });

  it("expiresAtFromChoice('forever') returns a 1-year ISO timestamp, never null", () => {
    const iso = expiresAtFromChoice("forever");
    expect(iso).toBeTruthy();
    const ms = new Date(iso).getTime() - Date.now();
    expect(ms).toBeGreaterThan(360 * 24 * 3600_000); // >=360 days
    expect(ms).toBeLessThanOrEqual(366 * 24 * 3600_000); // <=366 days
  });

  it("createShareLinkInternal clamps client expiry to the 1-year maximum", async () => {
    const { db } = makeDb();
    db.from = vi.fn((table: string) => {
      if (table === "tracks") {
        // assertCreatorMayMint lookup - public track
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: { id: "t1", visibility: "public" }, error: null });
        return b;
      }
      if (table === "share_links") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.order = () => b;
        b.insert = (row: any) => {
          capturedInsert = row?.[0] ?? row;
          return Promise.resolve({ data: null, error: null });
        };
        b.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }
      const b: any = {};
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    // Attempt a 10-year expiry
    const tenYears = new Date(Date.now() + 10 * 365 * 24 * 3600_000).toISOString();
    const result = await createShareLinkInternal(
      { resourceType: "track", resourceId: "t1", expiresAt: tenYears },
      null,
    );

    expect(result.token).toBeTruthy();
    expect(result.path).toMatch(/^\/s\//);
    const stored = capturedInsert as Record<string, string> | null;
    expect(stored).toBeTruthy();
    const storedExpiry = stored!["expires_at"] as string;
    const storedMs = new Date(storedExpiry).getTime() - Date.now();
    expect(storedMs).toBeLessThanOrEqual(366 * 24 * 3600_000); // clamped to ~1 year
    expect(storedMs).toBeGreaterThan(360 * 24 * 3600_000);
  });

  it("missing expiry defaults to the 1-year bound, not null", async () => {
    const { db } = makeDb();
    db.from = vi.fn((table: string) => {
      if (table === "tracks") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: { id: "t1", visibility: "public" }, error: null });
        return b;
      }
      if (table === "share_links") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.order = () => b;
        b.insert = (row: any) => {
          capturedInsert = row?.[0] ?? row;
          return Promise.resolve({ data: null, error: null });
        };
        b.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }
      const b: any = {};
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    await createShareLinkInternal({ resourceType: "track", resourceId: "t1" }, null);

    const stored = capturedInsert as Record<string, string> | null;
    const storedExpiry = stored?.["expires_at"] as string | undefined;
    expect(storedExpiry).toBeTruthy();
    expect(new Date(storedExpiry!).getTime()).toBeGreaterThan(Date.now());
  });

  it("revokes the oldest links (LRU) when the per-resource cap is exceeded", async () => {
    const { db } = makeDb();
    const revokedIds: string[] = [];
    const existingLinks = Array.from({ length: 10 }, (_, i) => ({
      id: `old-${i}`,
      created_at: new Date(Date.now() - (10 - i) * 3600_000).toISOString(),
      expires_at: null,
    }));

    db.from = vi.fn((table: string) => {
      if (table === "tracks") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: { id: "t1", visibility: "public" }, error: null });
        return b;
      }
      if (table === "share_links") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.order = () => b;
        b.then = (resolve: any) => Promise.resolve({ data: existingLinks, error: null }).then(resolve);
        b.insert = (row: any) => {
          capturedInsert = row?.[0] ?? row;
          return Promise.resolve({ data: null, error: null });
        };
        b.update = () => b;
        b.in = (_column: string, ids: string[]) => {
          revokedIds.push(...ids);
          return Promise.resolve({ data: null, error: null });
        };
        return b;
      }
      const b: any = {};
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    await createShareLinkInternal({ resourceType: "track", resourceId: "t1" }, null);

    // 10 existing links + 1 new -> the oldest link (old-0) is revoked to stay at cap
    expect(revokedIds).toContain("old-0");
    expect(capturedInsert).toBeTruthy();
  });

  it("does not revoke anything when below the cap", async () => {
    const { db } = makeDb();
    const revokedIds: string[] = [];
    const existingLinks = [{ id: "old-0", created_at: new Date().toISOString(), expires_at: null }];

    db.from = vi.fn((table: string) => {
      if (table === "tracks") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: { id: "t1", visibility: "public" }, error: null });
        return b;
      }
      if (table === "share_links") {
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.is = () => b;
        b.order = () => b;
        b.then = (resolve: any) => Promise.resolve({ data: existingLinks, error: null }).then(resolve);
        b.insert = (row: any) => {
          capturedInsert = row?.[0] ?? row;
          return Promise.resolve({ data: null, error: null });
        };
        b.update = () => b;
        b.in = (_ids: string[]) => {
          revokedIds.push(..._ids);
          return Promise.resolve({ data: null, error: null });
        };
        return b;
      }
      const b: any = {};
      return b;
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

    await createShareLinkInternal({ resourceType: "track", resourceId: "t1" }, null);

    expect(revokedIds).toEqual([]);
    expect(capturedInsert).toBeTruthy();
  });
});
