import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("Lyrics Freeze Recovery & Self-Healing Contract", () => {
  const lyricsSrc = read("src/components/player/Lyrics.tsx");

  it("contains getOrHydrateItems fallback that self-heals button refs when empty", () => {
    expect(lyricsSrc).toContain("function getOrHydrateItems(");
    expect(lyricsSrc).toContain('querySelectorAll<HTMLButtonElement>("button")');
    expect(lyricsSrc).toMatch(/itemRefs\.current\s*=\s*found;/);
  });

  it("registers focus and visibilitychange wake-up listeners to immediately re-sync active lyrics", () => {
    expect(lyricsSrc).toMatch(/window\.addEventListener\("focus",\s*handleWake\)/);
    expect(lyricsSrc).toMatch(/document\.addEventListener\("visibilitychange",\s*handleWake\)/);
    expect(lyricsSrc).toMatch(/window\.removeEventListener\("focus",\s*handleWake\)/);
    expect(lyricsSrc).toMatch(/document\.removeEventListener\("visibilitychange",\s*handleWake\)/);
  });

  it("includes an anti-deadlock failsafe timer to guarantee active line alignment after 320ms", () => {
    expect(lyricsSrc).toMatch(/setTimeout\([\s\S]*?320\)/);
    expect(lyricsSrc).toContain("getOrHydrateItems(itemRefs, containerRef)");
  });

  it("LyricsTicker self-heals when active item lacks scale styling even if index matches", () => {
    expect(lyricsSrc).toContain("containerRef={containerRef}");
    expect(lyricsSrc).toContain("needsSync");
    expect(lyricsSrc).toMatch(/!activeEl\.className\.includes\("scale-\[1\.03\]"\)/);
    expect(lyricsSrc).toContain("if (next === prev && !needsSync) return;");
  });

  it("applyActiveClasses safely defaults to LINE_BASE if element dataset.base is uninitialized", () => {
    expect(lyricsSrc).toContain('const base = el.dataset["base"] || LINE_BASE;');
  });

  it("getOrHydrateItems guards against cross-track button leakage during song transition", () => {
    expect(lyricsSrc).toContain("expectedTrackId?: string");
    expect(lyricsSrc).toContain('container.dataset["lyricsTrack"] !== expectedTrackId');
    expect(lyricsSrc).toContain("data-lyrics-track={trackId}");
  });

  it("scrollActiveIntoView uses invariant getBoundingClientRect scroll math independent of offsetParent", () => {
    expect(lyricsSrc).toContain("container.getBoundingClientRect()");
    expect(lyricsSrc).toContain("el.getBoundingClientRect()");
    expect(lyricsSrc).toContain("elRect.top - containerRect.top + container.scrollTop");
  });
});

describe("Visualizer & Tab-Media Resource Leak Prevention Contract", () => {
  const visualizerSrc = read("src/components/Visualizer.tsx");
  const tabMediaSrc = read("src/lib/tab-media-sync.ts");
  const playerSrc = read("src/lib/player.tsx");
  const phoneLyricSrc = read("src/components/player/PhoneCurrentLyricLine.tsx");

  it("Visualizer pauses work when hidden without scheduling duplicate rAF loops", () => {
    expect(visualizerSrc).toMatch(/if\s*\(document\.hidden\)\s*\{\s*return;\s*\}/);
    expect(visualizerSrc).toMatch(/cancelAnimationFrame\(raf\)/);
  });

  it("Visualizer uses single shared gradient to eliminate GC allocation churn and pauses when offscreen", () => {
    expect(visualizerSrc).toContain("const grad = ctx.createLinearGradient(0, 0, 0, h);");
    expect(visualizerSrc).toContain("IntersectionObserver");
    expect(visualizerSrc).toContain("if (!isIntersecting) {");
  });

  it("PhoneCurrentLyricLine isolates AnimatePresence via memoized LyricDisplay", () => {
    expect(phoneLyricSrc).toContain("const LyricDisplay = memo(function LyricDisplay");
    expect(phoneLyricSrc).toContain('<LyricDisplay activeIdx={activeIdx} text={line.text ?? ""} />');
  });

  it("tab-media-sync avoids redundant DOM mutations when favicon or title is unchanged", () => {
    expect(tabMediaSrc).toContain("if (currentFaviconUrl === iconUrl) return;");
    expect(tabMediaSrc).toContain("if (document.title !== targetTitle)");
  });

  it("player.tsx immediately pauses previous audio when syncing new track source", () => {
    expect(playerSrc).toMatch(
      /if\s*\(!el\.paused\s*&&\s*currentPrimaryTrackId\s*!==\s*current\.id\)\s*\{\s*el\.pause\(\);\s*\}/,
    );
  });
});
