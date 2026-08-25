import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeMatchConfidence,
  findLocalMatchesInternal,
  linkExternalIdentityInternal,
  normalizeForMatch,
  parseSpotifyUrl,
  probeSpotifyResourceInternal,
} from "../services/spotify";
import * as supabaseModule from "../lib/supabase";

/**
 * Spotify Bridge tests (Master Plan §14).
 * Pure logic is tested directly; probe/match/link internals run against
 * mocked transports so no network or live Supabase is ever required.
 */

function makeDb(tables: Record<string, any>) {
  const captured: Record<string, unknown> = {};
  const db = {
    __captured: captured,
    from: vi.fn((table: string) => {
      const spec = tables[table];
      if (!spec) throw new Error(`Unexpected table access: ${table}`);
      if (spec.upsert) {
        return {
          upsert: vi.fn(async (row: unknown, opts?: unknown) => {
            captured[`${table}.upsert.row`] = row;
            captured[`${table}.upsert.opts`] = opts;
            return spec.upsert(row, opts);
          }),
        };
      }
      if (spec.insert) {
        return {
          insert: vi.fn(async (row: unknown) => {
            captured[`${table}.insert`] = row;
            return spec.insert(row);
          }),
        };
      }
      // Row-lookup style table: select -> eq -> maybeSingle
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: spec.data ?? null, error: spec.error ?? null });
      return builder;
    }),
  };
  return db as any;
}

describe("parseSpotifyUrl", () => {
  it("parses open.spotify.com URLs and strips query params", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123")).toEqual({
      type: "track",
      id: "4uLU6hMCjMI75M1A2tKUQC",
    });
  });

  it("parses user-scoped playlist URLs", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/user/wizzler/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      type: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M",
    });
  });

  it("parses spotify: URIs and all four resource types", () => {
    expect(parseSpotifyUrl("spotify:album:1DFixLWuPkv3KT3TnV35m3")).toEqual({
      type: "album",
      id: "1DFixLWuPkv3KT3TnV35m3",
    });
    expect(parseSpotifyUrl("spotify:artist:0OdUWJ0sBjDrqHygGUXeCF")).toMatchObject({ type: "artist" });
    expect(parseSpotifyUrl("SPOTIFY:TRACK:4iV5W9uYEdYUVa79Axb7Rh")).toMatchObject({ type: "track" });
  });

  it("rejects non-Spotify hosts, garbage input, and malformed ids", () => {
    expect(parseSpotifyUrl("https://youtube.com/watch?v=x")).toBeNull();
    expect(parseSpotifyUrl("not a url")).toBeNull();
    expect(parseSpotifyUrl("")).toBeNull();
    expect(parseSpotifyUrl(null as unknown as string)).toBeNull();
    expect(parseSpotifyUrl("https://open.spotify.com/track/short-id")).toBeNull();
    expect(parseSpotifyUrl("https://open.spotify.com/episode/4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
  });
});

describe("normalizeForMatch + computeMatchConfidence", () => {
  it("strips Vietnamese diacritics, punctuation and extra whitespace", () => {
    expect(normalizeForMatch("Đường Về Hai Đầu! (MV Official)")).toBe("duong ve hai dau mv official");
    expect(normalizeForMatch("  Trống –   mặt ")).toBe("trong mat");
  });

  it("scores an exact title+artist match at 1.0", () => {
    expect(
      computeMatchConfidence({
        externalTitle: "Sài Gòn Tôi Rồi",
        externalArtists: ["Tùng Dương"],
        candidateTitle: "Sài Gòn Tôi Rồi",
        candidateArtist: "Tùng Dương",
      }),
    ).toBe(1);
  });

  it("scores diacritic-only differences as a full match", () => {
    const score = computeMatchConfidence({
      externalTitle: "Duong Ve Hai Dau",
      externalArtists: ["K-ICM", "JACK"],
      candidateTitle: "Đường Về Hai Đầu",
      candidateArtist: "JACK",
    });
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("gives unrelated songs a low score below the display threshold", () => {
    const score = computeMatchConfidence({
      externalTitle: "Blinding Lights",
      externalArtists: ["The Weeknd"],
      candidateTitle: "Hai Phut Hon",
      candidateArtist: "Phao",
    });
    expect(score).toBeLessThan(0.35);
  });

  it("returns 0 when either side has no usable title", () => {
    expect(
      computeMatchConfidence({
        externalTitle: "",
        externalArtists: ["X"],
        candidateTitle: "Song",
        candidateArtist: "Y",
      }),
    ).toBe(0);
  });
});

describe("probeSpotifyResourceInternal — graceful degradation ladder (AD-8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env["SPOTIFY_CLIENT_ID"];
    delete process.env["SPOTIFY_CLIENT_SECRET"];
  });

  it("returns invalid_url without touching the network for non-Spotify links", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await probeSpotifyResourceInternal({ url: "https://example.com/nope" });
    expect(res.status).toBe("invalid_url");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back through web-api failure AND total network outage to status=unavailable (§14.4)", async () => {
    process.env["SPOTIFY_CLIENT_ID"] = "id";
    process.env["SPOTIFY_CLIENT_SECRET"] = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENETDOWN");
      }),
    );
    const res = await probeSpotifyResourceInternal({
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    });
    expect(res.status).toBe("unavailable");
    expect(res).toMatchObject({ status: "unavailable" });
    vi.unstubAllGlobals();
    delete process.env["SPOTIFY_CLIENT_ID"];
    delete process.env["SPOTIFY_CLIENT_SECRET"];
  });

  it("uses public oEmbed (partial metadata) when credentials are absent but network works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input instanceof URL ? input : (input?.url ?? input));
        if (url.includes("open.spotify.com/oembed")) {
          return new Response(
            JSON.stringify({ title: "Blinding Lights — The Weeknd", thumbnail_url: "https://img/x.jpg" }),
            { status: 200 },
          );
        }
        throw new Error("unexpected fetch target");
      }) as unknown as typeof fetch,
    );
    const res = await probeSpotifyResourceInternal({
      url: "https://open.spotify.com/track/0VjIjW4GlUZAMY0vPPYzeo",
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.resource.source).toBe("oembed");
      expect(res.resource.title).toContain("Blinding Lights");
    }
    vi.unstubAllGlobals();
  });
});

describe("findLocalMatchesInternal", () => {
  it("ranks local candidates by confidence and drops sub-threshold noise", async () => {
    const rows = [
      { id: "t1", title: "Đường Về Hai Đầu", artist: "JACK" },
      { id: "t2", title: "Hoàng Hôn Nhớ", artist: "Trinh" },
      { id: "t3", title: "Duong Ve Khac", artist: "Lan" },
    ];
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          limit: () => Promise.resolve({ data: rows, error: null }),
        }),
      })),
    } as any;
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const { candidates } = await findLocalMatchesInternal({ title: "Đường Về Hai Đầu", artists: ["JACK"] });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]?.resourceId).toBe("t1");
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(candidates.some((c) => c.resourceId === "t2")).toBe(false);
  });

  it("propagates Postgres errors instead of fabricating an empty list (§20.1)", async () => {
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: "Postgres down" } }),
        }),
      })),
    } as any;
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(findLocalMatchesInternal({ title: "x" })).rejects.toThrow(/Postgres down/);
  });
});

describe("linkExternalIdentityInternal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to persist an identity pointing at a nonexistent resource", async () => {
    const db = makeDb({ tracks: {} });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(
      linkExternalIdentityInternal({
        provider: "spotify",
        externalType: "track",
        externalId: "4uLU6hMCjMI75M1A2tKUQC",
        resourceKind: "track",
        resourceId: "missing-track",
      }),
    ).rejects.toThrow(/không tồn tại/);
  });

  it("upserts the generic identity row and records an audit event", async () => {
    const db = makeDb({
      tracks: { data: { id: "t1" } },
      external_identities: { upsert: async () => ({ data: null, error: null }) },
      audit_logs: { insert: async () => ({ data: null, error: null }) },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await linkExternalIdentityInternal(
      {
        provider: "spotify",
        externalType: "track",
        externalId: "4uLU6hMCjMI75M1A2tKUQC",
        externalUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        resourceKind: "track",
        resourceId: "t1",
        confidence: 0.95,
      },
      "owner-1",
    );
    expect(res.success).toBe(true);
    const row = db.__captured["external_identities.upsert.row"] as Record<string, unknown>;
    expect(row).toMatchObject({
      provider: "spotify",
      resource_kind: "track",
      resource_id: "t1",
      match_confidence: 0.95,
      linked_by: "owner-1",
    });
    expect(db.__captured["audit_logs.insert"]).toMatchObject({ action: "spotify.identity_linked" });
  });

  it("still succeeds when only the audit write fails (audit never blocks business)", async () => {
    const db = makeDb({
      albums: { data: { id: "a1" } },
      external_identities: { upsert: async () => ({ data: null, error: null }) },
      audit_logs: { insert: async () => ({ data: null, error: { message: "audit down" } }) },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await linkExternalIdentityInternal(
      {
        provider: "spotify",
        externalType: "album",
        externalId: "1DFixLWuPkv3KT3TnV35m3",
        resourceKind: "album",
        resourceId: "a1",
        confidence: null,
      },
      null,
    );
    expect(res.success).toBe(true);
    const row = db.__captured["external_identities.upsert.row"] as Record<string, unknown>;
    expect(row).toMatchObject({ resource_kind: "album", resource_id: "a1", linked_by: null });
  });

  it("surfaces upsert errors from the database layer", async () => {
    const db = makeDb({
      tracks: { data: { id: "t1" } },
      external_identities: { upsert: async () => ({ data: null, error: { message: "unique violation" } }) },
      audit_logs: { insert: async () => ({ data: null, error: null }) },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(
      linkExternalIdentityInternal(
        {
          provider: "spotify",
          externalType: "track",
          externalId: "4uLU6hMCjMI75M1A2tKUQC",
          resourceKind: "track",
          resourceId: "t1",
        },
        null,
      ),
    ).rejects.toThrow(/unique violation/);
  });
});
