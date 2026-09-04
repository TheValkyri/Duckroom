import { useEffect, useState, useSyncExternalStore } from "react";
import {
  albums,
  librarySyncError,
  librarySyncStatus,
  notifyLibrarySubscribers,
  subscribeLibrary,
  tracks,
  videos,
  type Album,
  type LibrarySyncStatus,
  type Track,
  type Video,
} from "../data/library";

type LibraryStoreState = {
  tracks: Track[];
  albums: Album[];
  videos: Video[];
  /** Trạng thái hydrate canonical — dùng để phân biệt "đang tải" với
   *  "thư viện thật sự trống" (WP3 2026-09-04). */
  status: LibrarySyncStatus;
  error: string | null;
  refresh: () => void;
};

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

export function useLibrary(): LibraryStoreState {
  const [hydrated, setHydrated] = useState(isClientHydrated);

  useEffect(() => {
    if (!isClientHydrated) {
      isClientHydrated = true;
      setHydrated(true);
      notifyLibrarySubscribers();
    }
  }, []);

  return useSyncExternalStore(subscribeLibrary, getSnapshot, getServerSnapshot);
}
