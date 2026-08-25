import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerPreferences, createPreferencesSync, type PreferenceDelta } from "../lib/player-preferences-sync";
import { DEFAULT_USER_PREFERENCES } from "../lib/member-data";

/**
 * Audit fix #1 — member preferences must reach the player runtime and player
 * changes must persist back. This suite pins the sync policy (hydrate-gate,
 * debounce, merge, no echo-writes) with injectable timers.
 */

describe("applyServerPreferences", () => {
  it("routes every field to its runtime setter", () => {
    const calls: string[] = [];
    applyServerPreferences(
      { theme: "dark", volume: 0.4, crossfadeSeconds: 6, replaygainMode: "album" },
      {
        setVolume: () => calls.push("volume"),
        setCrossfade: () => calls.push("crossfade"),
        setReplayGainMode: () => calls.push("rg"),
      },
    );
    expect(calls).toEqual(["volume", "crossfade", "rg"]);
  });

  it("clamps hostile values before touching the engine", () => {
    const seen: Record<string, unknown> = {};
    applyServerPreferences(
      { ...DEFAULT_USER_PREFERENCES, volume: 9, crossfadeSeconds: -3, replaygainMode: "track" },
      {
        setVolume: (v) => (seen["volume"] = v),
        setCrossfade: (v) => (seen["crossfade"] = v),
        setReplayGainMode: () => {},
      },
    );
    expect(seen["volume"]).toBe(1);
    expect(seen["crossfade"]).toBe(0);
  });
});

describe("createPreferencesSync policy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeDeps() {
    const applied: unknown[] = [];
    const saved: PreferenceDelta[] = [];
    return {
      applied,
      saved,
      deps: {
        get: vi.fn(async () => ({ ...DEFAULT_USER_PREFERENCES, volume: 0.55, replaygainMode: "album" as const })),
        save: vi.fn(async (delta: PreferenceDelta) => {
          saved.push(delta);
        }),
        apply: (prefs: Parameters<typeof applyServerPreferences>[0]) => applied.push(prefs),
        delayMs: 2000,
      },
    };
  }

  it("does NOT write anything before a successful hydrate (no fabricated defaults)", async () => {
    const { deps, saved } = makeDeps();
    deps.get.mockRejectedValueOnce(new Error("offline"));
    const sync = createPreferencesSync(deps);

    await expect(sync.hydrate()).resolves.toBe(false);
    sync.report({ volume: 0.9 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toHaveLength(0);
    expect(sync.isHydrated()).toBe(false);
  });

  it("hydrates once, applies server row, then debounces merged deltas", async () => {
    const { deps, applied, saved } = makeDeps();
    const sync = createPreferencesSync(deps);

    await expect(sync.hydrate()).resolves.toBe(true);
    expect(applied).toHaveLength(1);
    expect(sync.isHydrated()).toBe(true);

    sync.report({ volume: 0.7 });
    sync.report({ replaygainMode: "track", volume: 0.8 }); // merges + resets timer
    expect(saved).toHaveLength(0); // debounce holds
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual([{ volume: 0.8, replaygainMode: "track" }]);
  });

  it("flush() pushes pending deltas immediately; cancel() drops them", async () => {
    const { deps, saved } = makeDeps();
    const sync = createPreferencesSync(deps);
    await sync.hydrate();

    sync.report({ crossfadeSeconds: 5 });
    sync.flush();
    expect(saved).toEqual([{ crossfadeSeconds: 5 }]);

    sync.report({ volume: 0.2 });
    sync.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toHaveLength(1); // cancelled delta never fires
  });

  it("save failures are swallowed (best-effort persistence)", async () => {
    const failing = makeDeps();
    failing.deps.save.mockRejectedValue(new Error("network down"));
    const sync = createPreferencesSync(failing.deps);
    await sync.hydrate();

    sync.report({ volume: 0.3 });
    await vi.advanceTimersByTimeAsync(2000); // must not throw unhandled
    expect(failing.deps.save).toHaveBeenCalledTimes(1); // attempt happened
  });
});
