import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../supabase-client";
import type { TabRole } from "../player-broadcast";
import type {
  SocialListeningActivity,
  SocialPresencePayload,
  SocialPresenceStatus,
  SocialVisibility,
} from "./social-types";

export const SOCIAL_HEARTBEAT_INTERVAL_MS = 5000; // ~5s per Friends Plan §12 & §13

let lastRevision = 0;

/**
 * Returns a strictly monotonically increasing revision number.
 * Uses epoch timestamp as a monotonic base so revisions stay strictly increasing
 * across tab switches, page reloads, and leader promotions.
 */
export function getNextRevision(): number {
  const now = Date.now();
  lastRevision = now > lastRevision ? now : lastRevision + 1;
  return lastRevision;
}

export function resetRevisionForTesting(initial = 0): void {
  lastRevision = initial;
}

/**
 * Pure builder function for presence payloads (§10, §17, §28).
 * Enforces:
 * - Ghost mode: status = 'offline', media stripped
 * - Private listening: status = 'online', media stripped
 * - Non-leader multi-tab: status = 'online', media stripped (only leader tab drives listening activity)
 * - Leader with playback: status = 'listening' | 'paused' with compact playback facts
 */
export function buildPresencePayload(params: {
  userId: string;
  tabRole: TabRole;
  isPlaying: boolean;
  currentTrack?: { id: string; albumId?: string | null; duration: number } | null | undefined;
  positionMs: number;
  presenceVisibility: SocialVisibility;
  listeningVisibility: SocialVisibility;
  revision: number;
  nowMs?: number;
}): SocialPresencePayload {
  const now = params.nowMs ?? Date.now();

  // 1. Ghost mode override (§10)
  if (params.presenceVisibility === "none") {
    return {
      userId: params.userId,
      status: "offline",
      trackId: null,
      albumId: null,
      playing: false,
      positionMs: 0,
      positionUpdatedAt: now,
      durationMs: 0,
      revision: params.revision,
    };
  }

  // 2. Private listening or no active track (§10, §15)
  if (params.listeningVisibility === "none" || !params.currentTrack) {
    return {
      userId: params.userId,
      status: "online",
      trackId: null,
      albumId: null,
      playing: false,
      positionMs: 0,
      positionUpdatedAt: now,
      durationMs: 0,
      revision: params.revision,
    };
  }

  // 3. Multi-tab arbitration: non-leader tabs report ONLINE (§28)
  if (params.tabRole !== "leader") {
    return {
      userId: params.userId,
      status: "online",
      trackId: null,
      albumId: null,
      playing: false,
      positionMs: 0,
      positionUpdatedAt: now,
      durationMs: 0,
      revision: params.revision,
    };
  }

  // 4. Leader tab with active playback
  const status: SocialPresenceStatus = params.isPlaying ? "listening" : "paused";
  const durationMs = Math.round((params.currentTrack.duration || 0) * 1000);
  const clampedPositionMs = Math.min(Math.max(0, params.positionMs), durationMs || params.positionMs);

  return {
    userId: params.userId,
    status,
    trackId: params.currentTrack.id,
    albumId: params.currentTrack.albumId || null,
    playing: params.isPlaying,
    positionMs: clampedPositionMs,
    positionUpdatedAt: now,
    durationMs,
    revision: params.revision,
  };
}

export interface SocialPresencePublisherState {
  userId: string;
  tabRole: TabRole;
  isPlaying: boolean;
  currentTrack?: { id: string; albumId?: string | null; duration: number } | null;
  positionMs: number;
  presenceVisibility: SocialVisibility;
  listeningVisibility: SocialVisibility;
}

function isBrowserOrTest(): boolean {
  return typeof window !== "undefined" || (typeof process !== "undefined" && process.env["NODE_ENV"] === "test");
}

export class SocialPresencePublisher {
  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private heartbeatTimer: any = null;
  private lastStatus: SocialPresenceStatus = "offline";
  private currentState: SocialPresencePublisherState | null = null;

  public init(userId: string): void {
    if (this.userId === userId && this.channel) return;
    this.destroy();
    this.userId = userId;

    if (!isBrowserOrTest()) return;

    try {
      const topic = `social:user:${userId}`;
      this.channel = supabase.channel(topic, {
        config: {
          private: true,
          broadcast: { self: false, ack: false },
          presence: { key: userId },
        },
      });

      this.channel.subscribe((status) => {
        if (status === "SUBSCRIBED" && this.currentState && this.currentState.tabRole === "leader") {
          this.publishImmediate();
        }
      });

      if (this.currentState?.tabRole === "leader") {
        this.startHeartbeat();
      }
    } catch (err) {
      console.warn("[SocialPresencePublisher] Realtime channel setup skipped or unavailable:", err);
    }
  }

  public updateState(state: SocialPresencePublisherState): void {
    this.currentState = state;

    if (!this.channel) {
      this.init(state.userId);
    }

    // Multi-tab arbitration (§28):
    // Only the playback leader tab actively broadcasts presence and heartbeats.
    // Non-leader tabs stop heartbeat and yield to avoid channel contention.
    if (state.tabRole !== "leader") {
      this.stopHeartbeat();
      return;
    }

    // Ensure heartbeat loop is active for leader tab
    this.ensureHeartbeat();

    const revision = getNextRevision();
    const payload = buildPresencePayload({
      ...state,
      revision,
    });

    const isSemanticChange = this.lastStatus !== payload.status;
    this.lastStatus = payload.status;

    this.sendPresenceAndBroadcast(payload, isSemanticChange);
  }

  private publishImmediate(): void {
    if (!this.currentState || this.currentState.tabRole !== "leader") return;
    const revision = getNextRevision();
    const payload = buildPresencePayload({
      ...this.currentState,
      revision,
    });
    this.lastStatus = payload.status;
    this.sendPresenceAndBroadcast(payload, true);
  }

  private sendPresenceAndBroadcast(payload: SocialPresencePayload, isSemantic: boolean): void {
    if (!this.channel || !isBrowserOrTest()) return;

    try {
      // If semantic status changed (online, listening, paused, offline), track on Presence (§12)
      if (isSemantic) {
        this.channel.track(payload).catch(() => {});
      }

      // Always broadcast activity for low-latency delivery & position refresh (§12)
      this.channel
        .send({
          type: "broadcast",
          event: "activity",
          payload,
        })
        .catch(() => {});
    } catch {
      // Ignore transport errors quietly
    }
  }

  public ensureHeartbeat(): void {
    if (!this.heartbeatTimer && isBrowserOrTest()) {
      this.startHeartbeat();
    }
  }

  public startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!isBrowserOrTest()) return;

    this.heartbeatTimer = setInterval(() => {
      if (!this.currentState || !this.channel) return;
      // Only leader tab broadcasts heartbeat (§28)
      if (this.currentState.tabRole !== "leader") {
        this.stopHeartbeat();
        return;
      }
      // Do not broadcast heartbeat if in ghost mode (§10)
      if (this.currentState.presenceVisibility === "none") return;

      const revision = getNextRevision();
      const payload = buildPresencePayload({
        ...this.currentState,
        revision,
      });

      // Broadcast heartbeat (~5s during playback / active) (§12, §13)
      this.channel
        ?.send({
          type: "broadcast",
          event: "activity",
          payload,
        })
        .catch(() => {});
    }, SOCIAL_HEARTBEAT_INTERVAL_MS);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public isHeartbeatActive(): boolean {
    return this.heartbeatTimer !== null;
  }

  public destroy(): void {
    this.stopHeartbeat();

    if (this.channel && this.userId) {
      try {
        const offlinePayload: SocialPresencePayload = {
          userId: this.userId,
          status: "offline",
          trackId: null,
          albumId: null,
          playing: false,
          positionMs: 0,
          positionUpdatedAt: Date.now(),
          durationMs: 0,
          revision: getNextRevision(),
        };
        this.channel.send({ type: "broadcast", event: "activity", payload: offlinePayload }).catch(() => {});
        this.channel.untrack().catch(() => {});
        supabase.removeChannel(this.channel);
      } catch {
        // Ignore during cleanup
      }
      this.channel = null;
    }

    this.userId = null;
    this.currentState = null;
    this.lastStatus = "offline";
  }
}

export const socialPresencePublisher = new SocialPresencePublisher();
