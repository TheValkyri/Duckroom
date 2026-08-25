import { describe, expect, it } from "vitest";
import {
  clampCrossfade,
  clampIndexToQueue,
  computeIndexAfterMove,
  crossfadeWindowSeconds,
  decideNext,
  decidePrev,
  equalPowerGains,
  shuffledWithRng,
} from "../lib/player-queue";

/**
 * REAL production tests — these import and exercise src/lib/player-queue.ts,
 * the module the PlayerProvider actually calls for every transport decision.
 * (The previous version of this file re-implemented the logic inline and
 * therefore protected nothing.)
 */
describe("Player V2 Semantics & State Invariants (production player-queue.ts)", () => {
  describe("decidePrev — §11.4 previous-button semantics", () => {
    it("restarts current track when playback position > threshold (3s)", () => {
      expect(decidePrev(14.5, 2, 5)).toEqual({ action: "restart-current" });
      expect(decidePrev(3.01, 0, 5)).toEqual({ action: "restart-current" });
    });

    it("steps to previous track when position <= threshold", () => {
      const d = decidePrev(2.1, 2, 5);
      expect(d).toEqual({ action: "advance", index: 1 });
      // exactly at threshold counts as "just started" → previous track
      expect(decidePrev(3, 4, 9)).toEqual({ action: "advance", index: 3 });
    });

    it("wraps to the last track when stepping back from the first", () => {
      expect(decidePrev(1.0, 0, 4)).toEqual({ action: "advance", index: 3 });
      expect(decidePrev(0, 0, 1)).toEqual({ action: "advance", index: 0 });
    });

    it("supports a custom restart threshold", () => {
      // position 6s is below a generous 10s threshold → walk backwards
      expect(decidePrev(6, 1, 3, 10)).toEqual({ action: "advance", index: 0 });
      // position beyond the threshold → restart current track
      expect(decidePrev(11, 1, 3, 10)).toEqual({ action: "restart-current" });
    });

    it("stops on an empty queue instead of crashing", () => {
      expect(decidePrev(0, 0, 0)).toEqual({ action: "stop" });
    });
  });

  describe("decideNext — next/repeat semantics", () => {
    it("advances normally through the queue", () => {
      expect(decideNext(0, 5, "off", true)).toEqual({ action: "advance", index: 1 });
      expect(decideNext(2, 5, "all", false)).toEqual({ action: "advance", index: 3 });
    });

    it("auto-next under repeat=one replays the current track", () => {
      expect(decideNext(3, 8, "one", false)).toEqual({ action: "restart-current" });
    });

    it("manual next under repeat=one still advances (user override)", () => {
      expect(decideNext(3, 8, "one", true)).toEqual({ action: "advance", index: 4 });
    });

    it("wraps to index 0 under repeat=all at queue end", () => {
      expect(decideNext(4, 5, "all", false)).toEqual({ action: "advance", index: 0 });
    });

    it("stops playback at queue end when repeat=off and not manual", () => {
      expect(decideNext(4, 5, "off", false)).toEqual({ action: "stop" });
    });

    it("manual next wraps even when repeat=off (explicit user intent)", () => {
      expect(decideNext(4, 5, "off", true)).toEqual({ action: "advance", index: 0 });
    });
  });

  describe("clampIndexToQueue — shrinking-queue safety", () => {
    it("keeps valid indexes untouched", () => {
      expect(clampIndexToQueue(0, 5)).toBe(0);
      expect(clampIndexToQueue(4, 5)).toBe(4);
    });

    it("clamps out-of-range indexes into the queue", () => {
      expect(clampIndexToQueue(7, 5)).toBe(4);
      expect(clampIndexToQueue(-3, 5)).toBe(0);
    });

    it("returns -1 for an empty queue (no current track possible)", () => {
      expect(clampIndexToQueue(0, 0)).toBe(-1);
      expect(clampIndexToQueue(10, 0)).toBe(-1);
    });
  });

  describe("computeIndexAfterMove — queue reorder remap", () => {
    it("follows the moved item when IT was playing", () => {
      expect(computeIndexAfterMove(2, 0, 2)).toBe(0);
      expect(computeIndexAfterMove(0, 4, 0)).toBe(4);
    });

    it("shifts correctly when a row above moves past the playhead", () => {
      expect(computeIndexAfterMove(0, 3, 2)).toBe(1);
      expect(computeIndexAfterMove(4, 1, 2)).toBe(3);
    });

    it("leaves unrelated indexes untouched", () => {
      expect(computeIndexAfterMove(3, 4, 1)).toBe(1);
    });
  });

  describe("shuffledWithRng — deterministic shuffle with injected RNG", () => {
    it("preserves all items and keeps the pinned first item first", () => {
      const items = ["a", "b", "c", "d", "e"];
      const result = shuffledWithRng(items, () => 0.42, "c");
      expect(result[0]).toBe("c");
      expect([...result].sort()).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("is deterministic: same seed sequence → identical permutation", () => {
      const items = [1, 2, 3, 4, 5, 6];
      const makeRng = () => {
        let n = 0;
        return () => (n = (n * 37 + 11) % 97) / 97;
      };
      const r1 = shuffledWithRng(items, makeRng());
      const r2 = shuffledWithRng(items, makeRng());
      expect(r1).toEqual(r2);
      expect(r1.length).toBe(items.length);
      expect([...r1].sort()).toEqual([...items].sort());
    });

    it("never mutates the input array", () => {
      const items = [1, 2, 3];
      shuffledWithRng(items, () => 0.5);
      expect(items).toEqual([1, 2, 3]);
    });
  });

  describe("crossfade bounds & curves — §11.3", () => {
    it("strictly clamps crossfade setting to 0–10 seconds", () => {
      expect(clampCrossfade(0)).toBe(0);
      expect(clampCrossfade(5)).toBe(5);
      expect(clampCrossfade(10)).toBe(10);
      expect(clampCrossfade(12)).toBe(10);
      expect(clampCrossfade(-3)).toBe(0);
      expect(clampCrossfade(100)).toBe(10);
    });

    it("shrinks the fade window for short tracks (≤ duration/3)", () => {
      expect(crossfadeWindowSeconds(10, 240)).toBe(10);
      expect(crossfadeWindowSeconds(10, 24)).toBe(8); // floor(24/3)
      expect(crossfadeWindowSeconds(10, 3)).toBe(1);
      expect(crossfadeWindowSeconds(0, 240)).toBe(0);
      expect(crossfadeWindowSeconds(7, NaN)).toBe(0); // unknown duration → no fade window
    });

    it("equal-power gains satisfy constant energy: cos²+sin²=1 across the fade", () => {
      for (const p of [0, 0.15, 0.5, 0.85, 1]) {
        const { gainPrimary, gainSecondary } = equalPowerGains(p);
        expect(gainPrimary ** 2 + gainSecondary ** 2).toBeCloseTo(1, 10);
        expect(gainPrimary).toBeGreaterThanOrEqual(0);
        expect(gainSecondary).toBeGreaterThanOrEqual(0);
      }
      expect(equalPowerGains(0).gainPrimary).toBe(1);
      expect(equalPowerGains(1).gainSecondary).toBeCloseTo(1, 10);
      // Out-of-range progress is clamped defensively
      expect(equalPowerGains(-1).gainPrimary).toBe(1);
      expect(equalPowerGains(2).gainSecondary).toBeCloseTo(1, 10);
    });
  });
});
