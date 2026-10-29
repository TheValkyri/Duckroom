import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeWordTimings } from "../lib/lyrics-formatter";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("Lyric Rendering Anti-Glitch Invariants (media_1793110613521_b0a6803e regression)", () => {
  const lyricsSrc = read("src/components/player/Lyrics.tsx");
  const phoneSrc = read("src/components/player/PhoneCurrentLyricLine.tsx");
  const pipSrc = read("src/components/player/DocumentPipPlayer.tsx");

  const files = [
    { name: "Lyrics.tsx", src: lyricsSrc },
    { name: "PhoneCurrentLyricLine.tsx", src: phoneSrc },
    { name: "DocumentPipPlayer.tsx", src: pipSrc },
  ];

  it("completely eliminates background-clip: text and color: transparent across all lyric renderers", () => {
    for (const { name, src } of files) {
      expect(src, `${name} must not contain backgroundClip: "text"`).not.toContain('backgroundClip: "text"');
      expect(src, `${name} must not contain WebkitBackgroundClip: "text"`).not.toContain(
        'WebkitBackgroundClip: "text"',
      );
      expect(src, `${name} must not contain color: "transparent"`).not.toContain('color: "transparent"');
      expect(src, `${name} must not contain WebkitTextFillColor: "transparent"`).not.toContain(
        'WebkitTextFillColor: "transparent"',
      );
    }
  });

  it("does not apply background gradients to word spans that risk rectangular box artifacts", () => {
    for (const { name, src } of files) {
      expect(src, `${name} must not use background: linear-gradient on word spans`).not.toMatch(
        /background:\s*`linear-gradient\(/,
      );
    }
  });

  it("uses dual-layer typography with clip-path and WebkitClipPath for active word fill", () => {
    for (const { name, src } of files) {
      expect(src, `${name} must use clipPath: inset(...)`).toContain("clipPath: `inset(");
      expect(src, `${name} must use WebkitClipPath: `).toContain("WebkitClipPath: `inset(");
      expect(src, `${name} must include -15% top/bottom headroom for Vietnamese diacritics`).toContain("-15%");
    }
  });

  it("protects accessibility and text selection on active overlays", () => {
    for (const { name, src } of files) {
      expect(src, `${name} must mark overlay as aria-hidden`).toContain('aria-hidden="true"');
      expect(src, `${name} must disable pointer events and selection on overlay`).toContain(
        "select-none pointer-events-none",
      );
    }
  });

  it("WordByWordActiveLine in Lyrics.tsx uses visible text-white and text-white/40 base text", () => {
    expect(lyricsSrc).toContain('isPast ? "text-white" : "text-white/40"');
    expect(lyricsSrc).toContain("textShadow: ");
  });

  it("PhoneActiveWordFlow in PhoneCurrentLyricLine.tsx uses visible font glyphs", () => {
    expect(phoneSrc).toContain('isPast ? "text-white font-semibold" : "text-white/45"');
    expect(phoneSrc).toContain("textShadow: ");
  });

  it("KaraokeLine in DocumentPipPlayer.tsx uses theme-aware text-primary and text-foreground/45", () => {
    expect(pipSrc).toContain('isPast ? "text-primary font-semibold" : "text-foreground/45"');
    expect(pipSrc).toContain('textShadow: "0 0 10px var(--primary, #d97706)"');
  });

  it("computeWordTimings correctly handles Vietnamese lyrics with diacritics", () => {
    const vietnameseLine = {
      time: 12.5,
      text: "Không cần filter, anh ít khi điệu",
    };
    const words = computeWordTimings(vietnameseLine, 16.5);
    expect(words).toHaveLength(7);
    expect(words[0]?.text).toBe("Không");
    expect(words[1]?.text).toBe("cần");
    expect(words[2]?.text).toBe("filter,");
    expect(words[3]?.text).toBe("anh");
    expect(words[4]?.text).toBe("ít");
    expect(words[5]?.text).toBe("khi");
    expect(words[6]?.text).toBe("điệu");
    // Ensure chronological ordering
    for (let i = 0; i < words.length - 1; i++) {
      expect(words[i]!.startTime).toBeLessThan(words[i]!.endTime);
      expect(words[i]!.endTime).toBeCloseTo(words[i + 1]!.startTime, 5);
    }
  });

  it("does not lag active-to-past color handoff with transition-colors on the base text span (prevents dimming flicker)", () => {
    // Having transition-colors on the base text span causes the word to visibly dip to dim opacity
    // at the moment of completion when the overlay unmounts.
    for (const { name, src } of files) {
      expect(src, `${name} must not have transition-colors on the base text span`).not.toMatch(
        /className=\{cn\(\s*"inline-block transition-colors/,
      );
    }
  });

  it("maintains consistent font-weight on parent word spans to prevent layout shifts and kerning offsets", () => {
    // PhoneCurrentLyricLine and DocumentPipPlayer must include font-semibold on parent word span
    // so unsung, singing, and sung states share identical letter metrics and bounding boxes.
    expect(phoneSrc).toContain('"relative inline-block font-semibold"');
    expect(pipSrc).toContain('"relative inline-block font-semibold"');
  });
});
