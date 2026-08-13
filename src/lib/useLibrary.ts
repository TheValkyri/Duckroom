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

export function useLibrary(): LibraryStoreState {
  return useSyncExternalStore(
    subscribeLibrary,
    () => ({ tracks, albums, videos }),
    () => emptySnapshot
  );
}
