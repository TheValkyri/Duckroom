import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  displayNameSchema,
  friendCodeSchema,
  generateFriendCode,
  generateTemporaryHandle,
  handleSchema,
  isValidFriendCode,
  isValidHandle,
  normalizeFriendCode,
  normalizeHandle,
  updateProfileSchema,
} from "../lib/social/social-types";
import {
  getMyProfileInternal,
  requestAvatarUploadUrlInternal,
  resolveAvatarUrlInternal,
  updateMyProfileInternal,
} from "../lib/social/social-profile.server";
import * as supabaseModule from "../lib/supabase";
import * as s3FunctionsModule from "../lib/s3-functions";

// Mock S3 presigner
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn((_client, command: any, _options) => {
    const key = command.input?.Key || "unknown";
    return Promise.resolve(`https://s3.pikamc.vn/mock-bucket/${key}?signed=true`);
  }),
}));

describe("Social Profile Validation & Normalization (social-types.ts)", () => {
  describe("Handle normalization & format validation", () => {
    it("strips leading @, trims whitespace, and converts to lowercase", () => {
      expect(normalizeHandle("  @DuckMaster  ")).toBe("duckmaster");
      expect(normalizeHandle("@@Cool_Duck.99")).toBe("cool_duck.99");
      expect(normalizeHandle("USER_NAME")).toBe("user_name");
      expect(normalizeHandle("")).toBe("");
    });

    it("validates handle format (3-24 chars, a-z, 0-9, _, .)", () => {
      expect(isValidHandle("duck")).toBe(true);
      expect(isValidHandle("@duck_99")).toBe(true);
      expect(isValidHandle("alex.doe")).toBe(true);
      expect(isValidHandle("a_b.c-123")).toBe(false); // dash not permitted
      expect(isValidHandle("ab")).toBe(false); // too short
      expect(isValidHandle("a".repeat(25))).toBe(false); // too long
      expect(isValidHandle("duck user")).toBe(false); // space not permitted
      expect(isValidHandle("duck/admin")).toBe(false); // path separator not permitted
      expect(isValidHandle("duck!@#")).toBe(false);
    });

    it("handleSchema parses and normalizes valid handles", () => {
      expect(handleSchema.parse("@SuperDuck")).toBe("superduck");
      expect(handleSchema.parse("  duck_01  ")).toBe("duck_01");
      expect(() => handleSchema.parse("no")).toThrow(/ít nhất 3 ký tự/);
      expect(() => handleSchema.parse("invalid handle with spaces")).toThrow();
    });
  });

  describe("Friend code normalization, validation & generation", () => {
    it("normalizes friend code to uppercase and trims whitespace", () => {
      expect(normalizeFriendCode("  duck-abcd-1234  ")).toBe("DUCK-ABCD-1234");
      expect(normalizeFriendCode("duck-7x9q-2km4")).toBe("DUCK-7X9Q-2KM4");
    });

    it("validates DUCK-XXXX-XXXX uppercase alphanumeric format", () => {
      expect(isValidFriendCode("DUCK-ABCD-1234")).toBe(true);
      expect(isValidFriendCode("duck-abcd-1234")).toBe(true); // normalizes before test
      expect(isValidFriendCode("DUCK-1234-5678")).toBe(true);
      expect(isValidFriendCode("DUCK-ABCD")).toBe(false);
      expect(isValidFriendCode("USER-ABCD-1234")).toBe(false);
      expect(isValidFriendCode("DUCK-ABCDE-1234")).toBe(false);
      expect(isValidFriendCode("DUCK-ABCD-12345")).toBe(false);
      expect(isValidFriendCode("DUCK-AB_D-1234")).toBe(false);
    });

    it("generateFriendCode generates unique, valid codes", () => {
      const code1 = generateFriendCode();
      const code2 = generateFriendCode();
      expect(isValidFriendCode(code1)).toBe(true);
      expect(isValidFriendCode(code2)).toBe(true);
      expect(code1).not.toBe(code2);
      expect(code1).toMatch(/^DUCK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it("generateTemporaryHandle produces valid temporary handles", () => {
      const h1 = generateTemporaryHandle();
      const h2 = generateTemporaryHandle();
      expect(isValidHandle(h1)).toBe(true);
      expect(isValidHandle(h2)).toBe(true);
      expect(h1.startsWith("duck_")).toBe(true);
      expect(h1).not.toBe(h2);
    });

    it("friendCodeSchema parses and normalizes friend codes", () => {
      expect(friendCodeSchema.parse("duck-a7m4-2kqx")).toBe("DUCK-A7M4-2KQX");
      expect(() => friendCodeSchema.parse("invalid-code")).toThrow(/DUCK-XXXX-XXXX/);
    });
  });

  describe("Display name & updateProfileSchema", () => {
    it("validates display name bounds", () => {
      expect(displayNameSchema.parse("Vịt Vàng")).toBe("Vịt Vàng");
      expect(() => displayNameSchema.parse("   ")).toThrow(/không được để trống/);
      expect(() => displayNameSchema.parse("a".repeat(51))).toThrow(/tối đa 50 ký tự/);
    });

    it("updateProfileSchema validates partial profile inputs and privacy enums", () => {
      const parsed = updateProfileSchema.parse({
        displayName: "New Name",
        handle: "@new_handle",
        presenceVisibility: "none",
        listeningVisibility: "friends",
      });
      expect(parsed.displayName).toBe("New Name");
      expect(parsed.handle).toBe("new_handle");
      expect(parsed.presenceVisibility).toBe("none");
      expect(parsed.listeningVisibility).toBe("friends");

      expect(() =>
        updateProfileSchema.parse({
          presenceVisibility: "invalid_privacy" as any,
        }),
      ).toThrow();
    });
  });
});

describe("Social Profile Server Domain Functions (social-profile.server.ts)", () => {
  const USER_ID = "11111111-2222-3333-4444-555555555555";

  function createMockDb(initialRows: { profiles?: any[] } = {}) {
    const profiles = [...(initialRows.profiles || [])];
    const queries: { op: string; table: string; payload?: any; filter?: any }[] = [];

    const db: any = {
      from: (table: string) => {
        const eqFilter: Record<string, any> = {};
        const neqFilter: Record<string, any> = {};

        const queryBuilder: any = {
          select: () => {
            return queryBuilder;
          },
          eq: (col: string, val: any) => {
            eqFilter[col] = val;
            return queryBuilder;
          },
          neq: (col: string, val: any) => {
            neqFilter[col] = val;
            return queryBuilder;
          },
          insert: (data: any) => {
            const row = Array.isArray(data) ? data[0] : data;
            profiles.push(row);
            queries.push({ op: "insert", table, payload: row });
            return {
              select: () => ({
                single: () => Promise.resolve({ data: row, error: null }),
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              }),
            };
          },
          update: (data: any) => {
            return {
              eq: (col: string, val: any) => {
                queries.push({ op: "update", table, payload: data, filter: { [col]: val } });
                const target = profiles.find((p) => p[col] === val);
                if (target) {
                  Object.assign(target, data);
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          maybeSingle: () => {
            queries.push({ op: "maybeSingle", table, filter: { eqFilter, neqFilter } });
            const matches = profiles.filter((p) => {
              for (const [col, val] of Object.entries(eqFilter)) {
                if (p[col] !== val) return false;
              }
              for (const [col, val] of Object.entries(neqFilter)) {
                if (p[col] === val) return false;
              }
              return true;
            });
            return Promise.resolve({ data: matches[0] || null, error: null });
          },
          single: () => {
            const matches = profiles.filter((p) => {
              for (const [col, val] of Object.entries(eqFilter)) {
                if (p[col] !== val) return false;
              }
              return true;
            });
            return Promise.resolve({ data: matches[0] || null, error: null });
          },
        };
        return queryBuilder;
      },
      auth: {
        admin: {
          getUserById: vi.fn((uid: string) => Promise.resolve({ data: { user: { email: "test@duckroom.test" } } })),
        },
      },
    };

    return { db, profiles, queries };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // Default S3 client mock
    vi.spyOn(s3FunctionsModule, "getS3ServerClient").mockReturnValue({} as any);
  });

  describe("getMyProfileInternal", () => {
    it("fails closed when userId is empty", async () => {
      await expect(getMyProfileInternal("")).rejects.toThrow(/User ID is required/);
    });

    it("returns fully resolved profile with defaults for existing row", async () => {
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "duck@duckroom.test",
            role: "member",
            display_name: "Duck Boss",
            handle: "duck_boss",
            friend_code: "DUCK-1234-5678",
            avatar_storage_key: "artwork/avatars/user-avatar.jpg",
            presence_visibility: "friends",
            listening_visibility: "friends",
            created_at: "2026-09-01T00:00:00Z",
            updated_at: "2026-09-01T00:00:00Z",
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      const profile = await getMyProfileInternal(USER_ID);
      expect(profile.userId).toBe(USER_ID);
      expect(profile.displayName).toBe("Duck Boss");
      expect(profile.handle).toBe("duck_boss");
      expect(profile.friendCode).toBe("DUCK-1234-5678");
      expect(profile.presenceVisibility).toBe("friends");
      expect(profile.listeningVisibility).toBe("friends");
      expect(profile.avatarUrl).toContain("https://s3.pikamc.vn/mock-bucket/artwork/avatars/user-avatar.jpg");
    });

    it("self-heals missing handle and friend_code on existing legacy profile", async () => {
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "legacy@duckroom.test",
            role: "member",
            display_name: "Legacy Member",
            handle: null,
            friend_code: null,
            avatar_storage_key: null,
            presence_visibility: null,
            listening_visibility: null,
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      const profile = await getMyProfileInternal(USER_ID);
      expect(profile.handle).toMatch(/^duck_[a-z0-9]{6}$/);
      expect(profile.friendCode).toMatch(/^DUCK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(profile.avatarUrl).toBeNull();
      expect(profile.presenceVisibility).toBe("friends");
      expect(profile.listeningVisibility).toBe("friends");

      // Verify DB was patched with the generated values
      const patchCall = mock.queries.find((q) => q.op === "update");
      expect(patchCall).toBeDefined();
      expect(patchCall?.payload.handle).toBe(profile.handle);
      expect(patchCall?.payload.friend_code).toBe(profile.friendCode);
    });

    it("auto-creates a profile row if user has none", async () => {
      const mock = createMockDb({ profiles: [] });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      const profile = await getMyProfileInternal(USER_ID);
      expect(profile.userId).toBe(USER_ID);
      expect(profile.handle).toMatch(/^duck_/);
      expect(profile.friendCode).toMatch(/^DUCK-/);
      expect(mock.profiles.length).toBe(1);
    });
  });

  describe("updateMyProfileInternal", () => {
    it("updates display_name, handle and privacy settings cleanly", async () => {
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "user@duckroom.test",
            display_name: "Old Name",
            handle: "old_handle",
            friend_code: "DUCK-1111-2222",
            avatar_storage_key: null,
            presence_visibility: "friends",
            listening_visibility: "friends",
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      const updated = await updateMyProfileInternal(USER_ID, {
        displayName: "Brand New Name",
        handle: "@brand_new_handle",
        presenceVisibility: "none",
        listeningVisibility: "none",
      });

      expect(updated.displayName).toBe("Brand New Name");
      expect(updated.handle).toBe("brand_new_handle");
      expect(updated.presenceVisibility).toBe("none");
      expect(updated.listeningVisibility).toBe("none");
    });

    it("strictly blocks handle collision if another user already claimed the handle", async () => {
      const OTHER_USER = "99999999-9999-9999-9999-999999999999";
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "user1@duckroom.test",
            handle: "user_one",
            friend_code: "DUCK-1111-1111",
          },
          {
            user_id: OTHER_USER,
            email: "user2@duckroom.test",
            handle: "taken_handle",
            friend_code: "DUCK-2222-2222",
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      await expect(
        updateMyProfileInternal(USER_ID, {
          handle: "@taken_handle",
        }),
      ).rejects.toThrow(/Handle này đã có người sử dụng/);
    });

    it("allows updating profile without changing handle without collision error", async () => {
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "user@duckroom.test",
            handle: "my_handle",
            display_name: "Initial Name",
            friend_code: "DUCK-1111-2222",
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      const updated = await updateMyProfileInternal(USER_ID, {
        displayName: "Updated Name Only",
        handle: "my_handle",
      });
      expect(updated.displayName).toBe("Updated Name Only");
      expect(updated.handle).toBe("my_handle");
    });

    it("rejects invalid avatar storage keys (path traversal or non-visual namespaces)", async () => {
      const mock = createMockDb({
        profiles: [
          {
            user_id: USER_ID,
            email: "user@duckroom.test",
            handle: "my_handle",
            friend_code: "DUCK-1111-2222",
          },
        ],
      });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mock.db as any);

      // Path traversal
      await expect(
        updateMyProfileInternal(USER_ID, {
          avatarStorageKey: "../secrets/key.json",
        }),
      ).rejects.toThrow(/Path traversal/);

      // Non-visual namespace (audio master)
      await expect(
        updateMyProfileInternal(USER_ID, {
          avatarStorageKey: "audio/track-123/master.flac",
        }),
      ).rejects.toThrow(/not in an authorized visual asset namespace/);
    });
  });

  describe("requestAvatarUploadUrlInternal & resolveAvatarUrlInternal", () => {
    it("generates presigned PUT URL under canonical artwork/avatars/ prefix", async () => {
      const res = await requestAvatarUploadUrlInternal(USER_ID, "png", "image/png");
      expect(res.storageKey).toMatch(new RegExp(`^artwork/avatars/${USER_ID}-\\d+-[a-f0-9]{8}\\.png$`));
      expect(res.uploadUrl).toContain(res.storageKey);
    });

    it("rejects non-image extensions or disallowed MIME types", async () => {
      await expect(requestAvatarUploadUrlInternal(USER_ID, "exe", "application/x-msdownload")).rejects.toThrow(
        /không được hỗ trợ cho ảnh đại diện/,
      );
      await expect(requestAvatarUploadUrlInternal(USER_ID, "flac", "audio/flac")).rejects.toThrow(
        /không được hỗ trợ cho ảnh đại diện/,
      );
      await expect(requestAvatarUploadUrlInternal(USER_ID, "png", "text/plain")).rejects.toThrow(
        /Content-Type phải là định dạng hình ảnh hợp lệ/,
      );
    });

    it("resolves valid avatar signed URL and fails safely on invalid key", async () => {
      const url = await resolveAvatarUrlInternal("artwork/avatars/user-123.webp");
      expect(url).toContain("artwork/avatars/user-123.webp");

      // Invalid / empty key returns null safely without throwing
      expect(await resolveAvatarUrlInternal(null)).toBeNull();
      expect(await resolveAvatarUrlInternal("")).toBeNull();
      expect(await resolveAvatarUrlInternal("   ")).toBeNull();
      expect(await resolveAvatarUrlInternal("audio/track.flac")).toBeNull();
    });
  });
});
