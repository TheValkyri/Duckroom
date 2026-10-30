import { describe, expect, it, beforeEach } from "vitest";
import { getSavedVisualizerMode, saveVisualizerMode, type VisualizerMode } from "../lib/visualizer-storage";

describe("Visualizer Modes & Persistence (Visuals & Lyrics 2.0)", () => {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    clear: () => store.clear(),
    removeItem: (k: string) => store.delete(k),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as any).window = {
      localStorage: mockLocalStorage,
    };
  });

  it("defaults to 'bars' mode when no mode is saved in localStorage", () => {
    expect(getSavedVisualizerMode()).toBe("bars");
  });

  it("persists and reads 'bars' visualizer mode correctly", () => {
    saveVisualizerMode("bars");
    expect(getSavedVisualizerMode()).toBe("bars");
  });

  it("safely falls back to 'bars' mode if localStorage has an invalid or deprecated value", () => {
    mockLocalStorage.setItem("duckroom.visualizer.mode", "wave");
    expect(getSavedVisualizerMode()).toBe("bars");
    mockLocalStorage.setItem("duckroom.visualizer.mode", "kinetic-3d");
    expect(getSavedVisualizerMode()).toBe("bars");
    mockLocalStorage.setItem("duckroom.visualizer.mode", "particles");
    expect(getSavedVisualizerMode()).toBe("bars");
    mockLocalStorage.setItem("duckroom.visualizer.mode", "invalid-mode-value");
    expect(getSavedVisualizerMode()).toBe("bars");
  });
});
