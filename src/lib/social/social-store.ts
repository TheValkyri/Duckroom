import { useSyncExternalStore, useEffect, useState } from "react";
import { tracks, albums, subscribeLibrary } from "../../data/library";
import type {
  FriendPresenceEntry,
  SocialListeningActivity,
  SocialPresencePayload,
  SocialPresenceStatus,
} from "./social-types";

export const STALE_HEARTBEAT_THRESHOLD_MS = 10_000; // 10s per Friends Plan §13 & §15

/**
 * Checks if an incoming presence payload should be applied over the existing entry (§30).
 * Rejects out-of-order deliveries based on monotonic revision and timestamp check.
 */
export function shouldApplyPresenceUpdate(
  current: FriendPresenceEntry | undefined,
  incoming: SocialPresencePayload,
): boolean {
  if (!current) return true;

  // Strict revision monotonicity
  if (incoming.revision < current.revision) {
    return false;
  }

  // If revisions match, reject older position timestamp
  if (incoming.revision === current.revision) {
    const currentTs = current.activity?.positionUpdatedAt ?? current.receivedAt;
    if (incoming.positionUpdatedAt < currentTs) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves track metadata for safe presentation (§16).
 * Never discloses private or unresolvable track metadata to friends.
 */
export function resolveTrackMetadata(trackId: string | null): {
  trackTitle?: string;
  artistName?: string;
  albumTitle?: string;
  coverUrl?: string | null;
  isPrivateMedia: boolean;
} {
  if (!trackId) {
    return { isPrivateMedia: false };
  }

  const track = tracks.find((t) => t.id === trackId && t.status !== "trash" && t.status !== "archived");
  if (!track) {
    // Media is private, unlisted, or inaccessible to this recipient
    return {
      trackTitle: "Đang nghe một nội dung riêng tư",
      artistName: "",
      albumTitle: "",
      coverUrl: null,
      isPrivateMedia: true,
    };
  }

  const album = track.albumId ? albums.find((a) => a.id === track.albumId) : null;

  return {
    trackTitle: track.title,
    artistName: track.artist,
    albumTitle: album?.title || "",
    coverUrl: track.cover || album?.cover || null,
    isPrivateMedia: false,
  };
}

/**
 * Interpolates playback position locally without frame-by-frame network traffic (§14, §16).
 * displayPosition = playing ? positionMs + (now - positionUpdatedAt) : positionMs
 */
export function interpolateFriendPosition(
  activity: SocialListeningActivity | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!activity) return 0;
  const duration = activity.durationMs || 0;

  if (!activity.playing) {
    const pos = Math.max(0, activity.positionMs);
    return duration > 0 ? Math.min(pos, duration) : pos;
  }

  const elapsed = Math.max(0, nowMs - activity.positionUpdatedAt);
  const rawPos = Math.max(0, activity.positionMs + elapsed);
  return duration > 0 ? Math.min(rawPos, duration) : rawPos;
}

/**
 * Evaluates effective presence status considering local 10s stale timeout (§13, §15).
 */
export function evaluateFriendEffectiveStatus(
  entry: FriendPresenceEntry | undefined,
  nowMs: number = Date.now(),
  staleTimeoutMs: number = STALE_HEARTBEAT_THRESHOLD_MS,
): SocialPresenceStatus {
  if (!entry) return "offline";
  if (entry.status === "offline") return "offline";

  if (nowMs - entry.receivedAt > staleTimeoutMs) {
    return "offline";
  }

  return entry.status;
}

/**
 * Formats milliseconds into mm:ss string.
 */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export class SocialStore {
  private friends: Record<string, FriendPresenceEntry> = {};
  private listeners = new Set<() => void>();
  private staleTimer: any = null;

  constructor() {
    this.startStaleChecker();
  }

  private startStaleChecker() {
    if (typeof window === "undefined") return;
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      this.checkStale();
    }, 2000);
  }

  public getState(): Record<string, FriendPresenceEntry> {
    return this.friends;
  }

  public getFriend(userId: string, nowMs: number = Date.now()): FriendPresenceEntry | undefined {
    const entry = this.friends[userId];
    if (!entry) return undefined;
    const effectiveStatus = evaluateFriendEffectiveStatus(entry, nowMs);
    if (effectiveStatus !== entry.status && effectiveStatus === "offline") {
      // Return projection with offline status
      return {
        ...entry,
        status: "offline",
        activity: null,
      };
    }
    return entry;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error("[SocialStore] Listener error:", err);
      }
    });
  }

  public applyUpdate(payload: SocialPresencePayload, nowMs: number = Date.now()): boolean {
    const current = this.friends[payload.userId];
    if (!shouldApplyPresenceUpdate(current, payload)) {
      return false;
    }

    const { trackTitle, artistName, albumTitle, coverUrl, isPrivateMedia } = resolveTrackMetadata(payload.trackId);

    const activity: SocialListeningActivity | null =
      payload.status === "listening" || payload.status === "paused"
        ? {
            type: "listening",
            trackId: payload.trackId || "",
            albumId: payload.albumId,
            playing: payload.playing,
            positionMs: payload.positionMs,
            positionUpdatedAt: payload.positionUpdatedAt,
            durationMs: payload.durationMs,
            revision: payload.revision,
          }
        : null;

    this.friends[payload.userId] = {
      userId: payload.userId,
      status: payload.status,
      activity,
      receivedAt: nowMs,
      revision: payload.revision,
      trackTitle,
      artistName,
      albumTitle,
      coverUrl,
      isPrivateMedia,
    };

    this.emit();
    return true;
  }

  public markOffline(userId: string, nowMs: number = Date.now()): void {
    const current = this.friends[userId];
    if (!current || current.status === "offline") return;

    this.friends[userId] = {
      ...current,
      status: "offline",
      activity: null,
      receivedAt: nowMs,
      revision: Math.max(current.revision + 1, nowMs),
    };
    this.emit();
  }

  public refreshMediaMetadata(): void {
    let changed = false;
    for (const userId of Object.keys(this.friends)) {
      const entry = this.friends[userId];
      if (entry && entry.activity?.trackId) {
        const resolved = resolveTrackMetadata(entry.activity.trackId);
        if (
          resolved.trackTitle !== entry.trackTitle ||
          resolved.isPrivateMedia !== entry.isPrivateMedia ||
          resolved.coverUrl !== entry.coverUrl
        ) {
          this.friends[userId] = {
            ...entry,
            trackTitle: resolved.trackTitle,
            artistName: resolved.artistName,
            albumTitle: resolved.albumTitle,
            coverUrl: resolved.coverUrl,
            isPrivateMedia: resolved.isPrivateMedia,
          };
          changed = true;
        }
      }
    }
    if (changed) {
      this.emit();
    }
  }

  public checkStale(nowMs: number = Date.now(), staleTimeoutMs: number = STALE_HEARTBEAT_THRESHOLD_MS): boolean {
    let changed = false;
    for (const userId of Object.keys(this.friends)) {
      const entry = this.friends[userId];
      if (entry && entry.status !== "offline") {
        if (nowMs - entry.receivedAt > staleTimeoutMs) {
          this.friends[userId] = {
            ...entry,
            status: "offline",
            activity: null,
          };
          changed = true;
        }
      }
    }
    if (changed) {
      this.emit();
    }
    return changed;
  }

  public reset(): void {
    this.friends = {};
    this.emit();
  }

  public destroy(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    this.listeners.clear();
    this.friends = {};
  }
}

export const socialStore = new SocialStore();

if (typeof window !== "undefined") {
  try {
    subscribeLibrary(() => {
      socialStore.refreshMediaMetadata();
    });
  } catch {
    // Ignore in non-browser or test runner environments
  }
}

// ==========================================
// REACT HOOKS
// ==========================================

export function useFriendPresence(userId: string): FriendPresenceEntry | undefined {
  return useSyncExternalStore(
    (onStoreChange) => socialStore.subscribe(onStoreChange),
    () => socialStore.getFriend(userId),
    () => undefined,
  );
}

export function useAllFriendsPresence(): Record<string, FriendPresenceEntry> {
  return useSyncExternalStore(
    (onStoreChange) => socialStore.subscribe(onStoreChange),
    () => socialStore.getState(),
    () => ({}),
  );
}

/**
 * Isolated progress hook for a friend's active playback (§37).
 * Avoids re-rendering parent components or friend rows every frame.
 */
export function useFriendProgress(userId: string): {
  positionMs: number;
  durationMs: number;
  percent: number;
  formattedCurrent: string;
  formattedDuration: string;
} {
  const presence = useFriendPresence(userId);
  const activity = presence?.activity;
  const isPlaying = activity?.playing && presence?.status === "listening";

  const [positionMs, setPositionMs] = useState(() => interpolateFriendPosition(activity));

  useEffect(() => {
    setPositionMs(interpolateFriendPosition(activity));
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setPositionMs(interpolateFriendPosition(activity));
    }, 500);

    return () => clearInterval(interval);
  }, [activity, isPlaying]);

  const durationMs = activity?.durationMs || 0;
  const percent = durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  return {
    positionMs,
    durationMs,
    percent,
    formattedCurrent: formatDurationMs(positionMs),
    formattedDuration: formatDurationMs(durationMs),
  };
}
