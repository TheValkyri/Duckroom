import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  albums,
  librarySyncError,
  librarySyncStatus,
  notifyLibrarySubscribers,
  subscribeLibrary,
  syncLibraryWithS3,
  tracks,
  videos,
  type Album,
  type LibrarySyncStatus,
  type Track,
  type Video,
} from "../data/library";

export type LibraryStoreState = {
  tracks: Track[];
  albums: Album[];
  videos: Video[];
  /** Trạng thái hydrate canonical — dùng để phân biệt "đang tải" với
   *  "thư viện thật sự trống" (WP3 2026-09-04). */
  status: LibrarySyncStatus;
  error: string | null;
  refresh: () => void;
};

export const MASTER_LIBRARY_QUERY_KEY = ["master-library"] as const;

const initialSnapshot: LibraryStoreState = {
  tracks: [...tracks],
  albums: [...albums],
  videos: [...videos],
  status: librarySyncStatus,
  error: librarySyncError,
  refresh: notifyLibrarySubscribers,
};

let currentSnapshot: LibraryStoreState = initialSnapshot;
let lastSnapshotVersion = -1;
let currentSnapshotVersion = 0;
let isClientHydrated = false;

subscribeLibrary(() => {
  currentSnapshotVersion++;
});

function getSnapshot(): LibraryStoreState {
  if (typeof window === "undefined" || !isClientHydrated) {
    return initialSnapshot;
  }
  if (lastSnapshotVersion !== currentSnapshotVersion) {
    lastSnapshotVersion = currentSnapshotVersion;
    currentSnapshot = {
      tracks: [...tracks],
      albums: [...albums],
      videos: [...videos],
      status: librarySyncStatus,
      error: librarySyncError,
      refresh: notifyLibrarySubscribers,
    };
  }
  return currentSnapshot;
}

const getServerSnapshot = (): LibraryStoreState => initialSnapshot;

function useSafeQueryClient(): QueryClient | null {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

export function useLibrary(): LibraryStoreState {
  const [, setHydrated] = useState(isClientHydrated);
  const queryClient = useSafeQueryClient();

  useEffect(() => {
    if (!isClientHydrated) {
      isClientHydrated = true;
      setHydrated(true);
      notifyLibrarySubscribers();
    }
  }, []);

  const storeState = useSyncExternalStore(subscribeLibrary, getSnapshot, getServerSnapshot);

  // TanStack Query v5 cache consolidation with automatic deduplication & background refetch
  const query = useQuery(
    {
      queryKey: MASTER_LIBRARY_QUERY_KEY,
      queryFn: async () => {
        return await syncLibraryWithS3(true);
      },
      enabled: typeof window !== "undefined" && isClientHydrated && !!queryClient,
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 30, // 30 minutes in memory
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    queryClient ?? undefined,
  );

  const refresh = () => {
    if (queryClient) {
      void queryClient.invalidateQueries({ queryKey: MASTER_LIBRARY_QUERY_KEY });
    }
    notifyLibrarySubscribers();
    void syncLibraryWithS3(true);
  };

  // Derive unified state maintaining seamless backward compatibility
  let derivedStatus: LibrarySyncStatus = storeState.status;
  if (queryClient && query.isFetching && storeState.tracks.length === 0 && storeState.status === "idle") {
    derivedStatus = "syncing";
  } else if (queryClient && query.isError && storeState.tracks.length === 0) {
    derivedStatus = "error";
  }

  const derivedError = queryClient && query.error instanceof Error ? query.error.message : storeState.error;

  return {
    tracks: query.data?.tracks ?? storeState.tracks,
    albums: query.data?.albums ?? storeState.albums,
    videos: query.data?.videos ?? storeState.videos,
    status: derivedStatus,
    error: derivedError,
    refresh,
  };
}
