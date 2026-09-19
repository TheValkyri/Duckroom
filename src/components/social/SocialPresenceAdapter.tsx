import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../../lib/useAuth";
import { useSocialProfile } from "../../lib/social/profile-context";
import { usePlayer } from "../../lib/player";
import { socialPresencePublisher } from "../../lib/social/social-presence";
import { socialSubscriptions } from "../../lib/social/social-subscriptions";
import { socialStore } from "../../lib/social/social-store";
import { listFriends } from "../../lib/social";

/**
 * SocialPresenceAdapter (§27, §28).
 * Observes player facts and multi-tab arbitration leadership to publish
 * presence state and broadcast low-latency playback activity.
 * Does NOT touch player-broadcast.ts or own player transport.
 */
export function SocialPresenceAdapter() {
  const { user, isLoggedIn } = useAuth();
  const { profile } = useSocialProfile();
  const { tabRole, isPlaying, current, audioRef } = usePlayer();

  const prevIsPlaying = useRef(isPlaying);
  const prevTrackId = useRef<string | undefined>(current?.id);
  const prevTabRole = useRef(tabRole);

  const getPositionMs = useCallback(() => {
    const rawPosSec = audioRef?.current?.currentTime ?? 0;
    return Math.round(rawPosSec * 1000);
  }, [audioRef]);

  // Initialize publisher and sync friend subscriptions on login
  useEffect(() => {
    if (!isLoggedIn || !user?.id) {
      socialPresencePublisher.destroy();
      socialSubscriptions.cleanup();
      socialStore.reset();
      return;
    }

    socialPresencePublisher.init(user.id);

    // Initial fetch of friends to establish subscriptions
    listFriends()
      .then((friends) => {
        const friendIds = friends.map((f) => f.userId);
        socialSubscriptions.syncFriends(friendIds);
      })
      .catch((err) => {
        console.warn("[SocialPresenceAdapter] Could not sync initial friend subscriptions:", err);
      });

    return () => {
      socialPresencePublisher.destroy();
      socialSubscriptions.cleanup();
      socialStore.reset();
    };
  }, [isLoggedIn, user?.id]);

  // Listen to audio element events (seeked) to broadcast immediately without waiting for heartbeat
  useEffect(() => {
    const audioEl = audioRef?.current;
    if (!audioEl || !isLoggedIn || !user?.id || tabRole !== "leader") return;

    const notifySeeked = () => {
      const positionMs = Math.round(audioEl.currentTime * 1000);
      socialPresencePublisher.updateState({
        userId: user.id,
        tabRole,
        isPlaying,
        currentTrack: current ? { id: current.id, albumId: current.albumId, duration: current.duration } : null,
        positionMs,
        getPositionMs,
        presenceVisibility: profile?.presenceVisibility ?? "friends",
        listeningVisibility: profile?.listeningVisibility ?? "friends",
      });
    };

    audioEl.addEventListener("seeked", notifySeeked);
    return () => {
      audioEl.removeEventListener("seeked", notifySeeked);
    };
  }, [
    audioRef,
    isLoggedIn,
    user?.id,
    tabRole,
    isPlaying,
    current,
    profile?.presenceVisibility,
    profile?.listeningVisibility,
    getPositionMs,
  ]);

  // Update presence state on player state changes
  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;

    const positionMs = getPositionMs();

    socialPresencePublisher.updateState({
      userId: user.id,
      tabRole,
      isPlaying,
      currentTrack: current ? { id: current.id, albumId: current.albumId, duration: current.duration } : null,
      positionMs,
      getPositionMs,
      presenceVisibility: profile?.presenceVisibility ?? "friends",
      listeningVisibility: profile?.listeningVisibility ?? "friends",
    });

    prevIsPlaying.current = isPlaying;
    prevTrackId.current = current?.id;
    prevTabRole.current = tabRole;
  }, [
    isLoggedIn,
    user?.id,
    tabRole,
    isPlaying,
    current,
    profile?.presenceVisibility,
    profile?.listeningVisibility,
    getPositionMs,
  ]);

  return null;
}
