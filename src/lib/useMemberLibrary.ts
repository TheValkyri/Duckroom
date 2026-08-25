import { useCallback, useEffect, useState } from "react";
import {
  addTrackToPlaylistServer,
  appendPlaybackHistoryServer,
  createPlaylistServer,
  deletePlaylistServer,
  listUserLibraryServer,
  removeTrackFromPlaylistServer,
  renamePlaylistServer,
  reorderPlaylistServer,
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
      if (!data || typeof data !== "object") {
        setState(emptyState);
        return;
      }
      setState({
        favorites: new Set((Array.isArray(data.favorites) ? data.favorites : []).map((row: any) => row.track_id)),
        playlists: (Array.isArray(data.playlists) ? data.playlists : []) as MemberPlaylist[],
        history: (Array.isArray(data.history) ? data.history : []) as MemberLibraryState["history"],
        playbackState: (data.playbackState ?? null) as MemberLibraryState["playbackState"],
      });
    } catch (err: any) {
      console.error("[Duckroom Member Library] Failed to load user library:", err);
      setState(emptyState);
      const isAuthError =
        err?.status === 401 ||
        err?.message?.includes("401") ||
        err?.message?.includes("Unauthorized") ||
        err?.message?.includes("Member session is required") ||
        err?.message?.includes("[SERVER_CONFIG]");

      if (isAuthError) {
        setError("Không thể đồng bộ thư viện cá nhân do lỗi xác thực quyền thành viên.");
      } else {
        setError(err instanceof Error ? err.message : "Không thể tải thư viện cá nhân.");
      }
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
      const favorite = !state.favorites?.has?.(trackId);
      setState((current) => {
        const next = new Set(current.favorites || []);
        if (favorite) next.add(trackId);
        else next.delete(trackId);
        return { ...current, favorites: next };
      });
      try {
        await toggleFavoriteServer({ data: { trackId, favorite } });
      } catch (err) {
        // Rollback on failure
        setState((current) => {
          const next = new Set(current.favorites || []);
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

  /** §12.2 Rename — optimistic local update, rollback on server failure. */
  const renamePlaylist = useCallback(async (playlistId: string, name: string) => {
    let previous: string | null = null;
    setState((current) => ({
      ...current,
      playlists: current.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        previous = p.name;
        return { ...p, name };
      }),
    }));
    try {
      await renamePlaylistServer({ data: { playlistId, name } });
    } catch (err) {
      if (previous !== null) {
        setState((current) => ({
          ...current,
          playlists: current.playlists.map((p) => (p.id === playlistId ? { ...p, name: previous as string } : p)),
        }));
      }
      throw err;
    }
  }, []);

  const addToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      await addTrackToPlaylistServer({ data: { playlistId, trackId } });
      await refresh();
    },
    [refresh],
  );

  /**
   * §12.2 Reorder — optimistic local move with exact rollback. The server
   * re-validates membership, so a stale client list fails safely instead of
   * silently corrupting positions.
   */
  const reorderPlaylist = useCallback(async (playlistId: string, orderedTrackIds: string[]) => {
    let previousOrder: string[] | null = null;
    setState((current) => ({
      ...current,
      playlists: current.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        previousOrder = p.tracks.map((t) => t.track_id);
        return {
          ...p,
          tracks: orderedTrackIds
            .map((track_id, position) => {
              const existing = p.tracks.find((t) => t.track_id === track_id);
              return existing ? { ...existing, position } : null;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null),
        };
      }),
    }));
    try {
      await reorderPlaylistServer({ data: { playlistId, orderedTrackIds } });
    } catch (err) {
      if (previousOrder) {
        setState((current) => ({
          ...current,
          playlists: current.playlists.map((p) =>
            p.id === playlistId && previousOrder
              ? {
                  ...p,
                  tracks: previousOrder
                    .map((track_id, position) => {
                      const existing = p.tracks.find((t) => t.track_id === track_id);
                      return existing ? { ...existing, position } : null;
                    })
                    .filter((t): t is NonNullable<typeof t> => t !== null),
                }
              : p,
          ),
        }));
      }
      throw err;
    }
  }, []);

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
    renamePlaylist,
    reorderPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    savePlaybackState,
    appendPlaybackHistory,
  };
}
