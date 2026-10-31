import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateSwipeIntent } from "../lib/swipe-gesture";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("P2-07: Mobile Horizontal Swipe Gestures on Album Jacket", () => {
  describe("Gesture Threshold Calculation (calculateSwipeIntent)", () => {
    it("triggers 'next' when swiped left past distance threshold (< -60px)", () => {
      expect(calculateSwipeIntent({ x: -61, y: 0 }, { x: -50, y: 0 })).toBe("next");
      expect(calculateSwipeIntent({ x: -120, y: 10 }, { x: 0, y: 0 })).toBe("next");
    });

    it("triggers 'next' when swiped left past velocity threshold (velocity < -300)", () => {
      expect(calculateSwipeIntent({ x: -20, y: 0 }, { x: -350, y: 0 })).toBe("next");
      expect(calculateSwipeIntent({ x: -45, y: 5 }, { x: -500, y: 0 })).toBe("next");
    });

    it("triggers 'prev' when swiped right past distance threshold (> 60px)", () => {
      expect(calculateSwipeIntent({ x: 61, y: 0 }, { x: 50, y: 0 })).toBe("prev");
      expect(calculateSwipeIntent({ x: 140, y: -5 }, { x: 0, y: 0 })).toBe("prev");
    });

    it("triggers 'prev' when swiped right past velocity threshold (velocity > 300)", () => {
      expect(calculateSwipeIntent({ x: 25, y: 0 }, { x: 350, y: 0 })).toBe("prev");
      expect(calculateSwipeIntent({ x: 40, y: 10 }, { x: 600, y: 0 })).toBe("prev");
    });

    it("returns null on sub-threshold drag for tactile spring return", () => {
      // Small distance and low velocity -> must spring back
      expect(calculateSwipeIntent({ x: 30, y: 5 }, { x: 100, y: 10 })).toBeNull();
      expect(calculateSwipeIntent({ x: -40, y: 0 }, { x: -150, y: 0 })).toBeNull();
      expect(calculateSwipeIntent({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    });

    it("returns null when drag is predominantly vertical to prevent skipping during scroll", () => {
      // Swiping vertically down to dismiss or scroll -> ignore small horizontal jitter
      expect(calculateSwipeIntent({ x: -65, y: 120 }, { x: -100, y: 200 })).toBeNull();
      expect(calculateSwipeIntent({ x: 70, y: -90 }, { x: 100, y: -150 })).toBeNull();
    });
  });

  describe("NowPlaying.tsx Component Wiring Invariants", () => {
    const nowPlayingSrc = read("src/components/player/NowPlaying.tsx");

    it("binds Framer Motion horizontal drag props to album artwork container", () => {
      expect(nowPlayingSrc).toContain('drag="x"');
      expect(nowPlayingSrc).toContain("dragConstraints={{ left: 0, right: 0 }}");
      expect(nowPlayingSrc).toContain("dragElastic={0.2}");
      expect(nowPlayingSrc).toContain("onDragEnd={handleArtworkDragEnd}");
    });

    it("sets touchAction to pan-y for smooth native vertical gesture pass-through", () => {
      expect(nowPlayingSrc).toContain('touchAction: "pan-y"');
    });

    it("has cursor-grab and active:cursor-grabbing styling on artwork", () => {
      expect(nowPlayingSrc).toContain("cursor-grab active:cursor-grabbing");
    });
  });
});
