import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  buildPresencePayload,
  getNextRevision,
  resetRevisionForTesting,
  socialPresencePublisher,
  SocialPresencePublisher,
  SOCIAL_HEARTBEAT_INTERVAL_MS,
} from "../lib/social/social-presence";
import {
  evaluateFriendEffectiveStatus,
  formatDurationMs,
  interpolateFriendPosition,
  resolveTrackMetadata,
  shouldApplyPresenceUpdate,
  socialStore,
  SocialStore,
  STALE_HEARTBEAT_THRESHOLD_MS,
} from "../lib/social/social-store";
import type { FriendPresenceEntry, SocialListeningActivity, SocialPresencePayload } from "../lib/social/social-types";
import { getProfileInternal } from "../lib/social/social-profile.server";
import { invalidateProfileCache } from "../lib/social/profile-cache";
import * as supabaseModule from "../lib/supabase";
import * as socialProfileServerModule from "../lib/social/social-profile.server";

describe("Phase 3: Realtime Social Presence & Listening Activity", () => {
  const mockUserId = "11111111-1111-1111-1111-111111111111";
  const mockTrack = {
    id: "sample-track-1",
    albumId: "sample-album-1",
    duration: 210, // 3m30s
  };

  beforeEach(() => {
    socialStore.reset();
  });

  describe("1. Presence state transitions and payload building", () => {
    it("builds LISTENING status when leader is actively playing", () => {
      const now = 1700000000000;
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: mockTrack,
        positionMs: 45000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 1,
        nowMs: now,
      });

      expect(payload.userId).toBe(mockUserId);
      expect(payload.status).toBe("listening");
      expect(payload.trackId).toBe("sample-track-1");
      expect(payload.albumId).toBe("sample-album-1");
      expect(payload.playing).toBe(true);
      expect(payload.positionMs).toBe(45000);
      expect(payload.positionUpdatedAt).toBe(now);
      expect(payload.durationMs).toBe(210000);
      expect(payload.revision).toBe(1);
    });

    it("builds PAUSED status when leader is paused on a track", () => {
      const now = 1700000000000;
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: false,
        currentTrack: mockTrack,
        positionMs: 60000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 2,
        nowMs: now,
      });

      expect(payload.status).toBe("paused");
      expect(payload.playing).toBe(false);
      expect(payload.trackId).toBe("sample-track-1");
      expect(payload.positionMs).toBe(60000);
    });

    it("builds ONLINE status when leader has no active track", () => {
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: false,
        currentTrack: null,
        positionMs: 0,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 3,
      });

      expect(payload.status).toBe("online");
      expect(payload.trackId).toBeNull();
      expect(payload.playing).toBe(false);
    });
  });

  describe("2. Multi-tab arbitration rules (§28)", () => {
    it("forces follower tabs to report ONLINE even if audio state claims playing", () => {
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "follower",
        isPlaying: true, // Follower must not claim playback leadership
        currentTrack: mockTrack,
        positionMs: 30000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 4,
      });

      expect(payload.status).toBe("online");
      expect(payload.trackId).toBeNull();
      expect(payload.playing).toBe(false);
      expect(payload.positionMs).toBe(0);
    });

    it("forces electing tabs to report ONLINE", () => {
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "electing",
        isPlaying: true,
        currentTrack: mockTrack,
        positionMs: 30000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 5,
      });

      expect(payload.status).toBe("online");
      expect(payload.trackId).toBeNull();
    });

    it("stops heartbeat when tabRole is follower and resumes when promoted to leader (§28)", () => {
      const publisher = new SocialPresencePublisher();
      publisher.init(mockUserId);

      // Follower tab updates state -> must suppress heartbeat to avoid channel fighting
      publisher.updateState({
        userId: mockUserId,
        tabRole: "follower",
        isPlaying: false,
        currentTrack: null,
        positionMs: 0,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
      });
      expect(publisher.isHeartbeatActive()).toBe(false);

      // Promoted to leader -> starts heartbeat
      publisher.updateState({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: mockTrack,
        positionMs: 10000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
      });
      expect(publisher.isHeartbeatActive()).toBe(true);

      publisher.destroy();
      expect(publisher.isHeartbeatActive()).toBe(false);
    });
  });

  describe("3. Privacy filters and Ghost Mode (§10)", () => {
    it("reports OFFLINE when Ghost Mode is enabled (presenceVisibility = none)", () => {
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: mockTrack,
        positionMs: 25000,
        presenceVisibility: "none",
        listeningVisibility: "friends",
        revision: 6,
      });

      expect(payload.status).toBe("offline");
      expect(payload.trackId).toBeNull();
      expect(payload.playing).toBe(false);
      expect(payload.durationMs).toBe(0);
    });

    it("reports ONLINE without media facts when listeningVisibility = none", () => {
      const payload = buildPresencePayload({
        userId: mockUserId,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: mockTrack,
        positionMs: 25000,
        presenceVisibility: "friends",
        listeningVisibility: "none",
        revision: 7,
      });

      expect(payload.status).toBe("online");
      expect(payload.trackId).toBeNull();
      expect(payload.albumId).toBeNull();
      expect(payload.playing).toBe(false);
      expect(payload.positionMs).toBe(0);
    });
  });

  describe("4. Revision ordering and out-of-order rejection (§30)", () => {
    const existingEntry: FriendPresenceEntry = {
      userId: mockUserId,
      status: "listening",
      activity: {
        type: "listening",
        trackId: "track-1",
        albumId: null,
        playing: true,
        positionMs: 20000,
        positionUpdatedAt: 1000,
        durationMs: 180000,
        revision: 5,
      },
      receivedAt: 1000,
      revision: 5,
    };

    it("accepts an update when incoming revision is strictly greater", () => {
      const incoming: SocialPresencePayload = {
        userId: mockUserId,
        status: "listening",
        trackId: "track-1",
        albumId: null,
        playing: true,
        positionMs: 25000,
        positionUpdatedAt: 2000,
        durationMs: 180000,
        revision: 6,
      };

      expect(shouldApplyPresenceUpdate(existingEntry, incoming)).toBe(true);
    });

    it("rejects an update when incoming revision is strictly lower (out-of-order broadcast)", () => {
      const incoming: SocialPresencePayload = {
        userId: mockUserId,
        status: "paused",
        trackId: "track-1",
        albumId: null,
        playing: false,
        positionMs: 15000,
        positionUpdatedAt: 500,
        durationMs: 180000,
        revision: 4,
      };

      expect(shouldApplyPresenceUpdate(existingEntry, incoming)).toBe(false);
    });

    it("rejects same revision if incoming timestamp is older", () => {
      const incoming: SocialPresencePayload = {
        userId: mockUserId,
        status: "listening",
        trackId: "track-1",
        albumId: null,
        playing: true,
        positionMs: 19000,
        positionUpdatedAt: 800, // older than 1000
        durationMs: 180000,
        revision: 5,
      };

      expect(shouldApplyPresenceUpdate(existingEntry, incoming)).toBe(false);
    });

    it("applies update to socialStore only when revision check passes", () => {
      const store = new SocialStore();
      const first: SocialPresencePayload = {
        userId: mockUserId,
        status: "online",
        trackId: null,
        albumId: null,
        playing: false,
        positionMs: 0,
        positionUpdatedAt: 1000,
        durationMs: 0,
        revision: 10,
      };

      const applied1 = store.applyUpdate(first, 1000);
      expect(applied1).toBe(true);
      expect(store.getFriend(mockUserId, 1000)?.revision).toBe(10);

      // Stale/delayed revision
      const older: SocialPresencePayload = {
        userId: mockUserId,
        status: "offline",
        trackId: null,
        albumId: null,
        playing: false,
        positionMs: 0,
        positionUpdatedAt: 500,
        durationMs: 0,
        revision: 8,
      };

      const applied2 = store.applyUpdate(older, 1050);
      expect(applied2).toBe(false);
      expect(store.getFriend(mockUserId, 1050)?.status).toBe("online");
      expect(store.getFriend(mockUserId, 1050)?.revision).toBe(10);
    });

    it("generates strictly monotonically increasing revisions across time", () => {
      resetRevisionForTesting(0);
      const r1 = getNextRevision();
      const r2 = getNextRevision();
      const r3 = getNextRevision();
      expect(r1).toBeGreaterThan(0);
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });

    it("accepts updates after a simulated page reload using monotonic revisions", () => {
      const store = new SocialStore();
      const t1 = 1700000000000;
      const t2 = 1700000060000; // 60s later (after page reload)

      // Tab 1 session before reload
      store.applyUpdate(
        {
          userId: mockUserId,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          playing: true,
          positionMs: 50000,
          positionUpdatedAt: t1,
          durationMs: 180000,
          revision: t1 + 15,
        },
        t1,
      );
      expect(store.getFriend(mockUserId, t1)?.status).toBe("listening");
      expect(store.getFriend(mockUserId, t1)?.revision).toBe(t1 + 15);

      // Refreshed page sends fresh state with revision based on new time
      const freshUpdate: SocialPresencePayload = {
        userId: mockUserId,
        status: "listening",
        trackId: "track-2",
        albumId: null,
        playing: true,
        positionMs: 1000,
        positionUpdatedAt: t2,
        durationMs: 200000,
        revision: t2,
      };

      const applied = store.applyUpdate(freshUpdate, t2);
      expect(applied).toBe(true);
      expect(store.getFriend(mockUserId, t2)?.trackTitle).toBeDefined();
      expect(store.getFriend(mockUserId, t2)?.revision).toBe(t2);
    });
  });

  describe("5. 10-second stale heartbeat timeout logic (§13, §15)", () => {
    it("preserves status when received within 10 seconds", () => {
      const now = 20000;
      const entry: FriendPresenceEntry = {
        userId: mockUserId,
        status: "listening",
        activity: null,
        receivedAt: now - 5000, // 5s ago
        revision: 1,
      };

      expect(evaluateFriendEffectiveStatus(entry, now, STALE_HEARTBEAT_THRESHOLD_MS)).toBe("listening");
    });

    it("marks friend OFFLINE when heartbeat is older than 10 seconds", () => {
      const now = 20000;
      const entry: FriendPresenceEntry = {
        userId: mockUserId,
        status: "listening",
        activity: null,
        receivedAt: now - 10001, // 10.001s ago (>10s)
        revision: 1,
      };

      expect(evaluateFriendEffectiveStatus(entry, now, STALE_HEARTBEAT_THRESHOLD_MS)).toBe("offline");
    });

    it("transitions active friends to offline on checkStale()", () => {
      const store = new SocialStore();
      const baseTime = 100000;

      store.applyUpdate(
        {
          userId: "friend-a",
          status: "listening",
          trackId: null,
          albumId: null,
          playing: true,
          positionMs: 1000,
          positionUpdatedAt: baseTime,
          durationMs: 10000,
          revision: 1,
        },
        baseTime,
      );

      // 6s later -> still active
      const changed1 = store.checkStale(baseTime + 6000);
      expect(changed1).toBe(false);
      expect(store.getFriend("friend-a", baseTime + 6000)?.status).toBe("listening");

      // 11s later -> marked offline
      const changed2 = store.checkStale(baseTime + 11000);
      expect(changed2).toBe(true);
      expect(store.getFriend("friend-a", baseTime + 11000)?.status).toBe("offline");
      expect(store.getFriend("friend-a", baseTime + 11000)?.activity).toBeNull();
    });
  });

  describe("6. Local position interpolation math (§14, §16)", () => {
    it("returns exact positionMs when paused", () => {
      const activity: SocialListeningActivity = {
        type: "listening",
        trackId: "track-1",
        albumId: null,
        playing: false,
        positionMs: 45000,
        positionUpdatedAt: 10000,
        durationMs: 180000,
        revision: 1,
      };

      // 5 seconds elapsed, but paused -> does not advance
      const pos = interpolateFriendPosition(activity, 15000);
      expect(pos).toBe(45000);
    });

    it("interpolates forward when playing", () => {
      const activity: SocialListeningActivity = {
        type: "listening",
        trackId: "track-1",
        albumId: null,
        playing: true,
        positionMs: 30000,
        positionUpdatedAt: 10000,
        durationMs: 180000,
        revision: 1,
      };

      // 4.5 seconds later
      const pos = interpolateFriendPosition(activity, 14500);
      expect(pos).toBe(34500);
    });

    it("clamps position to durationMs", () => {
      const activity: SocialListeningActivity = {
        type: "listening",
        trackId: "track-1",
        albumId: null,
        playing: true,
        positionMs: 175000,
        positionUpdatedAt: 10000,
        durationMs: 180000,
        revision: 1,
      };

      // 10 seconds later (would be 185000) -> clamped to 180000
      const pos = interpolateFriendPosition(activity, 20000);
      expect(pos).toBe(180000);
    });

    it("formats duration milliseconds correctly into mm:ss", () => {
      expect(formatDurationMs(0)).toBe("00:00");
      expect(formatDurationMs(65000)).toBe("01:05");
      expect(formatDurationMs(214000)).toBe("03:34");
    });
  });

  describe("7. Media privacy and private track fallback (§16)", () => {
    it("masks unknown or private tracks with safe fallback", () => {
      const metadata = resolveTrackMetadata("non-existent-secret-track");
      expect(metadata.isPrivateMedia).toBe(true);
      expect(metadata.trackTitle).toBe("Đang nghe một nội dung riêng tư");
      expect(metadata.coverUrl).toBeNull();
    });

    it("handles null track gracefully", () => {
      const metadata = resolveTrackMetadata(null);
      expect(metadata.isPrivateMedia).toBe(false);
      expect(metadata.trackTitle).toBeUndefined();
    });
  });

  describe("8. Member Profile Viewing (getProfileInternal) (§19, §26)", () => {
    const aliceId = "11111111-1111-4111-8111-111111111111";
    const bobId = "22222222-2222-4222-8222-222222222222";
    const charlieId = "33333333-3333-4333-8333-333333333333";
    const blockerId = "44444444-4444-4444-8444-444444444444";

    const mockProfiles = [
      {
        user_id: aliceId,
        display_name: "Alice",
        handle: "alice",
        friend_code: "DUCK-ALIC-1111",
        avatar_storage_key: null,
        presence_visibility: "friends",
        listening_visibility: "friends",
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        user_id: bobId,
        display_name: "Bob",
        handle: "bob",
        friend_code: "DUCK-BOBB-2222",
        avatar_storage_key: null,
        presence_visibility: "friends",
        listening_visibility: "friends",
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        user_id: charlieId,
        display_name: "Charlie",
        handle: "charlie",
        friend_code: "DUCK-CHAR-3333",
        avatar_storage_key: null,
        presence_visibility: "friends",
        listening_visibility: "friends",
        created_at: "2026-09-03T00:00:00Z",
      },
      {
        user_id: blockerId,
        display_name: "Blocker",
        handle: "blocker",
        friend_code: "DUCK-BLOK-4444",
        avatar_storage_key: null,
        presence_visibility: "friends",
        listening_visibility: "friends",
        created_at: "2026-09-04T00:00:00Z",
      },
    ];

    const mockFriendships = [
      // Alice and Bob are accepted friends
      {
        id: "f-1",
        user_low_id: aliceId,
        user_high_id: bobId,
        status: "accepted",
      },
      // Blocker blocked Alice (low is Alice, high is Blocker -> blocked_second_to_first)
      {
        id: "f-2",
        user_low_id: aliceId,
        user_high_id: blockerId,
        status: "blocked_second_to_first",
      },
    ];

    beforeEach(() => {
      vi.spyOn(socialProfileServerModule, "resolveAvatarUrlInternal").mockImplementation(async () => null);

      const mockDb = {
        from: vi.fn((tableName: string) => {
          if (tableName === "profiles") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((col: string, val: any) => ({
                  maybeSingle: vi.fn(async () => ({
                    data: mockProfiles.find((p) => p[col as keyof typeof p] === val) || null,
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (tableName === "friendships") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((col1: string, val1: any) => ({
                  eq: vi.fn((col2: string, val2: any) => ({
                    maybeSingle: vi.fn(async () => ({
                      data:
                        mockFriendships.find(
                          (f) => f[col1 as keyof typeof f] === val1 && f[col2 as keyof typeof f] === val2,
                        ) || null,
                      error: null,
                    })),
                  })),
                })),
              })),
            };
          }
          return {};
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);
    });

    it("returns 'self' with friend code when viewing own profile", async () => {
      const profile = await getProfileInternal(aliceId, aliceId);
      expect(profile.userId).toBe(aliceId);
      expect(profile.displayName).toBe("Alice");
      expect(profile.handle).toBe("alice");
      expect(profile.relationship).toBe("self");
      expect(profile.friendCode).toBe("DUCK-ALIC-1111");
    });

    it("returns 'accepted' with friend code when viewing an accepted friend", async () => {
      const profile = await getProfileInternal(aliceId, bobId);
      expect(profile.userId).toBe(bobId);
      expect(profile.displayName).toBe("Bob");
      expect(profile.relationship).toBe("accepted");
      expect(profile.friendCode).toBe("DUCK-BOBB-2222"); // Friend code visible to accepted friends
    });

    it("returns 'none' and withholds friend code when viewing a non-friend", async () => {
      const profile = await getProfileInternal(aliceId, charlieId);
      expect(profile.userId).toBe(charlieId);
      expect(profile.displayName).toBe("Charlie");
      expect(profile.relationship).toBe("none");
      expect(profile.friendCode).toBeUndefined(); // Withheld for privacy
    });

    it("throws 404 safe fail-closed when target has blocked current user", async () => {
      await expect(getProfileInternal(aliceId, blockerId)).rejects.toThrow();
    });

    it("throws 400 when missing target user ID", async () => {
      await expect(getProfileInternal(aliceId, "")).rejects.toThrow();
    });

    it("invalidates profile cache safely on friend removal or block", () => {
      expect(() => invalidateProfileCache(aliceId)).not.toThrow();
      expect(() => invalidateProfileCache()).not.toThrow();
    });
  });
});
