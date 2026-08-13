import { useEffect, useState, useSyncExternalStore } from "react";
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

let currentSnapshot: LibraryStoreState = {
  tracks,
  albums,
  videos,
};

let lastSnapshotVersion = -1;
let currentSnapshotVersion = 0;

subscribeLibrary(() => {
  currentSnapshotVersion++;
});

function getSnapshot(): LibraryStoreState {
  if (lastSnapshotVersion !== currentSnapshotVersion) {
    lastSnapshotVersion = currentSnapshotVersion;
    currentSnapshot = { tracks: [...tracks], albums: [...albums], videos: [...videos] };
  }
  return currentSnapshot;
}

const getServerSnapshot = (): LibraryStoreState => emptySnapshot;

export function useLibrary(): LibraryStoreState {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const storeState = useSyncExternalStore(
    subscribeLibrary,
    getSnapshot,
    getServerSnapshot
  );

  if (!mounted) {
    return emptySnapshot;
  }

  return storeState;
}
