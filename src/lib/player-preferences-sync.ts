import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "./member-data";

/**
 * PHASE 5/7 — Member preference ↔ player runtime sync (audit fix #1).
 *
 * Before this module the user_preferences row existed but the player never
 * read it: volume/crossfade/ReplayGain-mode lived in component state +
 * localStorage, so a Member's settings did not follow the account across
 * devices. This module closes that loop:
 *
 *   login → hydrate()  : GET user_preferences → apply to engine setters
 *   change → report()  : debounce-persist partial deltas back to the server
 *
 * Safety rules:
 * - Writes to the server happen ONLY after a successful hydrate (no echo of
 *   fabricated defaults for users who never saved anything).
 * - Guests are untouched — their behavior stays localStorage/session-local.
 * - All timers are injectable; the policy is unit-testable with fake timers.
 */

export interface PlayerPreferenceAppliers {
  setVolume: (v: number) => void;
  setCrossfade: (v: number) => void;
  setReplayGainMode: (mode: "off" | "track" | "album") => void;
}

/** Applies a server row onto live player setters. Pure side-effect shell. */
export function applyServerPreferences(prefs: UserPreferences, appliers: PlayerPreferenceAppliers): void {
  const safe = { ...DEFAULT_USER_PREFERENCES, ...prefs };
  appliers.setVolume(Math.min(1, Math.max(0, Number(safe.volume))));
  appliers.setCrossfade(Math.min(10, Math.max(0, Math.round(Number(safe.crossfadeSeconds)))));
  if (safe.replaygainMode === "track" || safe.replaygainMode === "album" || safe.replaygainMode === "off") {
    appliers.setReplayGainMode(safe.replaygainMode);
  }
}

export interface PreferenceDelta {
  volume?: number;
  crossfadeSeconds?: number;
  replaygainMode?: "off" | "track" | "album";
}

export function createPreferencesSync(deps: {
  get: () => Promise<UserPreferences>;
  save: (delta: PreferenceDelta) => Promise<unknown>;
  apply: (prefs: UserPreferences) => void;
  delayMs?: number;
}): {
  hydrate(): Promise<boolean>;
  report(delta: PreferenceDelta): void;
  flush(): void;
  cancel(): void;
  isHydrated(): boolean;
} {
  let hydrated = false;
  let hydrating = false;
  let pending: PreferenceDelta | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function hydrate(): Promise<boolean> {
    if (hydrated || hydrating) return hydrated;
    hydrating = true;
    try {
      const prefs = await deps.get();
      deps.apply(prefs ?? DEFAULT_USER_PREFERENCES);
      hydrated = true;
    } catch {
      // Server unreachable / auth expired — stay unhydrated so we NEVER write
      // fabricated defaults over a row we could not read.
      hydrated = false;
    } finally {
      hydrating = false;
    }
    return hydrated;
  }

  function fire() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!hydrated || !pending) return;
    const delta = pending;
    pending = null;
    void deps.save(delta).catch(() => undefined); // best-effort by design
  }

  return {
    hydrate,
    report(delta) {
      if (!hydrated) return; // no echo-writes before hydration succeeds
      pending = { ...(pending ?? {}), ...delta };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, deps.delayMs ?? 2000);
    },
    flush: fire,
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    isHydrated: () => hydrated,
  };
}
