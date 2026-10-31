import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("P2-03: Direct CSS Custom Property & Background Idle Lyric Optimization", () => {
  const smoothHookSrc = read("src/lib/use-smooth-lyric-time.ts");
  const lyricsSrc = read("src/components/player/Lyrics.tsx");
  const phoneSrc = read("src/components/player/PhoneCurrentLyricLine.tsx");

  describe("Background Tab & Lock-Screen Idle (use-smooth-lyric-time.ts)", () => {
    it("completely stops rAF ticker when document.hidden is true", () => {
      expect(smoothHookSrc).toContain("document.hidden");
      expect(smoothHookSrc).toContain("rafIdRef.current = null;");
      expect(smoothHookSrc).toContain("return;");
    });

    it("registers visibilitychange listener to pause when hidden and resume on wake", () => {
      expect(smoothHookSrc).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
      expect(smoothHookSrc).toContain('document.removeEventListener("visibilitychange", handleVisibilityChange)');
      expect(smoothHookSrc).toContain("stopTicker()");
    });

    it("only schedules rAF if document is not hidden", () => {
      expect(smoothHookSrc).toMatch(/if\s*\(\s*typeof document === "undefined" \|\| !document\.hidden\s*\)/);
    });
  });

  describe("CSS Custom Property --lyric-pct & Composite Layer Acceleration", () => {
    it("uses '--lyric-pct' CSS custom property in Lyrics.tsx", () => {
      expect(lyricsSrc).toContain('"--lyric-pct": `${pct}%`');
      expect(lyricsSrc).toContain("var(--lyric-pct,");
    });

    it("uses '--lyric-pct' CSS custom property in PhoneCurrentLyricLine.tsx", () => {
      expect(phoneSrc).toContain('"--lyric-pct": `${pct}%`');
      expect(phoneSrc).toContain("var(--lyric-pct,");
    });

    it("elevates active syllable overlay to GPU composite layer via transform-gpu and will-change-[clip-path]", () => {
      expect(lyricsSrc).toContain("transform-gpu will-change-[clip-path]");
      expect(phoneSrc).toContain("transform-gpu will-change-[clip-path]");
    });
  });
});
