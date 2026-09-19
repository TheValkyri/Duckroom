import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateRelationship,
  friendActionSchema,
  friendSearchQuerySchema,
  getCanonicalPair,
  sendFriendRequestSchema,
} from "../lib/social/social-types";
import {
  acceptFriendRequestInternal,
  blockUserInternal,
  cancelFriendRequestInternal,
  findUsersInternal,
  listBlockedUsersInternal,
  listFriendsInternal,
  listIncomingRequestsInternal,
  listOutgoingRequestsInternal,
  rejectFriendRequestInternal,
  removeFriendInternal,
  sendFriendRequestInternal,
  unblockUserInternal,
} from "../lib/social/social-friendships.server";
import * as supabaseModule from "../lib/supabase";
import * as socialProfileServerModule from "../lib/social/social-profile.server";

describe("Social Friendships — Domain Logic & Canonical Relationship Model (Phase 2)", () => {
  describe("1. Canonical Pair Ordering (getCanonicalPair)", () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "99999999-9999-4999-8999-999999999999";

    it("orders pair such that userLowId < userHighId when passed (A, B)", () => {
      const pair = getCanonicalPair(userA, userB);
      expect(pair.userLowId).toBe(userA);
      expect(pair.userHighId).toBe(userB);
      expect(pair.isFirst).toBe(true);
    });

    it("orders pair identically such that userLowId < userHighId when passed (B, A)", () => {
      const pair = getCanonicalPair(userB, userA);
      expect(pair.userLowId).toBe(userA);
      expect(pair.userHighId).toBe(userB);
      expect(pair.isFirst).toBe(false);
    });

    it("prevents self-friending by throwing when userIdA === userIdB", () => {
      expect(() => getCanonicalPair(userA, userA)).toThrow("Cannot form a relationship with yourself");
    });

    it("rejects empty or whitespace user IDs", () => {
      expect(() => getCanonicalPair("", userB)).toThrow("User IDs must not be empty");
      expect(() => getCanonicalPair(userA, "   ")).toThrow("User IDs must not be empty");
    });
  });

  describe("2. Relationship Evaluation (evaluateRelationship)", () => {
    const userLow = "11111111-1111-4111-8111-111111111111";
    const userHigh = "99999999-9999-4999-8999-999999999999";

    it("returns 'self' when currentUserId === targetUserId", () => {
      expect(evaluateRelationship(userLow, userLow, null)).toBe("self");
    });

    it("returns 'none' when no relationship row exists", () => {
      expect(evaluateRelationship(userLow, userHigh, null)).toBe("none");
      expect(evaluateRelationship(userLow, userHigh, undefined)).toBe("none");
    });

    it("returns 'accepted' for mutual friendship regardless of perspective", () => {
      const row = { status: "accepted", user_low_id: userLow, user_high_id: userHigh };
      expect(evaluateRelationship(userLow, userHigh, row)).toBe("accepted");
      expect(evaluateRelationship(userHigh, userLow, row)).toBe("accepted");
    });

    it("correctly evaluates pending_first_to_second (low -> high)", () => {
      const row = { status: "pending_first_to_second", user_low_id: userLow, user_high_id: userHigh };
      // Low initiated -> sender
      expect(evaluateRelationship(userLow, userHigh, row)).toBe("pending_sent");
      // High received -> recipient
      expect(evaluateRelationship(userHigh, userLow, row)).toBe("pending_received");
    });

    it("correctly evaluates pending_second_to_first (high -> low)", () => {
      const row = { status: "pending_second_to_first", user_low_id: userLow, user_high_id: userHigh };
      // High initiated -> sender
      expect(evaluateRelationship(userHigh, userLow, row)).toBe("pending_sent");
      // Low received -> recipient
      expect(evaluateRelationship(userLow, userHigh, row)).toBe("pending_received");
    });

    it("correctly evaluates block semantics", () => {
      const lowBlocksHigh = { status: "blocked_first_to_second", user_low_id: userLow, user_high_id: userHigh };
      expect(evaluateRelationship(userLow, userHigh, lowBlocksHigh)).toBe("blocked_by_me");
      expect(evaluateRelationship(userHigh, userLow, lowBlocksHigh)).toBe("blocked_by_them");

      const highBlocksLow = { status: "blocked_second_to_first", user_low_id: userLow, user_high_id: userHigh };
      expect(evaluateRelationship(userHigh, userLow, highBlocksLow)).toBe("blocked_by_me");
      expect(evaluateRelationship(userLow, userHigh, highBlocksLow)).toBe("blocked_by_them");

      const mutualBlock = { status: "blocked_both", user_low_id: userLow, user_high_id: userHigh };
      expect(evaluateRelationship(userLow, userHigh, mutualBlock)).toBe("blocked_by_me");
      expect(evaluateRelationship(userHigh, userLow, mutualBlock)).toBe("blocked_by_me");
    });
  });

  describe("3. Zod Schemas Validation", () => {
    it("validates friendSearchQuerySchema", () => {
      expect(friendSearchQuerySchema.parse({ query: " @duck " })).toEqual({ query: "@duck" });
      expect(() => friendSearchQuerySchema.parse({ query: "   " })).toThrow();
    });

    it("validates sendFriendRequestSchema requiring targetUserId or targetHandleOrCode", () => {
      expect(sendFriendRequestSchema.parse({ targetUserId: "uuid-123" })).toEqual({ targetUserId: "uuid-123" });
      expect(sendFriendRequestSchema.parse({ targetHandleOrCode: "DUCK-1234-5678" })).toEqual({
        targetHandleOrCode: "DUCK-1234-5678",
      });
      expect(() => sendFriendRequestSchema.parse({})).toThrow(/chỉ định người dùng/);
    });

    it("validates friendActionSchema requiring targetUserId", () => {
      expect(friendActionSchema.parse({ targetUserId: "user-1" })).toEqual({ targetUserId: "user-1" });
      expect(() => friendActionSchema.parse({ targetUserId: "" })).toThrow();
    });
  });

  describe("4. Database Operations & Invariants (Mocked Supabase)", () => {
    const aliceId = "11111111-1111-4111-8111-111111111111"; // low ID
    const bobId = "99999999-9999-4999-8999-999999999999"; // high ID

    let mockFriendshipsTable: any[];
    let mockProfilesTable: any[];

    beforeEach(() => {
      mockFriendshipsTable = [];
      mockProfilesTable = [
        {
          user_id: aliceId,
          handle: "alice",
          display_name: "Alice Duck",
          friend_code: "DUCK-AAAA-1111",
          avatar_storage_key: null,
        },
        {
          user_id: bobId,
          handle: "bob",
          display_name: "Bob Duck",
          friend_code: "DUCK-BBBB-2222",
          avatar_storage_key: null,
        },
      ];

      vi.spyOn(socialProfileServerModule, "resolveAvatarUrlInternal").mockImplementation(async () => null);

      const mockDb = {
        from: vi.fn((tableName: string) => {
          if (tableName === "profiles") {
            return {
              select: vi.fn((fields: string) => ({
                eq: vi.fn((col: string, val: any) => ({
                  maybeSingle: vi.fn(async () => ({
                    data: mockProfilesTable.find((p) => p[col] === val) || null,
                    error: null,
                  })),
                  neq: vi.fn((ncol: string, nval: any) => ({
                    maybeSingle: vi.fn(async () => ({
                      data: mockProfilesTable.find((p) => p[col] === val && p[ncol] !== nval) || null,
                      error: null,
                    })),
                  })),
                })),
                ilike: vi.fn((col: string, pattern: string) => {
                  const rawPat = pattern.replace(/[%_\\]/g, "").toLowerCase();
                  return {
                    limit: vi.fn(async (n: number) => {
                      const filtered = mockProfilesTable
                        .filter((p) => p[col]?.toLowerCase().includes(rawPat))
                        .slice(0, n);
                      return { data: filtered, error: null };
                    }),
                    maybeSingle: vi.fn(async () => {
                      const match = mockProfilesTable.find((p) => p[col]?.toLowerCase() === rawPat);
                      return { data: match || null, error: null };
                    }),
                  };
                }),
                in: vi.fn((col: string, vals: any[]) => {
                  const filtered = mockProfilesTable.filter((p) => vals.includes(p[col]));
                  return Promise.resolve({ data: filtered, error: null });
                }),
              })),
            };
          }

          if (tableName === "friendships") {
            return {
              select: vi.fn((fields: string) => ({
                eq: vi.fn((col: string, val: any) => ({
                  eq: vi.fn((col2: string, val2: any) => ({
                    maybeSingle: vi.fn(async () => {
                      const found = mockFriendshipsTable.find((f) => f[col] === val && f[col2] === val2);
                      return { data: found ? { ...found } : null, error: null };
                    }),
                  })),
                  or: vi.fn((orClause: string) => {
                    const matches = orClause.match(/user_low_id\.eq\.([^,]+),user_high_id\.eq\.(.+)/);
                    const uId = matches ? matches[1] : null;
                    const filtered = mockFriendshipsTable.filter(
                      (f) => f[col] === val && (f.user_low_id === uId || f.user_high_id === uId),
                    );
                    return Promise.resolve({ data: filtered, error: null });
                  }),
                })),
                or: vi.fn((clause: string) => {
                  const matches = clause.match(/user_low_id\.eq\.([^,]+),user_high_id\.eq\.(.+)/);
                  const uId = matches ? matches[1] : null;
                  const byUser = mockFriendshipsTable.filter((f) => f.user_low_id === uId || f.user_high_id === uId);
                  return {
                    in: vi.fn((col: string, vals: any[]) => ({
                      order: vi.fn((orderCol: string, opts?: any) => {
                        const filtered = byUser.filter((f) => vals.includes(f[col]));
                        return Promise.resolve({ data: [...filtered], error: null });
                      }),
                    })),
                  };
                }),
              })),
              insert: vi.fn(async (payload: any) => {
                const inserted = { id: `fs-${Date.now()}-${Math.random()}`, ...payload };
                mockFriendshipsTable.push(inserted);
                return { data: inserted, error: null };
              }),
              update: vi.fn((patch: any) => ({
                eq: vi.fn(async (col: string, val: any) => {
                  const item = mockFriendshipsTable.find((f) => f[col] === val);
                  if (item) Object.assign(item, patch);
                  return { data: item, error: null };
                }),
              })),
              delete: vi.fn(() => ({
                eq: vi.fn((col: string, val: any) => ({
                  eq: vi.fn((col2: string, val2: any) => ({
                    eq: vi.fn(async (col3: string, val3: any) => {
                      mockFriendshipsTable = mockFriendshipsTable.filter(
                        (f) => !(f[col] === val && f[col2] === val2 && f[col3] === val3),
                      );
                      return { error: null };
                    }),
                  })),
                  then: (resolve: any) => {
                    mockFriendshipsTable = mockFriendshipsTable.filter((f) => f[col] !== val);
                    return Promise.resolve({ error: null }).then(resolve);
                  },
                })),
              })),
            };
          }

          throw new Error(`Unexpected table: ${tableName}`);
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);
    });

    it("prevents self-friending in sendFriendRequestInternal", async () => {
      await expect(sendFriendRequestInternal(aliceId, { targetUserId: aliceId })).rejects.toThrow(
        "Không thể tự kết bạn với chính mình",
      );
    });

    it("sends a new friend request from Alice (low) to Bob (high)", async () => {
      const res = await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      expect(res.success).toBe(true);
      expect(res.status).toBe("pending_sent");
      expect(mockFriendshipsTable).toHaveLength(1);
      expect(mockFriendshipsTable[0].user_low_id).toBe(aliceId);
      expect(mockFriendshipsTable[0].user_high_id).toBe(bobId);
      expect(mockFriendshipsTable[0].status).toBe("pending_first_to_second");
      expect(mockFriendshipsTable[0].action_user_id).toBe(aliceId);
    });

    it("sends a new friend request from Bob (high) to Alice (low)", async () => {
      const res = await sendFriendRequestInternal(bobId, { targetUserId: aliceId });
      expect(res.success).toBe(true);
      expect(res.status).toBe("pending_sent");
      expect(mockFriendshipsTable).toHaveLength(1);
      expect(mockFriendshipsTable[0].user_low_id).toBe(aliceId);
      expect(mockFriendshipsTable[0].user_high_id).toBe(bobId);
      expect(mockFriendshipsTable[0].status).toBe("pending_second_to_first");
      expect(mockFriendshipsTable[0].action_user_id).toBe(bobId);
    });

    it("duplicate pending requests are idempotent", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      const dup = await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      expect(dup.status).toBe("pending_sent");
      expect(mockFriendshipsTable).toHaveLength(1);
    });

    it("mutual pending requests collapse into accepted status automatically", async () => {
      // Alice requests Bob
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      expect(mockFriendshipsTable[0].status).toBe("pending_first_to_second");

      // Bob also requests Alice -> mutual collapse into accepted!
      const res = await sendFriendRequestInternal(bobId, { targetUserId: aliceId });
      expect(res.status).toBe("accepted");
      expect(mockFriendshipsTable[0].status).toBe("accepted");
      expect(mockFriendshipsTable[0].action_user_id).toBe(bobId);
    });

    it("Bob accepts Alice's friend request", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });

      const res = await acceptFriendRequestInternal(bobId, aliceId);
      expect(res.success).toBe(true);
      expect(mockFriendshipsTable[0].status).toBe("accepted");
      expect(mockFriendshipsTable[0].action_user_id).toBe(bobId);
    });

    it("Alice cannot accept her own outgoing request", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });

      await expect(acceptFriendRequestInternal(aliceId, bobId)).rejects.toThrow(
        "Bạn không thể tự chấp nhận lời mời do chính mình gửi",
      );
    });

    it("Bob rejects Alice's incoming friend request (deletes relationship)", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      expect(mockFriendshipsTable).toHaveLength(1);

      const res = await rejectFriendRequestInternal(bobId, aliceId);
      expect(res.success).toBe(true);
      expect(mockFriendshipsTable).toHaveLength(0);
    });

    it("Alice cancels her outgoing friend request (deletes relationship)", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      expect(mockFriendshipsTable).toHaveLength(1);

      const res = await cancelFriendRequestInternal(aliceId, bobId);
      expect(res.success).toBe(true);
      expect(mockFriendshipsTable).toHaveLength(0);
    });

    it("either party can remove an active accepted friendship", async () => {
      mockFriendshipsTable.push({
        id: "fs-1",
        user_low_id: aliceId,
        user_high_id: bobId,
        status: "accepted",
        action_user_id: bobId,
      });

      const res = await removeFriendInternal(aliceId, bobId);
      expect(res.success).toBe(true);
      expect(mockFriendshipsTable).toHaveLength(0);
    });

    it("block semantics: Alice blocks Bob, preventing requests from Bob", async () => {
      const blockRes = await blockUserInternal(aliceId, bobId);
      expect(blockRes.success).toBe(true);
      expect(mockFriendshipsTable[0].status).toBe("blocked_first_to_second");

      // Bob cannot send request to Alice
      await expect(sendFriendRequestInternal(bobId, { targetUserId: aliceId })).rejects.toThrow(
        "Không thể gửi lời mời kết bạn đến người dùng này",
      );

      // Alice must unblock before sending request
      await expect(sendFriendRequestInternal(aliceId, { targetUserId: bobId })).rejects.toThrow(
        "Bạn đang chặn người dùng này. Vui lòng bỏ chặn trước",
      );
    });

    it("mutual blocking transitions to blocked_both, and unblocking leaves single block", async () => {
      // Alice blocks Bob
      await blockUserInternal(aliceId, bobId);
      expect(mockFriendshipsTable[0].status).toBe("blocked_first_to_second");

      // Bob also blocks Alice
      await blockUserInternal(bobId, aliceId);
      expect(mockFriendshipsTable[0].status).toBe("blocked_both");

      // Alice unblocks Bob -> Bob still blocks Alice
      await unblockUserInternal(aliceId, bobId);
      expect(mockFriendshipsTable[0].status).toBe("blocked_second_to_first");

      // Bob unblocks Alice -> completely deleted
      await unblockUserInternal(bobId, aliceId);
      expect(mockFriendshipsTable).toHaveLength(0);
    });

    it("findUsersInternal filters out users who blocked the searcher", async () => {
      // Bob blocks Alice
      mockFriendshipsTable.push({
        id: "fs-block",
        user_low_id: aliceId,
        user_high_id: bobId,
        status: "blocked_second_to_first",
        action_user_id: bobId,
      });

      // Alice searches for Bob
      const results = await findUsersInternal(aliceId, "bob");
      // Bob should NOT be returned in Alice's search results because Bob blocked Alice
      expect(results).toHaveLength(0);
    });

    it("findUsersInternal marks self relationship when search query matches current user", async () => {
      const results = await findUsersInternal(aliceId, "alice");
      expect(results).toHaveLength(1);
      expect(results[0]!.userId).toBe(aliceId);
      expect(results[0]!.relationship).toBe("self");
    });

    it("lists active friends in listFriendsInternal", async () => {
      mockFriendshipsTable.push({
        id: "fs-friends",
        user_low_id: aliceId,
        user_high_id: bobId,
        status: "accepted",
        action_user_id: bobId,
        accepted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      const aliceFriends = await listFriendsInternal(aliceId);
      expect(aliceFriends).toHaveLength(1);
      expect(aliceFriends[0]!.userId).toBe(bobId);
      expect(aliceFriends[0]!.displayName).toBe("Bob Duck");
      // Must not leak other users' friend codes
      expect(aliceFriends[0]!.friendCode).toBeUndefined();

      const bobFriends = await listFriendsInternal(bobId);
      expect(bobFriends).toHaveLength(1);
      expect(bobFriends[0]!.userId).toBe(aliceId);
      expect(bobFriends[0]!.displayName).toBe("Alice Duck");
    });

    it("lists incoming and outgoing requests correctly", async () => {
      // Alice requests Bob
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });

      // Bob's perspective: incoming request from Alice
      const bobIncoming = await listIncomingRequestsInternal(bobId);
      expect(bobIncoming).toHaveLength(1);
      expect(bobIncoming[0]!.userId).toBe(aliceId);
      expect(bobIncoming[0]!.direction).toBe("incoming");

      const bobOutgoing = await listOutgoingRequestsInternal(bobId);
      expect(bobOutgoing).toHaveLength(0);

      // Alice's perspective: outgoing request to Bob
      const aliceOutgoing = await listOutgoingRequestsInternal(aliceId);
      expect(aliceOutgoing).toHaveLength(1);
      expect(aliceOutgoing[0]!.userId).toBe(bobId);
      expect(aliceOutgoing[0]!.direction).toBe("outgoing");

      const aliceIncoming = await listIncomingRequestsInternal(aliceId);
      expect(aliceIncoming).toHaveLength(0);
    });

    it("lists blocked users for the blocker only", async () => {
      // Alice blocks Bob
      await blockUserInternal(aliceId, bobId);

      const aliceBlocked = await listBlockedUsersInternal(aliceId);
      expect(aliceBlocked).toHaveLength(1);
      expect(aliceBlocked[0]!.userId).toBe(bobId);

      // Bob has not blocked Alice, so his blocked list is empty
      const bobBlocked = await listBlockedUsersInternal(bobId);
      expect(bobBlocked).toHaveLength(0);
    });

    it("rejects friend request to nonexistent target user", async () => {
      await expect(
        sendFriendRequestInternal(aliceId, { targetUserId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toThrow("Không tìm thấy người dùng này");
    });

    it("rejects block on nonexistent target user", async () => {
      await expect(blockUserInternal(aliceId, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
        "Không tìm thấy người dùng này",
      );
    });

    it("prevents sender from calling rejectFriendRequestInternal", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      // Alice sent it, so Alice cannot reject it (she should cancel it instead)
      await expect(rejectFriendRequestInternal(aliceId, bobId)).rejects.toThrow("Không thể từ chối lời mời này");
    });

    it("prevents recipient from calling cancelFriendRequestInternal", async () => {
      await sendFriendRequestInternal(aliceId, { targetUserId: bobId });
      // Bob received it, so Bob cannot cancel it (he should reject it instead)
      await expect(cancelFriendRequestInternal(bobId, aliceId)).rejects.toThrow("Không thể huỷ lời mời này");
    });

    it("normalizes case in canonical pairing for uppercase UUIDs", () => {
      const upperAlice = aliceId.toUpperCase();
      const upperBob = bobId.toUpperCase();
      const pair = getCanonicalPair(upperAlice, upperBob);
      expect(pair.userLowId).toBe(aliceId.toLowerCase());
      expect(pair.userHighId).toBe(bobId.toLowerCase());
    });
  });
});
