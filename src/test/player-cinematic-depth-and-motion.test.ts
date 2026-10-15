import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("Cinematic Depth-of-Field Lyrics Contract", () => {
  const lyricsSrc = read("src/components/player/Lyrics.tsx");

  it("LINE_BASE uses GPU-accelerated transition with cubic-bezier across filter, opacity, transform, and color", () => {
    expect(lyricsSrc).toMatch(/transition:filter_380ms_cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
    expect(lyricsSrc).toMatch(/opacity_380ms_cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
    expect(lyricsSrc).toMatch(/transform_380ms_cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
    expect(lyricsSrc).toMatch(/color_280ms_ease/);
    expect(lyricsSrc).toContain("transform-gpu");
    expect(lyricsSrc).toContain("[will-change:transform]");
    expect(lyricsSrc).toContain("font-bold");
  });

  it("LINE_ACTIVE has zero blur, bold weight, scale 1.03, kinetic translate-y-0, and glow drop-shadow", () => {
    expect(lyricsSrc).toContain("LINE_ACTIVE");
    expect(lyricsSrc).toContain("blur-none");
    expect(lyricsSrc).toContain("scale-[1.03]");
    expect(lyricsSrc).toContain("translate-y-0");
    expect(lyricsSrc).toContain("font-bold");
    expect(lyricsSrc).toContain("drop-shadow-[0_2px_14px_rgba(255,255,255,0.22)]");
  });

  it("LINE_PASSED and LINE_FUTURE have optical depth-of-field blur, kinetic upward physics, and immediate unblur on hover/tap", () => {
    expect(lyricsSrc).toContain("LINE_PASSED");
    expect(lyricsSrc).toContain("blur-[0.7px]");
    expect(lyricsSrc).toContain("opacity-45");
    expect(lyricsSrc).toContain("-translate-y-0.5");
    expect(lyricsSrc).toContain("hover:blur-none");
    expect(lyricsSrc).toContain("active:blur-none");

    expect(lyricsSrc).toContain("LINE_FUTURE");
    expect(lyricsSrc).toContain("blur-[1.2px]");
    expect(lyricsSrc).toContain("opacity-30");
    expect(lyricsSrc).toContain("translate-y-2");
  });

  it("centers active lyrics line at 35% optical sweet spot without hardcoded pixel jumps", () => {
    expect(lyricsSrc).toMatch(/clientHeight\s*\*\s*0\.35/);
  });

  it("LyricsPane smoothly dissolves with blur and AnimatePresence mode=wait during track changes", () => {
    expect(lyricsSrc).toContain('AnimatePresence mode="wait"');
    expect(lyricsSrc).toContain('filter: "blur(6px)"');
    expect(lyricsSrc).toContain('filter: "blur(0px)"');
  });

  it("LyricsPane resets itemRefs on track change and guards callback refs against unmount nulling", () => {
    expect(lyricsSrc).toContain("itemRefs.current = []");
    expect(lyricsSrc).toMatch(/ref=\{\(el\)\s*=>\s*\{\s*if\s*\(el\)\s*\{/);
    expect(lyricsSrc).not.toMatch(/i\s*<\s*prev\s*\?\s*LINE_PASSED/);
  });
});

describe("Radiant Ambient Glowing Play Button & Controls Contract", () => {
  const controlsSrc = read("src/components/player/Controls.tsx");

  it("TransportControls Play/Pause button has radiant ambient glow and rhythmic pulse aura", () => {
    expect(controlsSrc).toContain("shadow-[0_0_36px_rgba(249,115,22,0.55),0_8px_24px_rgba(0,0,0,0.5)]");
    expect(controlsSrc).toContain("ring-4 ring-primary/20");
    expect(controlsSrc).toContain("animate-pulse");
    expect(controlsSrc).toContain("-inset-1");
  });

  it("SeekBar features vivid progress track shadow and glowing scrubber thumb dot", () => {
    expect(controlsSrc).toContain("shadow-[0_0_12px_rgba(249,115,22,0.5)]");
    expect(controlsSrc).toContain("shadow-[0_0_14px_rgba(249,115,22,0.9)");
  });
});

describe("3D Parallax Sleeve & Vinyl Glide Contract", () => {
  const npSrc = read("src/components/player/NowPlaying.tsx");

  it("NowPlaying adds 3D perspective and directional tilt to album sleeve during track transitions", () => {
    expect(npSrc).toMatch(/rotateY:\s*direction\s*\*\s*8/);
    expect(npSrc).toMatch(/rotateY:\s*-direction\s*\*\s*8/);
    expect(npSrc).toMatch(/perspective:\s*1000/);
    expect(npSrc).toContain('transformStyle: "preserve-3d"');
    expect(npSrc).toContain("stiffness: 280");
    expect(npSrc).toContain("damping: 28");
    expect(npSrc).toContain("mass: 0.85");
  });

  it("maintains spinning vinyl record disc and desktop 2-column layout", () => {
    expect(npSrc).toContain("Spinning Vinyl Record Disc");
    expect(npSrc).toContain("LyricsPane");
    expect(npSrc).toContain('lyricsOpen ? "lg:mr-auto lg:ml-0" : "mx-auto"');
  });
});

describe("Dynamic Ambient Breathing Orbs Contract", () => {
  const ambientSrc = read("src/components/player/AmbientCrossfadeBackground.tsx");

  it("AmbientCrossfadeBackground renders dual animated breathing orbs with smooth motion and blur", () => {
    expect(ambientSrc).toContain("Dynamic Ambient Breathing Orbs");
    expect(ambientSrc).toMatch(/blur-\[40px\]\s+md:blur-\[80px\]/);
    expect(ambientSrc).toContain("repeat: Infinity");
  });

  it("AmbientCrossfadeBackground crossfades layers over 600ms and cleans up old layers", () => {
    expect(ambientSrc).toMatch(/duration:\s*0\.6/);
    expect(ambientSrc).toMatch(/setTimeout\([\s\S]*?650\)/);
  });

  it("AmbientCrossfadeBackground guards initial layer against premature cleanup wipeout", () => {
    expect(ambientSrc).toMatch(/activeRef\.current\.cover\s*===\s*cover/);
  });
});
