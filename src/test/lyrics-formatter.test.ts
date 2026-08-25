import { describe, expect, it } from "vitest";
import { applyLyricsOffset, beautifyLrcString, parseLrc, shiftLrcTime } from "../lib/lyrics-formatter";

describe("Lyrics Formatter V2 — Zero Content Mutation & Precise Timing", () => {
  it("parses valid LRC timestamps into chronologically sorted LyricLine objects", () => {
    const rawLrc = `
[01:15.50] Dòng thứ hai
[00:12.30] Dòng đầu tiên
[02:00.00] Dòng kết thúc
`;
    const parsed = parseLrc(rawLrc);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]!.text).toBe("Dòng đầu tiên");
    expect(parsed[0]!.time).toBeCloseTo(12.3);
    expect(parsed[1]!.text).toBe("Dòng thứ hai");
    expect(parsed[1]!.time).toBeCloseTo(75.5);
    expect(parsed[2]!.text).toBe("Dòng kết thúc");
    expect(parsed[2]!.time).toBeCloseTo(120.0);
  });

  it("strictly PRESERVES artist wording 100% without spelling/vocabulary alteration", () => {
    // Mandate Section 8.2: NO word rewriting allowed
    const artisticLyrics = `
[00:10.00] Con sám hối hay xám hối trước cuộc đời
[00:15.00] Đi bạt mạng hay bạc mạng giữa phố xá
[00:20.00] Chấp vá những kỷ niệm xán lạn
`;
    const beautified = beautifyLrcString(artisticLyrics);
    expect(beautified).toContain("Con sám hối hay xám hối trước cuộc đời");
    expect(beautified).toContain("Đi bạt mạng hay bạc mạng giữa phố xá");
    expect(beautified).toContain("Chấp vá những kỷ niệm xán lạn");
  });

  it("shifts timestamps accurately without mutating lyric text", () => {
    const original = `[00:10.00] Lời bài hát nguyên bản`;
    const shiftedForward = shiftLrcTime(original, 1.5);
    expect(shiftedForward).toBe("[00:11.50] Lời bài hát nguyên bản");

    const shiftedBackward = shiftLrcTime(original, -2.0);
    expect(shiftedBackward).toBe("[00:08.00] Lời bài hát nguyên bản");
  });

  it("handles negative shifts gracefully clamping time at 0", () => {
    const original = `[00:01.00] Khởi đầu bài hát`;
    const shifted = shiftLrcTime(original, -5.0);
    expect(shifted).toBe("[00:00.00] Khởi đầu bài hát");
  });

  it("gracefully handles empty strings or malformed inputs", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("Không có mốc thời gian")).toEqual([]);
    expect(beautifyLrcString("")).toBe("");
    expect(shiftLrcTime("", 5)).toBe("");
  });

  describe("applyLyricsOffset — §10.4 display-time offset without mutating originals", () => {
    const source = parseLrc(`[00:10.00] Dòng A\n[01:00.50] Dòng B`);

    it("shifts display timing forward for positive offsets", () => {
      const shifted = applyLyricsOffset(source, 1200);
      expect(shifted[0]!.time).toBeCloseTo(11.2);
      expect(shifted[1]!.time).toBeCloseTo(61.7);
    });

    it("shifts display timing backward and clamps at zero", () => {
      const shifted = applyLyricsOffset(source, -1500);
      expect(shifted[0]!.time).toBeCloseTo(8.5);
      expect(shifted[1]!.time).toBeCloseTo(59.0);

      const early = applyLyricsOffset([{ time: 1, text: "x" }], -2000);
      expect(early[0]!.time).toBe(0);
    });

    it("NEVER mutates the original array or its line objects", () => {
      const snapshot = JSON.stringify(source);
      applyLyricsOffset(source, 3000);
      applyLyricsOffset(source, -3000);
      expect(JSON.stringify(source)).toBe(snapshot);
      // Returned array is a fresh copy even at zero offset
      expect(applyLyricsOffset(source, 0)).not.toBe(source);
    });

    it("is a no-op copy when offset is zero or non-finite", () => {
      const zero = applyLyricsOffset(source, 0);
      expect(zero).toEqual(source);

      const nan = applyLyricsOffset(source, Number.NaN);
      expect(nan).toEqual(source);
    });

    it("handles an empty lyric list safely", () => {
      expect(applyLyricsOffset([], 500)).toEqual([]);
    });
  });
});
