import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../supabase-client";
import { socialStore } from "./social-store";
import type { SocialPresencePayload } from "./social-types";

export class SocialSubscriptionManager {
  private channels = new Map<string, RealtimeChannel>();
  private activeFriendIds = new Set<string>();
  private isOnline = true;

  constructor() {
    this.bindNetworkListeners();
  }

  private bindNetworkListeners(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => {
      this.isOnline = true;
      this.reconnectAll();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      // When local network drops, mark peers offline
      this.activeFriendIds.forEach((id) => {
        socialStore.markOffline(id);
      });
    });
  }

  /**
   * Synchronizes subscribed channels with the current list of accepted friend IDs (§11, §20).
   * Unsubscribes from removed/blocked friends and subscribes to newly added friends.
   */
  public syncFriends(friendIds: string[]): void {
    if (typeof window === "undefined") return;

    const desiredIds = new Set(friendIds.map((id) => id.trim()).filter(Boolean));
    this.activeFriendIds = desiredIds;

    // 1. Remove subscriptions for friends no longer accepted or present
    for (const [currentId, channel] of this.channels.entries()) {
      if (!desiredIds.has(currentId)) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // Ignore removal errors
        }
        this.channels.delete(currentId);
        socialStore.markOffline(currentId);
      }
    }

    // 2. Subscribe to new friends' private topics
    for (const friendId of desiredIds) {
      if (!this.channels.has(friendId)) {
        this.subscribeToFriend(friendId);
      }
    }
  }

  private subscribeToFriend(friendId: string): void {
    try {
      const topic = `social:user:${friendId}`;
      const channel = supabase.channel(topic, {
        config: {
          private: true,
        },
      });

      // Listen for presence state sync
      channel.on("presence", { event: "sync" }, () => {
        try {
          const state = channel.presenceState();
          const keys = Object.keys(state);
          if (keys.length === 0) {
            socialStore.markOffline(friendId);
            return;
          }
          for (const key of keys) {
            const presences = state[key] as unknown as SocialPresencePayload[];
            if (presences && presences.length > 0) {
              const latest = presences[presences.length - 1];
              if (latest && latest.userId) {
                socialStore.applyUpdate(latest);
              }
            }
          }
        } catch (err) {
          console.warn(`[SocialSubscription] Failed to process presence sync for ${friendId}:`, err);
        }
      });

      // Listen for presence join
      channel.on("presence", { event: "join" }, ({ newPresences }) => {
        const latest = (newPresences as unknown as SocialPresencePayload[])?.[0];
        if (latest && latest.userId) {
          socialStore.applyUpdate(latest);
        }
      });

      // Listen for presence leave
      channel.on("presence", { event: "leave" }, () => {
        socialStore.markOffline(friendId);
      });

      // Listen for activity broadcasts (heartbeats and live playback position updates)
      channel.on("broadcast", { event: "activity" }, ({ payload }) => {
        if (payload && payload.userId) {
          socialStore.applyUpdate(payload as SocialPresencePayload);
        }
      });

      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn(`[SocialSubscription] Realtime authorization denied or error for ${topic}`);
          socialStore.markOffline(friendId);
        }
      });

      this.channels.set(friendId, channel);
    } catch (err) {
      console.warn(`[SocialSubscription] Channel creation failed for ${friendId}:`, err);
    }
  }

  public removeFriend(friendId: string): void {
    const channel = this.channels.get(friendId);
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignore
      }
      this.channels.delete(friendId);
    }
    this.activeFriendIds.delete(friendId);
    socialStore.markOffline(friendId);
  }

  public reconnectAll(): void {
    if (!this.isOnline) return;
    const currentList = Array.from(this.activeFriendIds);
    this.cleanup();
    this.syncFriends(currentList);
  }

  public cleanup(): void {
    for (const [, channel] of this.channels) {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignore
      }
    }
    this.channels.clear();
    this.activeFriendIds.clear();
  }
}

export const socialSubscriptions = new SocialSubscriptionManager();
