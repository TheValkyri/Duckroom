import { describe, expect, it } from "vitest";
import {
  applyLyricsOffset,
  beautifyLrcString,
  computeWordTimings,
  parseLrc,
  shiftLrcTime,
  readStoredOffset,
  saveStoredOffset,
  OFFSET_STORAGE_PREFIX,
  OFFSET_LIMIT_MS,
} from "../lib/lyrics-formatter";

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

  describe("parseLrc v2 — mở rộng nhận diện (2026-09-01)", () => {
    it("chấp nhận phút 1 chữ số: [1:23.45]", () => {
      const parsed = parseLrc(`[1:23.45] Một chữ số phút`);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.time).toBeCloseTo(83.45);
    });

    it("chấp nhận ms 1..3 chữ số (.5/.45/.456) đúng chuẩn thập phân", () => {
      expect(parseLrc(`[00:10.5] nửa giây`)[0]!.time).toBeCloseTo(10.5);
      expect(parseLrc(`[00:10.45]`)[0]!.time).toBeCloseTo(10.45);
      expect(parseLrc(`[00:10.456]`)[0]!.time).toBeCloseTo(10.456);
    });

    it("MULTI-TIMESTAMP sinh nhiều entry cùng text (điệp khúc lặp)", () => {
      const parsed = parseLrc(`[00:12.00][00:45.80][01:30.10]Điệp khúc`);
      expect(parsed).toHaveLength(3);
      expect(parsed.map((l) => l.text)).toEqual(["Điệp khúc", "Điệp khúc", "Điệp khúc"]);
      expect(parsed[0]!.time).toBeCloseTo(12);
      expect(parsed[1]!.time).toBeCloseTo(45.8);
      expect(parsed[2]!.time).toBeCloseTo(90.1);
    });

    it("bỏ qua tag metadata (ti/ar/al/by) — không thành lời", () => {
      const parsed = parseLrc(`[ti:Tên bài]\n[ar:Ca sĩ]\n[al:Album]\n[00:10.00]Lời thật`);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.text).toBe("Lời thật");
    });

    it("áp tag [offset:±ms] chuẩn LRC cho toàn file, không đổi text", () => {
      const parsed = parseLrc(`[offset:500]\n[00:10.00]Lời\n[offset:-200]\n[00:20.00]Lời sau`);
      // Tag offset: chỉ tag ĐẦU TIÊN áp cho cả file theo spec thực dụng —
      // hai tag: lấy tag gần nhất TRƯỚC dòng (chunk semantics). 10 + 0.5 = 10.5.
      expect(parsed[0]!.time).toBeCloseTo(10.5);
      expect(parsed[1]!.text).toBe("Lời sau");
    });

    it("timestamp phân cách bằng ':' trong phần ms cũng hợp lệ [00:10:45]", () => {
      expect(parseLrc(`[00:10:45] colon`)[0]!.time).toBeCloseTo(10.45);
    });

    it("sort ổn định: cùng timestamp giữ thứ tự trong file", () => {
      const parsed = parseLrc(`[00:30.00]A trước\n[00:30.00]B sau\n[00:10.00]C đầu`);
      expect(parsed.map((l) => l.text)).toEqual(["C đầu", "A trước", "B sau"]);
    });
  });

  describe("Visuals & Lyrics 2.0 — Word-by-word & Syllable-level Synced Lyrics", () => {
    it("parses Enhanced LRC format with syllable timestamps <mm:ss.xx>", () => {
      const enhancedLrc = `[00:10.00] <00:10.00> Em <00:10.50> có <00:11.20> nghe <00:11.80> mùa <00:12.40> thu`;
      const parsed = parseLrc(enhancedLrc);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.text).toBe("Em có nghe mùa thu");
      expect(parsed[0]!.time).toBeCloseTo(10.0);
      expect(parsed[0]!.words).toBeDefined();
      expect(parsed[0]!.words).toHaveLength(5);
      expect(parsed[0]!.words![0]!.text).toBe("Em");
      expect(parsed[0]!.words![0]!.startTime).toBeCloseTo(10.0);
      expect(parsed[0]!.words![0]!.endTime).toBeCloseTo(10.5);
      expect(parsed[0]!.words![1]!.text).toBe("có");
      expect(parsed[0]!.words![1]!.startTime).toBeCloseTo(10.5);
      expect(parsed[0]!.words![2]!.text).toBe("nghe");
      expect(parsed[0]!.words![2]!.startTime).toBeCloseTo(11.2);
    });

    it("shifts word timestamps in applyLyricsOffset without mutating source", () => {
      const parsed = parseLrc(`[00:10.00] <00:10.00> Từ <00:10.60> đầu`);
      const shifted = applyLyricsOffset(parsed, 1000); // +1000ms
      expect(shifted[0]!.time).toBeCloseTo(11.0);
      expect(shifted[0]!.words![0]!.startTime).toBeCloseTo(11.0);
      expect(shifted[0]!.words![0]!.endTime).toBeCloseTo(11.6);
      expect(shifted[0]!.words![1]!.startTime).toBeCloseTo(11.6);

      // Verify original is untouched
      expect(parsed[0]!.time).toBeCloseTo(10.0);
      expect(parsed[0]!.words![0]!.startTime).toBeCloseTo(10.0);
    });

    it("shifts word timestamps in shiftLrcTime accurately", () => {
      const original = `[00:10.00] <00:10.00> Một <00:10.50> hai`;
      const shifted = shiftLrcTime(original, 2.5);
      expect(shifted).toContain("[00:12.50]");
      expect(shifted).toContain("<00:12.50> Một");
      expect(shifted).toContain("<00:13.00> hai");
    });

    it("computes proportional syllable flow for standard line-synced lyrics with computeWordTimings", () => {
      const line = { time: 5.0, text: "Gió heo may qua phố dài" };
      const words = computeWordTimings(line, 9.0); // next line starts at 9.0s (4s duration)
      expect(words).toHaveLength(6);
      expect(words[0]!.text).toBe("Gió");
      expect(words[0]!.startTime).toBe(5.0);
      expect(words[words.length - 1]!.text).toBe("dài");
      expect(words[words.length - 1]!.endTime).toBeLessThanOrEqual(9.0);
      expect(words[words.length - 1]!.startTime).toBeGreaterThan(5.0);

      // Monotonically increasing timestamps
      for (let i = 0; i < words.length - 1; i++) {
        expect(words[i]!.startTime).toBeLessThan(words[i + 1]!.startTime);
        expect(words[i]!.endTime).toBeLessThanOrEqual(words[i + 1]!.startTime);
      }
    });

    it("preserves explicit words directly in computeWordTimings", () => {
      const explicitWords = [
        { text: "Word1", startTime: 1.0, endTime: 2.0 },
        { text: "Word2", startTime: 2.0, endTime: 3.0 },
      ];
      const line = { time: 1.0, text: "Word1 Word2", words: explicitWords };
      expect(computeWordTimings(line)).toBe(explicitWords);
    });

    it("parses Enhanced LRC with text occurring before the first syllable tag", () => {
      const lrc = `[00:15.00] Dạo đầu <00:16.00> lời hát`;
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.text).toBe("Dạo đầu lời hát");
      expect(parsed[0]!.words).toBeDefined();
      expect(parsed[0]!.words).toHaveLength(4);
      expect(parsed[0]!.words![0]!.text).toBe("Dạo");
      expect(parsed[0]!.words![0]!.startTime).toBeCloseTo(15.0);
      expect(parsed[0]!.words![1]!.text).toBe("đầu");
      expect(parsed[0]!.words![2]!.text).toBe("lời");
      expect(parsed[0]!.words![2]!.startTime).toBeCloseTo(16.0);
    });

    it("handles multi-word syllable chunks within a single tag", () => {
      const lrc = `[00:20.00] <00:20.00> Xin chào quý vị <00:22.00> các bạn`;
      const parsed = parseLrc(lrc);
      expect(parsed[0]!.words).toHaveLength(6);
      expect(parsed[0]!.words![0]!.text).toBe("Xin");
      expect(parsed[0]!.words![1]!.text).toBe("chào");
      expect(parsed[0]!.words![2]!.text).toBe("quý");
      expect(parsed[0]!.words![3]!.text).toBe("vị");
      expect(parsed[0]!.words![4]!.text).toBe("các");
      expect(parsed[0]!.words![5]!.text).toBe("bạn");
    });

    it("beautifyLrcString preserves syllable timestamps accurately", () => {
      const raw = `[00:05.00] <00:05.00> Lời <00:05.50> ca`;
      const beautified = beautifyLrcString(raw);
      expect(beautified).toContain("[00:05.00]");
      expect(beautified).toContain("<00:05.00> Lời");
      expect(beautified).toContain("<00:05.50> ca");
    });

    it("allocates acoustic dwell time to punctuation words (commas, periods, ellipses)", () => {
      const line = { time: 10.0, text: "Không gặp đâu, bitch" };
      const words = computeWordTimings(line, 14.0);
      expect(words).toHaveLength(4);
      expect(words[2]!.text).toBe("đâu,");
      expect(words[3]!.text).toBe("bitch");
      // "đâu," has a comma so it receives natural cadence dwell time
      expect(words[2]!.endTime - words[2]!.startTime).toBeGreaterThan(0.2);
      expect(words[2]!.endTime).toBeCloseTo(words[3]!.startTime, 5);
    });

    it("ensures monotonic progress and strict line duration bounds for rapid rap lines", () => {
      const line = { time: 20.0, text: "Yeah tao bước đi vào pit, yeah" };
      const words = computeWordTimings(line, 23.0);
      expect(words.length).toBeGreaterThan(0);
      expect(words[0]!.startTime).toBe(20.0);
      expect(words[words.length - 1]!.endTime).toBeLessThanOrEqual(23.0);
      for (let i = 0; i < words.length - 1; i++) {
        expect(words[i]!.startTime).toBeLessThan(words[i + 1]!.startTime);
        expect(words[i]!.endTime).toBeLessThanOrEqual(words[i + 1]!.startTime);
      }
    });
  });

  describe("readStoredOffset & saveStoredOffset", () => {
    it("persists and reads track offset clamped within limit", () => {
      saveStoredOffset("track-test", 150);
      expect(readStoredOffset("track-test")).toBe(150);
      saveStoredOffset("track-test", 999999);
      expect(readStoredOffset("track-test")).toBe(OFFSET_LIMIT_MS);
      saveStoredOffset("track-test", -999999);
      expect(readStoredOffset("track-test")).toBe(-OFFSET_LIMIT_MS);
      saveStoredOffset("track-test", 0);
      expect(readStoredOffset("track-test")).toBe(0);
      expect(readStoredOffset(undefined)).toBe(0);
    });

    it("dispatches duckroom:lyrics-offset-changed event on saveStoredOffset", () => {
      let receivedOffset: number | null = null;
      const originalWindow = (globalThis as any).window;
      const listeners: Record<string, Array<(e: any) => void>> = {};
      (globalThis as any).window = {
        dispatchEvent: (e: any) => {
          (listeners[e.type] || []).forEach((cb) => cb(e));
          return true;
        },
        addEventListener: (type: string, cb: (e: any) => void) => {
          listeners[type] = listeners[type] || [];
          listeners[type]!.push(cb);
        },
        removeEventListener: (type: string, cb: (e: any) => void) => {
          listeners[type] = (listeners[type] || []).filter((f) => f !== cb);
        },
      };

      const listener = (e: any) => {
        if (e.detail?.trackId === "evt-track") {
          receivedOffset = e.detail.offsetMs;
        }
      };
      (globalThis as any).window.addEventListener("duckroom:lyrics-offset-changed", listener);
      saveStoredOffset("evt-track", 250);
      expect(receivedOffset).toBe(250);
      (globalThis as any).window.removeEventListener("duckroom:lyrics-offset-changed", listener);

      if (originalWindow !== undefined) {
        (globalThis as any).window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }
    });

    it("protects natural duration for short held phrases instead of prematurely cutting them off", () => {
      const line = { time: 5.0, text: "Tao không thích" };
      // Next line is at 8.5s (gap 3.5s)
      const words = computeWordTimings(line, 8.5);
      expect(words).toHaveLength(3);
      const totalDuration = words[words.length - 1]!.endTime - words[0]!.startTime;
      // Singing spans natural duration (> 2.0s) rather than being crushed to 1.5s
      expect(totalDuration).toBeGreaterThan(2.0);
      expect(words[words.length - 1]!.endTime).toBeLessThanOrEqual(8.5);
    });

    it("allocates sustained melisma duration to prolonged vowels and tilde extensions", () => {
      const line = { time: 0.0, text: "Người hơiiii dẫu biết mai" };
      const words = computeWordTimings(line, 4.0);
      expect(words).toHaveLength(5);
      const hoiiDur = words[1]!.endTime - words[1]!.startTime;
      const dauDur = words[2]!.endTime - words[2]!.startTime;
      // "hơiiii" has prolonged vowels so it receives significantly more duration than regular word
      expect(hoiiDur).toBeGreaterThan(dauDur * 1.2);
    });

    it("clips staccato stop consonants (nhấp nhả) crisply without sluggish drag", () => {
      const line = { time: 0.0, text: "nhấp nhạt bước đi" };
      const words = computeWordTimings(line, 4.0);
      expect(words).toHaveLength(4);
      const nhapDur = words[0]!.endTime - words[0]!.startTime;
      const diDur = words[3]!.endTime - words[3]!.startTime;
      // "nhấp" ends in stop consonant -p and should be crisp
      expect(nhapDur).toBeLessThanOrEqual(diDur);
    });

    it("ensures ballad lines finish decisively when artist stops, leaving trailing rest before next line", () => {
      const line = { time: 10.0, text: "Dẫu biết mai này xa nhau" };
      // 5.5s gap to next line (ballad interlude / pause)
      const words = computeWordTimings(line, 15.5);
      expect(words).toHaveLength(6);
      const vocalEndTime = words[words.length - 1]!.endTime;
      // Vocal ends naturally at around 2.2 - 2.8s
      expect(vocalEndTime - 10.0).toBeLessThan(3.5);
      // Leaves at least 1.5s of peaceful rest before next line arrives (no sluggish crawling)
      expect(15.5 - vocalEndTime).toBeGreaterThan(1.5);
    });
  });
});
