export type VisualizerMode = "bars";

export const VISUALIZER_STORAGE_KEY = "duckroom.visualizer.mode";

export function getSavedVisualizerMode(): VisualizerMode {
  if (typeof window === "undefined" || !window.localStorage) return "bars";
  try {
    const val = window.localStorage.getItem(VISUALIZER_STORAGE_KEY);
    if (val === "bars") {
      return val;
    }
    return "bars";
  } catch {
    return "bars";
  }
}

export function saveVisualizerMode(mode: VisualizerMode): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(VISUALIZER_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
