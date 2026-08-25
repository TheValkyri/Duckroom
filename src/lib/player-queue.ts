/**
 * Duckroom Transport Core — pure queue/transport decision logic.
 *
 * Master Plan §11.1/§11.4: transport semantics MUST live outside React so the
 * audio engine never depends on render pressure AND every prev/next/shuffle/
 * crossfade rule is unit-testable against real production code.
 *
 * This module has ZERO React/DOM/network dependencies.
 */

export type RepeatMode = "off" | "all" | "one";

export const PREV_RESTART_THRESHOLD_SECONDS = 3;
export const CROSSFADE_MIN_SECONDS = 0;
export const CROSSFADE_MAX_SECONDS = 10;
export const HANDOVER_GRACE_SECONDS = 0.15;

export type TransportDecision =
  { action: "restart-current" } | { action: "advance"; index: number } | { action: "stop" };

/**
 * §11.4 previous-button semantics: restarting the current track wins whenever
 * meaningful playback has begun, otherwise walk backwards (wrapping).
 */
export function decidePrev(
  positionSeconds: number,
  currentIndex: number,
  queueLength: number,
  restartThresholdSeconds: number = PREV_RESTART_THRESHOLD_SECONDS,
): TransportDecision {
  if (positionSeconds > restartThresholdSeconds) return { action: "restart-current" };
  if (queueLength <= 0) return { action: "stop" };
  return { action: "advance", index: (currentIndex - 1 + queueLength) % queueLength };
}

/**
 * §11.3 next/repeat semantics:
 * - auto-next under repeat=one replays the current track;
 * - manual next always advances (wrapping);
 * - repeat=all wraps the queue;
 * - otherwise the queue ends and playback stops.
 */
export function decideNext(
  currentIndex: number,
  queueLength: number,
  repeat: RepeatMode,
  manual: boolean,
): TransportDecision {
  if (!manual && repeat === "one") return { action: "restart-current" };
  if (currentIndex + 1 < queueLength) return { action: "advance", index: currentIndex + 1 };
  if (repeat === "all" || manual) return { action: "advance", index: 0 };
  return { action: "stop" };
}

/** Keeps the active index inside a possibly-shrinking queue (-1 = nothing left). */
export function clampIndexToQueue(index: number, queueLength: number): number {
  if (queueLength <= 0) return -1;
  return Math.max(0, Math.min(index, queueLength - 1));
}

/** Index remap after a queue reorder so the playing row stays the playing row. */
export function computeIndexAfterMove(from: number, to: number, currentIndex: number): number {
  if (currentIndex === from) return to;
  if (from < currentIndex && to >= currentIndex) return currentIndex - 1;
  if (from > currentIndex && to <= currentIndex) return currentIndex + 1;
  return currentIndex;
}

/** Fisher–Yates with injectable RNG (deterministic in tests), optionally keeping one item first. */
export function shuffledWithRng<T>(items: readonly T[], rng: () => number, keepFirst?: T): T[] {
  const rest = items.filter((x) => x !== keepFirst);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmpI = rest[i] as T;
    rest[i] = rest[j] as T;
    rest[j] = tmpI;
  }
  return keepFirst ? [keepFirst, ...rest] : [...rest];
}

export function shuffled<T>(items: readonly T[], keepFirst?: T): T[] {
  return shuffledWithRng(items, Math.random, keepFirst);
}

export function clampCrossfade(value: number): number {
  return Math.max(CROSSFADE_MIN_SECONDS, Math.min(CROSSFADE_MAX_SECONDS, value));
}

/**
 * Crossfade window shrinks for very short tracks so the fade never exceeds a
 * third of the runtime (§11.3 gapless best-effort without swallowing songs).
 */
export function crossfadeWindowSeconds(crossfadeSetting: number, trackDurationSeconds: number): number {
  const safeDuration = Number.isFinite(trackDurationSeconds) && trackDurationSeconds > 0 ? trackDurationSeconds : 1;
  return Math.min(clampCrossfade(crossfadeSetting), Math.floor(safeDuration / 3));
}

/**
 * Equal-power (constant acoustic energy) crossfade gains: cos²+sin² = 1.
 * `progress` ∈ [0, 1] across the fade window.
 */
export function equalPowerGains(progress: number): { gainPrimary: number; gainSecondary: number } {
  const p = Math.max(0, Math.min(1, progress));
  return {
    gainPrimary: Math.cos(p * 0.5 * Math.PI),
    gainSecondary: Math.sin(p * 0.5 * Math.PI),
  };
}

/** Clamped volume application shared by both channels (defensive vs float drift). */
export function clampGain(volume: number, gain: number): number {
  return Math.max(0, Math.min(1, volume * gain));
}

// ---------------------------------------------------------------------------
// ReplayGain (Master Plan §11.5)
// ---------------------------------------------------------------------------

export type ReplayGainMode = "off" | "track" | "album";
/** Safety preamp applied on top of the chosen gain. Default neutral (§11.6 spirit). */
export const REPLAYGAIN_DEFAULT_PREAMP_DB = 0;
/** Positive gains above this are treated as suspicious masters and clamped. */
export const REPLAYGAIN_MAX_LINEAR = 1;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Linear multiplier for the current ReplayGain mode.
 * - off            → 1
 * - track          → trackGain + preamp (falls back to album gain when the
 *                    master lacks a track tag — standard RG behavior).
 * - album          → albumGain + preamp (falls back to track gain likewise).
 *
 * The result is clamped to [0, REPLAYGAIN_MAX_LINEAR]: HTMLMediaElement
 * volume cannot exceed 1.0 without clipping, so positive corrections are
 * capped rather than amplified. Unknown tags yield 1 (neutral), never guess.
 */
export function replayGainMultiplier(
  mode: ReplayGainMode,
  trackGainDb: number | null | undefined,
  albumGainDb: number | null | undefined,
  preampDb: number = REPLAYGAIN_DEFAULT_PREAMP_DB,
): number {
  if (mode === "off") return 1;
  let db: number | null | undefined;
  if (mode === "track") db = trackGainDb ?? albumGainDb ?? null;
  else db = albumGainDb ?? trackGainDb ?? null;
  if (db == null || !Number.isFinite(db)) return 1;
  const linear = dbToLinear(db + preampDb);
  if (!Number.isFinite(linear) || linear <= 0) return 0;
  return Math.min(REPLAYGAIN_MAX_LINEAR, linear);
}
