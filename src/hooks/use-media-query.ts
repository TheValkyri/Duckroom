import * as React from "react";

/**
 * useMediaQuery — SSR-safe matchMedia hook.
 *
 * Returns `false` during SSR and the first client frame (no hydration
 * mismatch), then synchronizes with the real query. Used for
 * interaction-model switches (QueueSheet vs QueuePanel, TrackRow inline
 * actions vs actions sheet) — never for data.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Touch/phone layout contract: below the `md` (768px) breakpoint. */
export function useIsPhoneLayout(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
