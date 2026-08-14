import { useSyncExternalStore } from "react";
import { albums, subscribeLibrary, tracks, videos, type Album, type Track, type Video } from "../data/library";

type LibraryStoreState = {
  tracks: Track[];
  albums: Album[];
  videos: Video[];
};

const emptySnapshot: LibraryStoreState = {
  tracks: [],
  albums: [],
  videos: [],
};

const initialSnapshot: LibraryStoreState = {
  tracks: [...tracks],
  albums: [...albums],
  videos: [...videos],
};

let currentSnapshot: LibraryStoreState = initialSnapshot;

let lastSnapshotVersion = -1;
let currentSnapshotVersion = 0;

subscribeLibrary(() => {
  currentSnapshotVersion++;
});

function getSnapshot(): LibraryStoreState {
  if (typeof window === "undefined") {
    return initialSnapshot;
  }
  if (lastSnapshotVersion !== currentSnapshotVersion) {
    lastSnapshotVersion = currentSnapshotVersion;
    currentSnapshot = { tracks: [...tracks], albums: [...albums], videos: [...videos] };
  }
  return currentSnapshot;
}

const getServerSnapshot = (): LibraryStoreState => initialSnapshot;

export function useLibrary(): LibraryStoreState {
  return useSyncExternalStore(
    subscribeLibrary,
    getSnapshot,
    getServerSnapshot
  );
}
