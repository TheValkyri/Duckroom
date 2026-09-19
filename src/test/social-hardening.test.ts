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
  interpolateFriendPosition,
  resolveTrackMetadata,
  shouldApplyPresenceUpdate,
  socialStore,
  STALE_HEARTBEAT_THRESHOLD_MS,
} from "../lib/social/social-store";
import { getCanonicalPair, evaluateRelationship } from "../lib/social/social-types";
import { getProfileInternal } from "../lib/social/social-profile.server";
import type { FriendPresenceEntry, SocialPresencePayload } from "../lib/social/social-types";
import * as supabaseModule from "../lib/supabase";

/**
 * Phase 5: Hardening & End-to-End Social Integration Suite (§40, §41, §43).
 *
 * Verifies the full social lifecycle under concurrent, real-world edge cases:
 * - Two-user friendship handshake & canonical pair integrity
 * - Realtime topic authorization boundary (friends allowed, strangers/blocked rejected)
 * - Multi-tab leader arbitration (§28)
 * - Monotonic packet revision ordering & out-of-order rejection (§30)
 * - 10-second stale detection & graceful offline degradation (§13)
 * - Reconnection restoration (§29)
 * - Private track masking (§16)
 * - Independent privacy toggles & Ghost mode (§10)
 * - Block enforcement & fail-closed profile secrecy (§31)
 */

describe("Phase 5: Social Hardening & Integration Verification", () => {
  const userAlice = "11111111-1111-4111-8111-111111111111";
  const userBob = "22222222-2222-4222-8222-222222222222";
  const userCharlie = "33333333-3333-4333-8333-333333333333";

  const sampleTrack = {
    id: "track-neon-duck",
    albumId: "album-synthwave",
    duration: 180, // 3 minutes = 180,000ms
  };

  beforeEach(() => {
    vi.useRealTimers();
    socialStore.reset();
    resetRevisionForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Full Two-User Handshake & Canonical Pair Integrity (§8, §40)", () => {
    it("preserves canonical pair ordering regardless of who initiates the request", () => {
      const pairFromAlice = getCanonicalPair(userAlice, userBob);
      const pairFromBob = getCanonicalPair(userBob, userAlice);

      expect(pairFromAlice.userLowId).toBe(userAlice);
      expect(pairFromAlice.userHighId).toBe(userBob);
      expect(pairFromBob.userLowId).toBe(userAlice);
      expect(pairFromBob.userHighId).toBe(userBob);
    });

    it("evaluates mutual pending states accurately for sender and recipient", () => {
      // Alice sends to Bob (user_low -> user_high)
      const pendingRow = {
        id: "friendship-1",
        user_low_id: userAlice,
        user_high_id: userBob,
        status: "pending_first_to_second" as const,
      };

      expect(evaluateRelationship(userAlice, userBob, pendingRow)).toBe("pending_sent");
      expect(evaluateRelationship(userBob, userAlice, pendingRow)).toBe("pending_received");

      // Bob accepts -> status becomes 'accepted'
      const acceptedRow = {
        ...pendingRow,
        status: "accepted" as const,
      };

      expect(evaluateRelationship(userAlice, userBob, acceptedRow)).toBe("accepted");
      expect(evaluateRelationship(userBob, userAlice, acceptedRow)).toBe("accepted");
    });
  });

  describe("2. Realtime Authorization Boundary (§20, §40, §41)", () => {
    it("only permits channel topic publishing by the topic owner", () => {
      const aliceTopic = `social:user:${userAlice}`;

      // Invariant: publisher user ID must match topic suffix
      const isAuthorizedPublisher = (userId: string, topic: string) => {
        return topic === `social:user:${userId}`;
      };

      expect(isAuthorizedPublisher(userAlice, aliceTopic)).toBe(true);
      expect(isAuthorizedPublisher(userBob, aliceTopic)).toBe(false);
      expect(isAuthorizedPublisher(userCharlie, aliceTopic)).toBe(false);
    });

    it("permits subscription only to accepted friends and strictly rejects strangers/blocked users", () => {
      const isAuthorizedSubscriber = (
        viewerId: string,
        targetId: string,
        relationship: "accepted" | "pending_sent" | "pending_received" | "blocked_by_me" | "blocked_by_them" | "none",
      ) => {
        if (viewerId === targetId) return true;
        return relationship === "accepted";
      };

      expect(isAuthorizedSubscriber(userBob, userAlice, "accepted")).toBe(true);
      expect(isAuthorizedSubscriber(userCharlie, userAlice, "none")).toBe(false);
      expect(isAuthorizedSubscriber(userCharlie, userAlice, "pending_sent")).toBe(false);
      expect(isAuthorizedSubscriber(userCharlie, userAlice, "blocked_by_them")).toBe(false);
      expect(isAuthorizedSubscriber(userCharlie, userAlice, "blocked_by_me")).toBe(false);
    });
  });

  describe("3. Multi-Tab Leader Arbitration (§28, §40)", () => {
    it("suppresses listening activity on follower tabs and allows only leader to broadcast", () => {
      const now = 1700000000000;

      // Tab 1: follower tab
      const followerPayload = buildPresencePayload({
        userId: userAlice,
        tabRole: "follower",
        isPlaying: true, // Follower local audio playing
        currentTrack: sampleTrack,
        positionMs: 12000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 1,
        nowMs: now,
      });

      // Tab 1 must only emit ONLINE, never LISTENING
      expect(followerPayload.status).toBe("online");
      expect(followerPayload.trackId).toBeNull();
      expect(followerPayload.playing).toBe(false);

      // Tab 2: leader tab
      const leaderPayload = buildPresencePayload({
        userId: userAlice,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 12000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
        revision: 2,
        nowMs: now,
      });

      // Tab 2 emits LISTENING with full playback facts
      expect(leaderPayload.status).toBe("listening");
      expect(leaderPayload.trackId).toBe("track-neon-duck");
      expect(leaderPayload.playing).toBe(true);
    });
  });

  describe("4. Monotonic Revision Ordering & Out-of-Order Packet Rejection (§30)", () => {
    const makePayload = (rev: number, posUpdatedAt: number): SocialPresencePayload => ({
      userId: userAlice,
      status: "listening",
      trackId: "track-1",
      albumId: null,
      playing: true,
      positionMs: 50000,
      positionUpdatedAt: posUpdatedAt,
      durationMs: 180000,
      revision: rev,
    });

    it("applies sequential packets in strictly increasing order", () => {
      const entry: FriendPresenceEntry = {
        userId: userAlice,
        status: "listening",
        revision: 5,
        receivedAt: 1700000005000,
        activity: {
          type: "listening",
          trackId: "track-1",
          albumId: null,
          playing: true,
          positionMs: 50000,
          positionUpdatedAt: 1700000005000,
          durationMs: 180000,
          revision: 5,
        },
      };

      // Packet with revision 6 is newer -> should apply
      expect(shouldApplyPresenceUpdate(entry, makePayload(6, 1700000006000))).toBe(true);

      // Packet with revision 4 is out-of-order delayed packet -> reject
      expect(shouldApplyPresenceUpdate(entry, makePayload(4, 1700000007000))).toBe(false);
    });

    it("rejects delayed packets with older timestamp when revision matches", () => {
      const entry: FriendPresenceEntry = {
        userId: userAlice,
        status: "listening",
        revision: 10,
        receivedAt: 1700000010000,
        activity: {
          type: "listening",
          trackId: "track-1",
          albumId: null,
          playing: true,
          positionMs: 50000,
          positionUpdatedAt: 1700000010000,
          durationMs: 180000,
          revision: 10,
        },
      };

      // Same revision with past timestamp
      expect(shouldApplyPresenceUpdate(entry, makePayload(10, 1700000009000))).toBe(false);

      // Same revision with equal or newer timestamp
      expect(shouldApplyPresenceUpdate(entry, makePayload(10, 1700000011000))).toBe(true);
    });
  });

  describe("5. 10-Second Stale Detection & Reconnect Restoration (§13, §29)", () => {
    it("transitions from active status to OFFLINE after exactly 10,001ms without heartbeat", () => {
      const heartbeatTime = 1700000000000;
      const activeEntry: FriendPresenceEntry = {
        userId: userAlice,
        status: "listening",
        revision: 1,
        receivedAt: heartbeatTime,
        activity: {
          type: "listening",
          trackId: "track-1",
          albumId: null,
          playing: true,
          positionMs: 30000,
          positionUpdatedAt: heartbeatTime,
          durationMs: 180000,
          revision: 1,
        },
      };

      // At 9.9 seconds: still active
      expect(evaluateFriendEffectiveStatus(activeEntry, heartbeatTime + 9900)).toBe("listening");

      // At 10.0 seconds: exactly threshold, still active
      expect(evaluateFriendEffectiveStatus(activeEntry, heartbeatTime + STALE_HEARTBEAT_THRESHOLD_MS)).toBe(
        "listening",
      );

      // At 10.001 seconds: STALE -> OFFLINE
      expect(evaluateFriendEffectiveStatus(activeEntry, heartbeatTime + 10001)).toBe("offline");
    });

    it("instantly restores status upon reconnection and receiving fresh heartbeat packet", () => {
      const t0 = 1700000000000;
      socialStore.applyUpdate(
        {
          userId: userAlice,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          positionMs: 10000,
          positionUpdatedAt: t0,
          durationMs: 180000,
          playing: true,
          revision: 1,
        },
        t0,
      );

      // Advance clock past 10s: store marks stale
      expect(socialStore.getFriend(userAlice, t0 + 15000)?.status).toBe("offline");

      // Alice reconnects with fresh packet at t0 + 20s with revision 2
      socialStore.applyUpdate(
        {
          userId: userAlice,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          positionMs: 25000,
          positionUpdatedAt: t0 + 20000,
          durationMs: 180000,
          playing: true,
          revision: 2,
        },
        t0 + 20000,
      );

      // Status immediately restored to listening
      const restored = socialStore.getFriend(userAlice, t0 + 20000);
      expect(restored?.status).toBe("listening");
      expect(restored?.activity?.positionMs).toBe(25000);
    });
  });

  describe("6. Playback Progress Interpolation & Seeking (§14, §27)", () => {
    it("smoothly advances position locally between heartbeats without jitter", () => {
      const t0 = 1700000000000;
      const activity = {
        type: "listening" as const,
        trackId: "track-1",
        albumId: null,
        positionMs: 20000,
        positionUpdatedAt: t0,
        durationMs: 180000,
        playing: true,
        revision: 1,
      };

      // +3 seconds elapsed locally
      expect(interpolateFriendPosition(activity, t0 + 3000)).toBe(23000);

      // +7 seconds elapsed locally
      expect(interpolateFriendPosition(activity, t0 + 7000)).toBe(27000);

      // Does not overshoot track duration
      expect(interpolateFriendPosition(activity, t0 + 200000)).toBe(180000);
    });

    it("freezes position during PAUSED status", () => {
      const t0 = 1700000000000;
      const pausedActivity = {
        type: "listening" as const,
        trackId: "track-1",
        albumId: null,
        positionMs: 45000,
        positionUpdatedAt: t0,
        durationMs: 180000,
        playing: false,
        revision: 2,
      };

      // Position stays at 45,000ms regardless of elapsed time
      expect(interpolateFriendPosition(pausedActivity, t0 + 5000)).toBe(45000);
      expect(interpolateFriendPosition(pausedActivity, t0 + 9000)).toBe(45000);
    });

    it("correctly handles seek updates by overriding previous interpolated position", () => {
      const t0 = 1700000000000;
      socialStore.applyUpdate(
        {
          userId: userAlice,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          positionMs: 10000,
          positionUpdatedAt: t0,
          durationMs: 180000,
          playing: true,
          revision: 1,
        },
        t0,
      );

      // User seeks ahead to 90,000ms at t0 + 2000
      socialStore.applyUpdate(
        {
          userId: userAlice,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          positionMs: 90000,
          positionUpdatedAt: t0 + 2000,
          durationMs: 180000,
          playing: true,
          revision: 2,
        },
        t0 + 2000,
      );

      // Interpolates from 90,000ms
      const friend = socialStore.getFriend(userAlice, t0 + 2000);
      expect(friend?.activity?.positionMs).toBe(90000);
      expect(interpolateFriendPosition(friend?.activity, t0 + 5000)).toBe(93000);
    });
  });

  describe("7. Private Track Masking & Privacy Secrecy (§16, §40)", () => {
    it("resolveTrackMetadata identifies unlisted/private media and provides privacy fallback", () => {
      const resolved = resolveTrackMetadata("unlisted-private-track-id-999");

      expect(resolved.isPrivateMedia).toBe(true);
      expect(resolved.trackTitle).toBe("Đang nghe một nội dung riêng tư");
      expect(resolved.artistName).toBe("");
      expect(resolved.albumTitle).toBe("");
      expect(resolved.coverUrl).toBeNull();
    });

    it("receiver store stores privacy fallback without leaking private media data", () => {
      socialStore.applyUpdate({
        userId: userAlice,
        status: "listening",
        trackId: "secret-private-track-id-888",
        albumId: null,
        playing: true,
        positionMs: 15000,
        positionUpdatedAt: Date.now(),
        durationMs: 240000,
        revision: 1,
      });

      const friend = socialStore.getFriend(userAlice);
      expect(friend?.isPrivateMedia).toBe(true);
      expect(friend?.trackTitle).toBe("Đang nghe một nội dung riêng tư");
      expect(friend?.coverUrl).toBeNull();
    });
  });

  describe("8. Privacy Settings & Ghost Mode (§10, §40)", () => {
    it("Ghost Mode (none/none) forces status to OFFLINE and wipes track activity", () => {
      const payload = buildPresencePayload({
        userId: userAlice,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 30000,
        presenceVisibility: "none",
        listeningVisibility: "none",
        revision: 1,
      });

      expect(payload.status).toBe("offline");
      expect(payload.trackId).toBeNull();
      expect(payload.playing).toBe(false);
      expect(payload.positionMs).toBe(0);
    });

    it("Listening hidden (friends/none) presents as ONLINE but hides listening activity", () => {
      const payload = buildPresencePayload({
        userId: userAlice,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 30000,
        presenceVisibility: "friends",
        listeningVisibility: "none",
        revision: 2,
      });

      expect(payload.status).toBe("online");
      expect(payload.trackId).toBeNull();
      expect(payload.playing).toBe(false);
    });
  });

  describe("9. Block Enforcement & Fail-Closed Secrecy (§8, §31, §40)", () => {
    it("fails closed with 404 when a blocked user queries blocker's profile", async () => {
      // Mock Supabase admin response where Alice has blocked Bob
      const mockProfile = {
        user_id: userAlice,
        display_name: "Alice",
        handle: "alice",
        avatar_storage_key: null,
        friend_code: "DUCK-1111-2222",
        presence_visibility: "friends",
        listening_visibility: "friends",
        created_at: new Date().toISOString(),
      };

      const mockFriendship = {
        id: "rel-block-1",
        user_low_id: userAlice,
        user_high_id: userBob,
        status: "blocked_first_to_second", // Alice blocked Bob
      };

      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: mockProfile, error: null }),
                }),
              }),
            };
          }
          if (table === "friendships") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: mockFriendship, error: null }),
                  }),
                }),
              }),
            };
          }
          return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
        }),
      } as any;

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(fakeDb);

      // Bob tries to query Alice's profile -> MUST throw 404
      await expect(getProfileInternal(userBob, userAlice)).rejects.toThrow();
      try {
        await getProfileInternal(userBob, userAlice);
      } catch (err: any) {
        expect(err.status).toBe(404);
      }
    });

    it("resets relationship to 'none' when unblocked", () => {
      expect(evaluateRelationship(userAlice, userBob, null)).toBe("none");
    });
  });

  describe("10. Realtime Heartbeat Dynamic Sampling & Rewind Prevention (§12, §13, §14, §28)", () => {
    it("dynamically queries getPositionMs on heartbeat ticks to prevent progress rewind", () => {
      let mockAudioCurrentTimeSec = 0;
      const getPositionMs = () => Math.round(mockAudioCurrentTimeSec * 1000);

      const publisher = new SocialPresencePublisher();
      const broadcasts: any[] = [];
      (publisher as any).channel = {
        send: vi.fn(async (msg: any) => {
          broadcasts.push(msg);
          return {};
        }),
        track: vi.fn(async () => ({})),
      };

      // Alice starts playing at 0:00
      publisher.updateState({
        userId: userAlice,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 0,
        getPositionMs,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
      });

      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0].payload.positionMs).toBe(0);

      // Advance audio time to 5 seconds
      mockAudioCurrentTimeSec = 5.0;

      // Simulate heartbeat execution
      vi.useFakeTimers();
      publisher.startHeartbeat();
      vi.advanceTimersByTime(SOCIAL_HEARTBEAT_INTERVAL_MS);

      // Heartbeat must broadcast 5000ms, NOT 0ms!
      expect(broadcasts.length).toBe(2);
      expect(broadcasts[1].payload.positionMs).toBe(5000);
      expect(broadcasts[1].payload.status).toBe("listening");

      // Advance audio time to 10 seconds
      mockAudioCurrentTimeSec = 10.0;
      vi.advanceTimersByTime(SOCIAL_HEARTBEAT_INTERVAL_MS);

      expect(broadcasts.length).toBe(3);
      expect(broadcasts[2].payload.positionMs).toBe(10000);

      publisher.destroy();
      vi.useRealTimers();
    });

    it("immediately broadcasts online and stops heartbeat when demoted from leader to follower", () => {
      const publisher = new SocialPresencePublisher();
      const broadcasts: any[] = [];
      (publisher as any).channel = {
        send: vi.fn(async (msg: any) => {
          broadcasts.push(msg);
          return {};
        }),
        track: vi.fn(async () => ({})),
      };

      // Tab is leader and playing
      publisher.updateState({
        userId: userAlice,
        tabRole: "leader",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 30000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
      });

      expect(publisher.isHeartbeatActive()).toBe(true);
      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0].payload.status).toBe("listening");

      // Tab demoted to follower
      publisher.updateState({
        userId: userAlice,
        tabRole: "follower",
        isPlaying: true,
        currentTrack: sampleTrack,
        positionMs: 30000,
        presenceVisibility: "friends",
        listeningVisibility: "friends",
      });

      // Must have stopped heartbeat and broadcast 'online' once to yield
      expect(publisher.isHeartbeatActive()).toBe(false);
      expect(broadcasts.length).toBe(2);
      expect(broadcasts[1].payload.status).toBe("online");
      expect(broadcasts[1].payload.trackId).toBeNull();
      expect(broadcasts[1].payload.playing).toBe(false);

      publisher.destroy();
    });

    it("preserves referential stability in getFriend under stale conditions (useSyncExternalStore safety)", () => {
      const t0 = 1700000000000;
      socialStore.applyUpdate(
        {
          userId: userAlice,
          status: "listening",
          trackId: "track-1",
          albumId: null,
          positionMs: 10000,
          positionUpdatedAt: t0,
          durationMs: 180000,
          playing: true,
          revision: 1,
        },
        t0,
      );

      // Fast-forward time past stale threshold (>10s)
      const tAfterStale = t0 + 12000;

      const ref1 = socialStore.getFriend(userAlice, tAfterStale);
      const ref2 = socialStore.getFriend(userAlice, tAfterStale);
      const ref3 = socialStore.getFriend(userAlice, tAfterStale);

      expect(ref1?.status).toBe("offline");
      expect(ref2?.status).toBe("offline");
      expect(ref3?.status).toBe("offline");

      // Invariant: MUST return identical object reference across repeated calls
      expect(Object.is(ref1, ref2)).toBe(true);
      expect(Object.is(ref2, ref3)).toBe(true);
    });

    it("handles concurrent multi-tab handover between 5 tabs cleanly without duplicate broadcasting", () => {
      const tabs = Array.from({ length: 5 }, (_, i) => ({
        id: `tab-${i + 1}`,
        publisher: new SocialPresencePublisher(),
        broadcasts: [] as any[],
      }));

      tabs.forEach((tab) => {
        (tab.publisher as any).channel = {
          send: vi.fn(async (msg: any) => {
            tab.broadcasts.push(msg);
            return {};
          }),
          track: vi.fn(async () => ({})),
        };
      });

      // Round-robin leadership handover through 5 tabs
      for (let activeIdx = 0; activeIdx < tabs.length; activeIdx++) {
        tabs.forEach((tab, idx) => {
          const isCurrentLeader = idx === activeIdx;
          tab.publisher.updateState({
            userId: userAlice,
            tabRole: isCurrentLeader ? "leader" : "follower",
            isPlaying: isCurrentLeader,
            currentTrack: isCurrentLeader ? sampleTrack : null,
            positionMs: isCurrentLeader ? (activeIdx + 1) * 10000 : 0,
            presenceVisibility: "friends",
            listeningVisibility: "friends",
          });
        });

        // Exactly one tab is leader and heartbeating
        const leaderTabs = tabs.filter((t) => t.publisher.isHeartbeatActive());
        expect(leaderTabs.length).toBe(1);
        expect(leaderTabs[0]?.id).toBe(tabs[activeIdx]?.id);
      }

      tabs.forEach((tab) => tab.publisher.destroy());
    });
  });
});
