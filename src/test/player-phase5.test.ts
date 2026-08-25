import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGuestSession,
  createPlaybackPersister,
  GUEST_QUEUE_ID_LIMIT,
  readGuestSession,
  resolveRestoreTarget,
  writeGuestSession,
} from "../lib/player-persistence";
import { replayGainMultiplier } from "../lib/player-queue";

describe("player-persistence (Phase 5.2)", () => {
  describe("guest session mirror", () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      // Node test env has no window/localStorage — stub a minimal in-memory one.
      store.clear();
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("round-trips trackId, position and capped queue ids", () => {
      writeGuestSession({
        trackId: "t1",
        positionSeconds: 42,
        queue: Array.from({ length: GUEST_QUEUE_ID_LIMIT + 50 }, (_, i) => `q${i}`),
      });
      const s = readGuestSession();
      expect(s?.trackId).toBe("t1");
      expect(s?.positionSeconds).toBe(42);
      expect(s?.queueIds).toHaveLength(GUEST_QUEUE_ID_LIMIT);
    });

    it("returns null on corrupt payloads instead of throwing", () => {
      window.localStorage.setItem("duckroom.player.session", "{not json");
      expect(readGuestSession()).toBeNull();
      window.localStorage.setItem("duckroom.player.session", JSON.stringify({ garbage: true }));
      expect(readGuestSession()).toBeNull();
    });
  });

  describe("debounced persister", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("coalesces rapid notifications into one write after the debounce", () => {
      const save = vi.fn();
      const p = createPlaybackPersister(save, 3000);
      p.notify({ trackId: "a", positionSeconds: 1 });
      p.notify({ trackId: "a", positionSeconds: 2 });
      p.notify({ trackId: "a", positionSeconds: 3 });
      vi.advanceTimersByTime(2999);
      expect(save).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith({ trackId: "a", positionSeconds: 3 });
    });

    it("flush() writes immediately (hidden-tab/unload path)", () => {
      const save = vi.fn();
      const p = createPlaybackPersister(save, 3000);
      p.notify({ trackId: "b", positionSeconds: 9 });
      p.flush();
      expect(save).toHaveBeenCalledWith({ trackId: "b", positionSeconds: 9 });
      // Double flush is a no-op.
      p.flush();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("cancel() drops the pending event", () => {
      const save = vi.fn();
      const p = createPlaybackPersister(save, 3000);
      p.notify({ trackId: "c", positionSeconds: 5 });
      p.cancel();
      vi.advanceTimersByTime(10000);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("restore resolver", () => {
    const library = [
      { id: "t1", duration: 200 },
      { id: "t2", duration: 100 },
    ];

    it("restores a known track at its saved position", () => {
      expect(resolveRestoreTarget({ track_id: "t1", position_seconds: 33 }, library)).toEqual({
        trackId: "t1",
        positionSeconds: 33,
      });
    });

    it("rejects unknown tracks and non-finite positions", () => {
      expect(resolveRestoreTarget({ track_id: "ghost", position_seconds: 10 }, library)).toBeNull();
      expect(resolveRestoreTarget({ track_id: "t1", position_seconds: Number.NaN }, library)).toEqual({
        trackId: "t1",
        positionSeconds: 0,
      });
      expect(resolveRestoreTarget(null, library)).toBeNull();
    });

    it("restarts finished tracks from zero rather than resuming the last second", () => {
      expect(resolveRestoreTarget({ track_id: "t2", position_seconds: 99.6 }, library)).toEqual({
        trackId: "t2",
        positionSeconds: 0,
      });
    });
  });
});

describe("replayGainMultiplier (Master Plan §11.5)", () => {
  it("off mode and unknown tags are neutral (never fabricated)", () => {
    expect(replayGainMultiplier("off", -7, -8)).toBe(1);
    expect(replayGainMultiplier("track", null, null)).toBe(1);
    expect(replayGainMultiplier("album", Number.NaN, undefined)).toBe(1);
  });

  it("track mode applies track gain with preamp; album mode applies album gain", () => {
    // -7 dB → 10^(-7/20) ≈ 0.4467
    expect(replayGainMultiplier("track", -7, -9)).toBeCloseTo(Math.pow(10, -7 / 20), 5);
    expect(replayGainMultiplier("album", -7, -9)).toBeCloseTo(Math.pow(10, -9 / 20), 5);
  });

  it("falls back to the other tag when the preferred one is missing", () => {
    expect(replayGainMultiplier("track", null, -6)).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    expect(replayGainMultiplier("album", -4, null)).toBeCloseTo(Math.pow(10, -4 / 20), 5);
  });

  it("clamps positive corrections to unity to avoid clipping at element level", () => {
    expect(replayGainMultiplier("track", +3, +3)).toBe(1);
    expect(replayGainMultiplier("track", +12, null)).toBe(1);
  });
});
