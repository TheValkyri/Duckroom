import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("Smooth Progressive Lyric Fill & Crisp Glyph Invariants", () => {
  const lyricsSrc = read("src/components/player/Lyrics.tsx");
  const phoneSrc = read("src/components/player/PhoneCurrentLyricLine.tsx");
  const pipSrc = read("src/components/player/DocumentPipPlayer.tsx");
  const smoothHookSrc = read("src/lib/use-smooth-lyric-time.ts");

  const components = [
    { name: "Lyrics.tsx", src: lyricsSrc },
    { name: "PhoneCurrentLyricLine.tsx", src: phoneSrc },
    { name: "DocumentPipPlayer.tsx", src: pipSrc },
  ];

  it("integrates useSmoothLyricTime across all three lyric renderers for 60-120 FPS fluid fill", () => {
    for (const { name, src } of components) {
      expect(src, `${name} must use useSmoothLyricTime hook`).toContain("useSmoothLyricTime(");
    }
  });

  it("completely removes scale discrepancies (scale-[1.04] / scale-[1.06]) to eliminate ghosting halos", () => {
    for (const { name, src } of components) {
      expect(src, `${name} must not contain scale-[1.04] on word spans`).not.toContain("scale-[1.04]");
      expect(src, `${name} must not contain scale-[1.06] on word spans`).not.toContain("scale-[1.06]");
    }
  });

  it("eliminates blurry textShadow halos in Lyrics.tsx and PhoneCurrentLyricLine.tsx for 100% crisp glyphs", () => {
    expect(lyricsSrc).toContain('textShadow: "none"');
    expect(phoneSrc).toContain('textShadow: "none"');
    expect(lyricsSrc).not.toContain("0 0 14px");
    expect(phoneSrc).not.toContain("0 0 10px rgba");
  });

  it("applies soft gradient leading edge via horizontal mask-image (Apple Music style)", () => {
    for (const { name, src } of components) {
      expect(src, `${name} must use maskImage linear-gradient`).toContain("maskImage: `linear-gradient(90deg,");
      expect(src, `${name} must use WebkitMaskImage linear-gradient`).toContain(
        "WebkitMaskImage: `linear-gradient(90deg,",
      );
      expect(src, `${name} must calculate dynamic feather leading edge`).toContain("const feather = Math.min(");
    }
  });

  it("use-smooth-lyric-time hook handles requestAnimationFrame scheduling, interpolation, and idle pause safety", () => {
    expect(smoothHookSrc).toContain("requestAnimationFrame(tick)");
    expect(smoothHookSrc).toContain("cancelAnimationFrame");
    expect(smoothHookSrc).toContain("audio.currentTime");
    expect(smoothHookSrc).toContain("performance.now()");
    expect(smoothHookSrc).toContain("Math.min(elapsed, 0.25)");
  });
});
