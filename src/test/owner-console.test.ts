import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOwnerHealthInternal,
  getOwnerUsersInternal,
  revokeShareByIdInternal,
  scanDuplicateMastersInternal,
  setUserRoleInternal,
  updateAlbumDisplayPriorityInternal,
  verifyBackupSnapshotInternal,
} from "../lib/owner-data";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

/**
 * Phase 10 Owner Console tests (Master Plan §25).
 * Drives owner-data internals against mocked Supabase/S3 transports.
 */

/** Minimal chainable Supabase builder covering the query shapes used. */
function makeDb(tables: Record<string, any>) {
  const captured: Record<string, unknown> = {};
  const db = {
    __captured: captured,
    from: vi.fn((table: string) => {
      const spec = tables[table] ?? {};
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.not = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve({ data: spec.rows ?? null, error: spec.error ?? null });
      b.in = () => Promise.resolve({ data: spec.byIds ?? null, error: null });
      b.maybeSingle = () =>
        typeof spec.data === "undefined" && typeof spec.error === "undefined"
          ? Promise.resolve({ data: null, error: null })
          : Promise.resolve({ data: spec.data ?? null, error: spec.error ?? null });
      b.update = (row: unknown) => {
        captured[`${table}.update`] = row;
        const chain: any = {};
        chain.eq = () => Promise.resolve({ data: null, error: spec.updateError ?? null });
        return chain;
      };
      if (spec.count !== undefined) {
        // head-count queries resolve directly after select() or after .not()
        const countPromise: any = Promise.resolve({ count: spec.count, error: spec.error ?? null });
        countPromise.not = () => Promise.resolve({ count: spec.count, error: spec.error ?? null });
        b.select = () => countPromise;
      }
      b.insert = async (row: unknown) => {
        captured[`${table}.insert`] = row;
        return spec.insertError ? { data: null, error: spec.insertError } : { data: null, error: null };
      };
      return b;
    }),
  };
  return db as any;
}

function bodyFrom(text: string) {
  const bytes = Buffer.from(text, "utf-8");
  return (async function* () {
    yield new Uint8Array(bytes);
  })() as unknown as AsyncIterable<Uint8Array>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env["S3_ACCESS_KEY_ID"] = "mock-s3-key";
  process.env["S3_SECRET_ACCESS_KEY"] = "mock-s3-secret";
  process.env["S3_ENDPOINT"] = "https://s3.mock.pikamc.vn";
  process.env["S3_REGION"] = "auto";
});

describe("setUserRoleInternal", () => {
  it("blocks self role changes to prevent console lockout", async () => {
    await expect(setUserRoleInternal({ userId: "me", role: "member" }, "me")).rejects.toThrow(/tự thay đổi vai trò/);
  });

  it("rejects targets that do not exist", async () => {
    const db = makeDb({ profiles: {} });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(setUserRoleInternal({ userId: "ghost", role: "owner" }, "owner-1")).rejects.toThrow(/không tồn tại/);
  });

  it("is a no-op when the target already has the requested role", async () => {
    const db = makeDb({ profiles: { data: { user_id: "u1", role: "member" } } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await setUserRoleInternal({ userId: "u1", role: "member" }, "owner-1");
    expect(res.success).toBe(true);
    expect(db.__captured["profiles.update"]).toBeUndefined();
  });

  it("updates the role and writes an audited before/after trail", async () => {
    const db = makeDb({ profiles: { data: { user_id: "u1", role: "member" } } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await setUserRoleInternal({ userId: "u1", role: "owner" }, "owner-9");
    expect(res).toEqual({ success: true, userId: "u1", role: "owner" });
    expect(db.__captured["profiles.update"]).toEqual({ role: "owner" });
    expect(db.__captured["audit_logs.insert"]).toMatchObject({
      action: "user.role_changed",
      resource_id: "u1",
      metadata: { from: "member", to: "owner" },
    });
  });
});

describe("scanDuplicateMastersInternal — §24.4 duplicate detection", () => {
  it("groups track_files by identical sha256 across different tracks", async () => {
    const db = makeDb({
      track_files: {
        rows: [
          {
            id: "f1",
            track_id: "t1",
            sha256: "dup-hash",
            file_size_bytes: 100,
            storage_key: "audio/t1/master.flac",
            verified_at: "2026-01-01",
          },
          {
            id: "f2",
            track_id: "t2",
            sha256: "dup-hash",
            file_size_bytes: 100,
            storage_key: "audio/t2/master.flac",
            verified_at: null,
          },
          {
            id: "f3",
            track_id: "t3",
            sha256: "solo-hash",
            file_size_bytes: 5,
            storage_key: "audio/t3/master.flac",
            verified_at: null,
          },
        ],
      },
      video_files: { rows: [] },
      tracks: {
        byIds: [
          { id: "t1", title: "Song A" },
          { id: "t2", title: "Song B" },
        ],
      },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await scanDuplicateMastersInternal();
    expect(res.scannedFiles).toBe(3);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]?.sha256).toBe("dup-hash");
    expect(res.groups[0]?.items.map((i) => i.trackId)).toEqual(["t1", "t2"]);
    expect(res.groups[0]?.items[0]?.title).toBe("Song A");
  });

  it("reports zero groups on a clean library instead of fabricating duplicates", async () => {
    const db = makeDb({
      track_files: {
        rows: [{ id: "f1", track_id: "t1", sha256: "h1", file_size_bytes: 1, storage_key: "k", verified_at: null }],
      },
      video_files: { rows: [] },
      tracks: { byIds: [] },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await scanDuplicateMastersInternal();
    expect(res.groups).toHaveLength(0);
  });
});

describe("revokeShareByIdInternal", () => {
  it("revokes a live share by row-id and audits it", async () => {
    const db = makeDb({ share_links: { data: { id: "s1", revoked_at: null } } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await revokeShareByIdInternal({ shareId: "s1" }, "owner-1");
    expect(res.success).toBe(true);
    expect(String(db.__captured["share_links.update"])).toBeTruthy();
    expect(db.__captured["audit_logs.insert"]).toMatchObject({ action: "share.revoked" });
  });

  it("is idempotent for an already-revoked share (no second write)", async () => {
    const db = makeDb({ share_links: { data: { id: "s1", revoked_at: "2026-01-01T00:00:00Z" } } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await revokeShareByIdInternal({ shareId: "s1" }, "owner-1");
    expect(res.success).toBe(true);
    expect(db.__captured["share_links.update"]).toBeUndefined();
  });
});

describe("verifyBackupSnapshotInternal — §24 snapshot verification (read-only)", () => {
  function installS3(body: string | null) {
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({
      send: vi.fn(async () => {
        if (body === null) throw new Error("NoSuchKey");
        return { Body: bodyFrom(body) };
      }),
    } as any);
  }

  it("reports a missing snapshot without throwing", async () => {
    installS3(null);
    const db = makeDb({ tracks: { count: 3 }, albums: { count: 1 }, videos: { count: 0 } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await verifyBackupSnapshotInternal();
    expect(res.snapshotFound).toBe(false);
    expect(res.message).toMatch(/Chưa có snapshot/);
  });

  it("flags a corrupted snapshot as parsedOk=false with actionable message", async () => {
    installS3("{ this is not json");
    const db = makeDb({ tracks: { count: 2 }, albums: { count: 0 }, videos: { count: 0 } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await verifyBackupSnapshotInternal();
    expect(res.snapshotFound).toBe(true);
    expect(res.parsedOk).toBe(false);
    expect(res.message).toMatch(/JSON hỏng/);
  });

  it("computes DB−snapshot drift per resource kind", async () => {
    installS3(
      JSON.stringify({
        version: 2,
        createdAt: "2026-08-24T00:00:00Z",
        tracks: [1, 2],
        albums: [1],
        videos: [],
      }),
    );
    const db = makeDb({ tracks: { count: 5 }, albums: { count: 1 }, videos: { count: 2 } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await verifyBackupSnapshotInternal();
    expect(res.parsedOk).toBe(true);
    expect(res.drift).toEqual({ tracks: 3, albums: 0, videos: 2 });
    expect(res.message).toMatch(/\+3 track/);
  });

  it("declares full sync when counts match exactly", async () => {
    installS3(JSON.stringify({ version: 2, createdAt: "x", tracks: [], albums: [], videos: [] }));
    const db = makeDb({ tracks: { count: 0 }, albums: { count: 0 }, videos: { count: 0 } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await verifyBackupSnapshotInternal();
    expect(res.drift).toEqual({ tracks: 0, albums: 0, videos: 0 });
    expect(res.message).toMatch(/khớp hoàn toàn/);
  });
});

describe("updateAlbumDisplayPriorityInternal — database-driven album display priority (Phase 3.1)", () => {
  it("updates display_priority for an existing album and creates audit log", async () => {
    const db = makeDb({
      albums: { data: { id: "alb-1", display_priority: 999 } },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await updateAlbumDisplayPriorityInternal({ albumId: "alb-1", displayPriority: 1 }, "owner-user-id");

    expect(res).toEqual({ success: true, albumId: "alb-1", displayPriority: 1 });
    expect(db.__captured["albums.update"]).toMatchObject({ display_priority: 1 });
    expect(db.__captured["audit_logs.insert"]).toMatchObject({
      action: "album.priority_updated",
      resource_id: "alb-1",
      metadata: { from: 999, to: 1 },
    });
  });

  it("is a no-op if display_priority is already the same value", async () => {
    const db = makeDb({
      albums: { data: { id: "alb-1", display_priority: 2 } },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await updateAlbumDisplayPriorityInternal({ albumId: "alb-1", displayPriority: 2 }, "owner-user-id");

    expect(res).toEqual({ success: true, albumId: "alb-1", displayPriority: 2 });
    expect(db.__captured["albums.update"]).toBeUndefined();
    expect(db.__captured["audit_logs.insert"]).toBeUndefined();
  });

  it("throws error when album does not exist", async () => {
    const db = makeDb({
      albums: { data: null },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    await expect(updateAlbumDisplayPriorityInternal({ albumId: "nonexistent", displayPriority: 1 })).rejects.toThrow(
      "Album không tồn tại.",
    );
  });
});

describe("getOwnerHealthInternal & getOwnerUsersInternal — real accurate user count and sync", () => {
  it("accurately counts 7 users when 6 profiles exist but 7 auth users exist, and videos is 0", async () => {
    const authUsers = [
      { id: "u1", email: "user1@duckroom.test", user_metadata: { full_name: "User 1" } },
      { id: "u2", email: "user2@duckroom.test", user_metadata: { full_name: "User 2" } },
      { id: "u3", email: "user3@duckroom.test", user_metadata: { full_name: "User 3" } },
      { id: "u4", email: "user4@duckroom.test", user_metadata: { full_name: "User 4" } },
      { id: "u5", email: "user5@duckroom.test", user_metadata: { full_name: "User 5" } },
      { id: "u6", email: "user6@duckroom.test", user_metadata: { full_name: "User 6" } },
      {
        id: "u7-mobile",
        email: "user7.phone@gmail.com",
        user_metadata: { full_name: "Phone Google User", picture: "https://lh3.googleusercontent.com/a/phone-avatar" },
      },
    ];

    const db = makeDb({
      tracks: { count: 97 },
      albums: { count: 11 },
      videos: { count: 4 },
      profiles: {
        count: 6,
        rows: authUsers.slice(0, 6).map((u) => ({ user_id: u.id })),
      },
      playlists: { count: 2 },
      user_favorites: { count: 10 },
      playback_history: { count: 50 },
      track_files: { count: 97 },
      video_files: { count: 0 },
    });

    (db as any).auth = {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: authUsers },
          error: null,
        }),
      },
    };

    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const health = await getOwnerHealthInternal(db);
    expect(health.counts.users).toBe(7);
    expect(health.counts.videos).toBe(0);
  });

  it("merges newly registered Google mobile users into getOwnerUsersInternal even if profiles row is not yet backfilled", async () => {
    const authUsers = [
      { id: "u1", email: "user1@duckroom.test", user_metadata: { full_name: "User 1" } },
      { id: "u2", email: "user2@duckroom.test", user_metadata: { full_name: "User 2" } },
      { id: "u3", email: "user3@duckroom.test", user_metadata: { full_name: "User 3" } },
      { id: "u4", email: "user4@duckroom.test", user_metadata: { full_name: "User 4" } },
      { id: "u5", email: "user5@duckroom.test", user_metadata: { full_name: "User 5" } },
      { id: "u6", email: "user6@duckroom.test", user_metadata: { full_name: "User 6" } },
      {
        id: "u7-mobile",
        email: "user7.phone@gmail.com",
        created_at: "2026-09-28T12:00:00Z",
        last_sign_in_at: "2026-09-28T12:01:00Z",
        user_metadata: { full_name: "Phone Google User", picture: "https://lh3.googleusercontent.com/a/phone-avatar" },
      },
    ];

    const existingProfiles = authUsers.slice(0, 6).map((u, i) => ({
      user_id: u.id,
      email: u.email,
      role: i === 0 ? "owner" : "member",
      display_name: u.user_metadata.full_name,
      handle: `duck_user_${i + 1}`,
      avatar_storage_key: null,
      friend_code: `DUCK-100${i}-200${i}`,
      created_at: "2026-01-01T00:00:00Z",
    }));

    const db = makeDb({
      profiles: {
        rows: existingProfiles,
      },
    });

    (db as any).auth = {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: authUsers },
          error: null,
        }),
      },
    };

    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const { users } = await getOwnerUsersInternal(db);
    expect(users).toHaveLength(7);
    const googleUser = users.find((u) => u.user_id === "u7-mobile");
    expect(googleUser).toBeDefined();
    expect(googleUser?.email).toBe("user7.phone@gmail.com");
    expect(googleUser?.display_name).toBe("Phone Google User");
    expect(googleUser?.avatar_url).toBe("https://lh3.googleusercontent.com/a/phone-avatar");
    expect(googleUser?.last_sign_in_at).toBe("2026-09-28T12:01:00Z");
  });
});
