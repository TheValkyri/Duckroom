import { useCallback, useEffect, useState } from "react";
import {
  addTrackToPlaylistServer,
  appendPlaybackHistoryServer,
  createPlaylistServer,
  deletePlaylistServer,
  listUserLibraryServer,
  removeTrackFromPlaylistServer,
  savePlaybackStateServer,
  toggleFavoriteServer,
} from "./member-data";
import { getAccessToken } from "./useAuth";

export type MemberPlaylist = {
  id: string;
  name: string;
  description: string | null;
  cover_storage_key: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  tracks: { track_id: string; position: number; added_at: string }[];
};

export type MemberLibraryState = {
  favorites: Set<string>;
  playlists: MemberPlaylist[];
  history: {
    id: number;
    track_id: string;
    started_at: string;
    ended_at: string | null;
    seconds_played: number;
    completed: boolean;
  }[];
  playbackState: {
    track_id: string | null;
    position_seconds: number;
    updated_at: string;
  } | null;
};

const emptyState: MemberLibraryState = {
  favorites: new Set(),
  playlists: [],
  history: [],
  playbackState: null,
};

export function useMemberLibrary(enabled = true) {
  const [state, setState] = useState<MemberLibraryState>(emptyState);
  const [isLoading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setState(emptyState);
        return;
      }
      const data = await listUserLibraryServer();
      setState({
        favorites: new Set(data.favorites.map((row: any) => row.track_id)),
        playlists: data.playlists as MemberPlaylist[],
        history: data.history as MemberLibraryState["history"],
        playbackState: data.playbackState as MemberLibraryState["playbackState"],
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Không thể tải thư viện cá nhân.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFavorite = useCallback(
    async (trackId: string) => {
      if (!enabled) return;
      const favorite = !state.favorites.has(trackId);
      setState((current) => {
        const next = new Set(current.favorites);
        if (favorite) next.add(trackId);
        else next.delete(trackId);
        return { ...current, favorites: next };
      });
      try {
        await toggleFavoriteServer({ data: { trackId, favorite } });
      } catch (err) {
        // Rollback on failure
        setState((current) => {
          const next = new Set(current.favorites);
          if (favorite) next.delete(trackId);
          else next.add(trackId);
          return { ...current, favorites: next };
        });
        throw err;
      }
    },
    [enabled, state.favorites],
  );

  const createPlaylist = useCallback(
    async (name: string, description?: string | null) => {
      const playlist = await createPlaylistServer({ data: { name, description: description ?? null } });
      await refresh();
      return playlist;
    },
    [refresh],
  );

  const deletePlaylist = useCallback(async (playlistId: string) => {
    await deletePlaylistServer({ data: { playlistId } });
    setState((current) => ({
      ...current,
      playlists: current.playlists.filter((playlist) => playlist.id !== playlistId),
    }));
  }, []);

  const addToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      await addTrackToPlaylistServer({ data: { playlistId, trackId } });
      await refresh();
    },
    [refresh],
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      await removeTrackFromPlaylistServer({ data: { playlistId, trackId } });
      await refresh();
    },
    [refresh],
  );

  const savePlaybackState = useCallback(
    async (trackId: string | null, positionSeconds: number) => {
      if (!enabled) return;
      try {
        await savePlaybackStateServer({ data: { trackId, positionSeconds } });
      } catch (err) {
        console.warn("Playback state save failed", err);
      }
    },
    [enabled],
  );

  const appendPlaybackHistory = useCallback(
    async (payload: {
      trackId: string;
      startedAt: string;
      endedAt?: string | null;
      secondsPlayed: number;
      completed: boolean;
    }) => {
      if (!enabled) return;
      try {
        await appendPlaybackHistoryServer({ data: payload });
      } catch (err) {
        console.warn("Playback history save failed", err);
      }
    },
    [enabled],
  );

  return {
    ...state,
    isLoading,
    error,
    refresh,
    toggleFavorite,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    savePlaybackState,
    appendPlaybackHistory,
  };
}
