import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShareLinkInternal, revokeShareLinkInternal, resolveShareLinkInternal } from "../lib/sharing.server";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockImplementation((_s3, cmd) => Promise.resolve(`https://signed/${cmd.input.Key}`)),
}));
/**
 * REAL production tests for the capability-token share model.
 * Drives src/lib/sharing.ts internals — the exact code the server functions run.
 */
describe("Sharing — capability token model (production sharing.ts)", () => {
  const RAW_TOKEN = "abcd1234efgh5678ijkl"; // >= 8 chars, resolver-compatible
  let capturedInsert: Record<string, unknown> | null = null;

  /** Builds a Supabase mock with per-table behavior. Tables default to "no row". */
  function makeDb(tables: Record<string, (args: { calls: { op: string; args?: unknown[] }[] }) => any>) {
    const db = {
      from: vi.fn((table: string) => {
        const calls: { op: string; args?: unknown[] }[] = [];
        const builder = tables[table]?.({ calls }) ?? {};
        if (!builder.__wrapped) {
          const passthrough: any = {};
          for (const name of ["select", "eq", "neq", "order", "limit", "update", "delete"]) {
            passthrough[name] = (...args: unknown[]) => {
              calls.push({ op: name, args });
              return passthrough;
            };
          }
          passthrough.insert = (...args: unknown[]) => {
            calls.push({ op: "insert", args });
            capturedInsert = args[0] as Record<string, unknown>;
            return Promise.resolve({ data: null, error: null });
          };
          passthrough.maybeSingle = () =>
            Promise.resolve({
              data: builder.__maybeData ?? null,
              error: builder.__maybeError ?? null,
            });
          passthrough.single = () =>
            Promise.resolve({
              data: builder.__singleData ?? builder.__maybeData ?? null,
              error: builder.__singleError ?? null,
            });
          Object.assign(builder, passthrough);
          builder.__calls = calls;
          builder.__wrapped = true;
        }
        return builder;
      }),
    };
    return db as any;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedInsert = null;
    process.env["S3_ACCESS_KEY_ID"] = "mock-s3-key";
    process.env["S3_SECRET_ACCESS_KEY"] = "mock-s3-secret";
    process.env["S3_ENDPOINT"] = "https://s3.mock.pikamc.vn";
    process.env["S3_REGION"] = "auto";
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
    } as any);
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue({} as any);
  });

  describe("createShareLinkInternal", () => {
    it("a GUEST may mint a link for PUBLIC content and stores ONLY a hash", async () => {
      const db = makeDb({
        tracks: () => {
          const b: any = {};
          b.__maybeData = { id: "t1", visibility: "public" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

      const res = await createShareLinkInternal(
        { resourceType: "track", resourceId: "t1" },
        { userId: null, role: null },
      );

      expect(res.path).toBe(`/s/${res.token}`);
      expect(capturedInsert).not.toBeNull();
      expect(capturedInsert!["created_by"]).toBeNull();
      expect(capturedInsert!["token"]).toBeUndefined();
      expect(typeof capturedInsert!["token_hash"]).toBe("string");
      expect(capturedInsert!["token_hash"] as string).toMatch(/^[0-9a-f]{64}$/);
    });

    it("a GUEST is refused when minting a link for members-only content", async () => {
      const db = makeDb({
        tracks: () => {
          const b: any = {};
          b.__maybeData = { id: "t1", visibility: "members" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

      await expect(
        createShareLinkInternal({ resourceType: "track", resourceId: "t1" }, { userId: null, role: null }),
      ).rejects.toThrow(/chưa được công khai/);
    });

    it("an OWNER may mint a link for owner-visibility content", async () => {
      const db = makeDb({
        tracks: () => {
          const b: any = {};
          b.__maybeData = { id: "t1", visibility: "owner" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

      await expect(
        createShareLinkInternal({ resourceType: "track", resourceId: "t1" }, { userId: "owner-1", role: "owner" }),
      ).resolves.toBeDefined();
    });

    it("a MEMBER may share their OWN private playlist but not someone else's", async () => {
      const ownPlaylistDb = makeDb({
        playlists: () => {
          const b: any = {};
          b.__maybeData = { id: "p1", user_id: "member-1", is_public: false };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(ownPlaylistDb);
      await expect(
        createShareLinkInternal({ resourceType: "playlist", resourceId: "p1" }, { userId: "member-1", role: "member" }),
      ).resolves.toBeDefined();

      const otherPlaylistDb = makeDb({
        playlists: () => {
          const b: any = {};
          b.__maybeData = { id: "p2", user_id: "someone-else", is_public: false };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(otherPlaylistDb);
      await expect(
        createShareLinkInternal({ resourceType: "playlist", resourceId: "p2" }, { userId: "member-1", role: "member" }),
      ).rejects.toThrow(/không tồn tại|công khai/i);
    });

    it("anonymous playlist sharing is rejected outright", async () => {
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(makeDb({}) as any);
      await expect(
        createShareLinkInternal({ resourceType: "playlist", resourceId: "p1" }, { userId: null, role: null }),
      ).rejects.toThrow(); // Response-style 401 gate
    });
  });

  describe("resolveShareLinkInternal", () => {
    function shareRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: "share-1",
        token_hash: "x",
        resource_type: "track",
        resource_id: "t1",
        created_by: null,
        expires_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
        ...overrides,
      };
    }

    it("returns 404 for an unknown/revoked/expired token without distinguishing them", async () => {
      const db = makeDb({});
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

      await expect(resolveShareLinkInternal({ token: "nonexistent-token-1" })).rejects.toMatchObject({ status: 404 });

      const revokedDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow({ revoked_at: new Date().toISOString() });
          return b;
        },
        tracks: () => {
          const b: any = {};
          b.__maybeData = { id: "t1", title: "X", artist: "Y", visibility: "public", track_files: [] };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(revokedDb);
      await expect(resolveShareLinkInternal({ token: RAW_TOKEN })).rejects.toMatchObject({ status: 404 });
    });

    it("resolves a public track with short-lived signed media + artwork URLs", async () => {
      const db = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow();
          return b;
        },
        tracks: () => {
          const b: any = {};
          b.__maybeData = {
            id: "t1",
            title: "Track A",
            artist: "Artist A",
            album_id: null,
            year: 2025,
            format: "FLAC",
            bit_depth: 24,
            sample_rate: 96000,
            duration_seconds: 200,
            storage_key: "audio/t1/master.flac",
            cover_storage_key: "artwork/a1/cover.jpg",
            lyrics: [],
            visibility: "public",
            track_files: [],
          };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

      const resolved = await resolveShareLinkInternal({ token: RAW_TOKEN });
      expect(resolved.resource["title"]).toBe("Track A");
      expect(resolved.mediaUrl).toContain("audio/t1/master.flac");
      expect(resolved.artworkUrl).toContain("artwork/a1/cover.jpg");
      expect(resolved.canonicalUrl).toContain(`/s/${RAW_TOKEN}`);
    });

    it("REFUSES a non-public track when the link was minted by a non-owner", async () => {
      const memberMintedDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow({ created_by: "member-9" });
          return b;
        },
        tracks: () => {
          const b: any = {};
          b.__maybeData = {
            id: "t1",
            title: "Private Track",
            artist: "A",
            visibility: "owner",
            storage_key: "audio/t1/master.flac",
            cover_storage_key: null,
            track_files: [],
          };
          return b;
        },
        profiles: () => {
          const b: any = {};
          b.__maybeData = { role: "member" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(memberMintedDb);

      await expect(resolveShareLinkInternal({ token: RAW_TOKEN })).rejects.toMatchObject({ status: 403 });
    });

    it("ALLOWS a non-public track when the link was minted by an OWNER (capability model)", async () => {
      const ownerMintedDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow({ created_by: "owner-1" });
          return b;
        },
        tracks: () => {
          const b: any = {};
          b.__maybeData = {
            id: "t1",
            title: "Curated Private Track",
            artist: "A",
            visibility: "members",
            storage_key: "audio/t1/master.flac",
            cover_storage_key: null,
            track_files: [],
          };
          return b;
        },
        profiles: () => {
          const b: any = {};
          b.__maybeData = { role: "owner" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(ownerMintedDb);

      const resolved = await resolveShareLinkInternal({ token: RAW_TOKEN });
      expect(resolved.resource["visibility"]).toBe("members");
    });

    it("allows a PRIVATE PLAYLIST only when the creator owns that playlist", async () => {
      const ownPlaylistDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow({ resource_type: "playlist", resource_id: "p1", created_by: "creator-1" });
          return b;
        },
        playlists: () => {
          const b: any = {};
          b.__maybeData = { id: "p1", name: "My Mix", is_public: false, user_id: "creator-1", playlist_tracks: [] };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(ownPlaylistDb);
      const ok = await resolveShareLinkInternal({ token: RAW_TOKEN });
      expect(ok.resource["name"]).toBe("My Mix");

      const strangerDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = shareRow({ resource_type: "playlist", resource_id: "p2", created_by: "stranger-9" });
          return b;
        },
        playlists: () => {
          const b: any = {};
          b.__maybeData = { id: "p2", name: "Not Yours", is_public: false, user_id: "real-owner", playlist_tracks: [] };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(strangerDb);
      await expect(resolveShareLinkInternal({ token: RAW_TOKEN })).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("revokeShareLinkInternal", () => {
    it("creator can revoke their own link; strangers cannot", async () => {
      const creatorDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = { id: "share-1", created_by: "member-1" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(creatorDb);
      await expect(
        revokeShareLinkInternal({ token: RAW_TOKEN }, { userId: "member-1", role: "member" }),
      ).resolves.toEqual({ success: true, token: RAW_TOKEN });

      const strangerDb = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = { id: "share-1", created_by: "someone-else" };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(strangerDb);
      await expect(
        revokeShareLinkInternal({ token: RAW_TOKEN }, { userId: "member-1", role: "member" }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("owner can revoke anyone's link", async () => {
      const db = makeDb({
        share_links: () => {
          const b: any = {};
          b.__maybeData = { id: "share-1", created_by: null };
          return b;
        },
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
      await expect(
        revokeShareLinkInternal({ token: RAW_TOKEN }, { userId: "owner-1", role: "owner" }),
      ).resolves.toEqual({ success: true, token: RAW_TOKEN });
    });
  });
});
