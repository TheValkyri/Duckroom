import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerEngine, type PlayerEngineState } from "../lib/player-engine";
import type { Track } from "../data/library";

function mkTrack(id: string, duration = 180): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    albumId: "album-1",
    duration,
    trackNo: 1,
    format: "FLAC",
    bitDepth: 24,
    sampleRate: 96,
    sizeMB: 30,
    lyrics: [],
  };
}

function state(engine: ReturnType<typeof createPlayerEngine>): PlayerEngineState {
  return engine.getState();
}

describe("player-engine (Phase 5.1)", () => {
  it("starts from an empty neutral state", () => {
    const e = createPlayerEngine();
    expect(state(e).queue).toHaveLength(0);
    expect(state(e).isPlaying).toBe(false);
    expect(state(e).volume).toBe(0.8);
    expect(state(e).repeat).toBe("off");
  });

  it("playQueue starts playback at the requested index and honors shuffleNow", () => {
    const e = createPlayerEngine();
    const list = [mkTrack("a"), mkTrack("b"), mkTrack("c")];
    e.actions.playQueue(list, 2);
    expect(state(e).index).toBe(2);
    expect(state(e).isPlaying).toBe(true);
    expect(state(e).queue[2]!.id).toBe("c");

    e.actions.playQueue(list, 1, true);
    // Shuffled queue always puts the requested start track first.
    expect(state(e).index).toBe(0);
    expect(state(e).queue[0]!.id).toBe("b");
    expect(state(e).shuffle).toBe(true);
  });

  it("replaceLibrary re-clamps the index on shrinking queues and keeps the current track when present", () => {
    const e = createPlayerEngine();
    e.actions.playQueue([mkTrack("a"), mkTrack("b"), mkTrack("c")], 1);
    e.actions.replaceLibrary([mkTrack("a"), mkTrack("b")]);
    expect(state(e).index).toBe(1);
    // Current track removed entirely → clamp to last valid slot.
    e.actions.replaceLibrary([mkTrack("x"), mkTrack("y")]);
    expect(state(e).index).toBeLessThan(2);
  });

  it("nextIntent manual=true wraps even with repeat=off; auto stops at end", () => {
    const e = createPlayerEngine({ repeat: "off" });
    e.actions.playQueue([mkTrack("a"), mkTrack("b")], 1);
    const auto = e.actions.nextIntent(false);
    expect(auto.action).toBe("stop");
    expect(state(e).isPlaying).toBe(false);
    const manual = e.actions.nextIntent(true);
    expect(manual.action).toBe("advance");
    expect(state(e).index).toBe(0);
  });

  it("nextIntent repeat=one replays the current track automatically but advances manually", () => {
    const e = createPlayerEngine({ repeat: "one" });
    e.actions.playQueue([mkTrack("a"), mkTrack("b")], 0);
    expect(e.actions.nextIntent(false).action).toBe("restart-current");
    expect(state(e).index).toBe(0);
    expect(e.actions.nextIntent(true).action).toBe("advance");
    expect(state(e).index).toBe(1);
  });

  it("prevIntent restarts the current track above the §11.4 threshold and advances below it", () => {
    const e = createPlayerEngine();
    e.actions.playQueue([mkTrack("a"), mkTrack("b")], 1);
    expect(e.actions.prevIntent(10).action).toBe("restart-current");
    const decision = e.actions.prevIntent(1);
    expect(decision.action).toBe("advance");
    expect(state(e).index).toBe(0);
  });

  it("jumpTo moves and plays; moveInQueue remaps the playing row deterministically", () => {
    const e = createPlayerEngine();
    e.actions.playQueue([mkTrack("a"), mkTrack("b"), mkTrack("c")], 0);
    e.actions.jumpTo(2);
    expect(state(e).index).toBe(2);
    // Move the playing row (from=2) to the top → new playing index is 0.
    e.actions.moveInQueue(2, 0);
    expect(state(e).queue[0]!.id).toBe("c");
    expect(state(e).index).toBe(0);
  });

  it("toggleShuffle keeps the current track first; toggling off restores the base order at the same track", () => {
    const e = createPlayerEngine();
    const list = [mkTrack("a"), mkTrack("b"), mkTrack("c"), mkTrack("d")];
    e.actions.playQueue(list, 2);
    e.actions.toggleShuffle();
    expect(state(e).shuffle).toBe(true);
    expect(state(e).queue[0]!.id).toBe("c");
    e.actions.toggleShuffle();
    expect(state(e).shuffle).toBe(false);
    expect(state(e).queue.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(state(e).queue[state(e).index]!.id).toBe("c");
  });

  it("cycleRepeat walks off→all→one→off", () => {
    const e = createPlayerEngine();
    expect(e.actions.cycleRepeat()).toBe("all");
    expect(e.actions.cycleRepeat()).toBe("one");
    expect(e.actions.cycleRepeat()).toBe("off");
  });

  it("volume/mute semantics: unmuting at zero restores previous level", () => {
    const e = createPlayerEngine({ volume: 0.5 });
    e.actions.setVolume(0.7);
    e.actions.toggleMute(); // mute
    expect(state(e).muted).toBe(true);
    expect(state(e).prevVolume).toBe(0.7);
    e.actions.setVolume(0); // dragging while muted
    e.actions.toggleMute(); // unmute
    expect(state(e).muted).toBe(false);
    expect(state(e).volume).toBe(0.7);
  });

  it("setCrossfade clamps into the 0..10 studio range", () => {
    const e = createPlayerEngine();
    e.actions.setCrossfade(99);
    expect(state(e).crossfade).toBe(10);
    e.actions.setCrossfade(-3);
    expect(state(e).crossfade).toBe(0);
  });

  it("notifies subscribers only when a field actually changes", () => {
    const e = createPlayerEngine();
    let renders = 0;
    const unsub = e.subscribe(() => {
      renders += 1;
    });
    e.actions.requestPause(); // already paused → no emit
    expect(renders).toBe(0);
    e.actions.requestPlay();
    expect(renders).toBe(1);
    e.actions.requestPlay(); // already playing → no emit
    expect(renders).toBe(1);
    unsub();
  });
});
