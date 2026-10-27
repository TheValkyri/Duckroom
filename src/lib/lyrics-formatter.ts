import type { LyricLine, LyricWord } from "../data/library";

const WORD_TS_RE = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/**
 * Parses word-level timestamps in Enhanced LRC format:
 * e.g. `<00:12.30> Hello <00:12.80> World`
 */
function parseEnhancedWords(
  rawText: string,
  baseTime: number,
  globalOffsetSeconds: number,
): { cleanText: string; words: LyricWord[] } | null {
  WORD_TS_RE.lastIndex = 0;
  const matches: { index: number; end: number; time: number }[] = [];
  let wm: RegExpExecArray | null;
  while ((wm = WORD_TS_RE.exec(rawText)) !== null) {
    const minutes = parseInt(wm[1]!, 10);
    const seconds = parseInt(wm[2]!, 10);
    const fracRaw = wm[3] || "0";
    const fracMs = parseInt(fracRaw.padEnd(3, "0").slice(0, 3), 10);
    const time = Math.max(0, minutes * 60 + seconds + fracMs / 1000 + globalOffsetSeconds);
    matches.push({ index: wm.index, end: WORD_TS_RE.lastIndex, time });
  }

  if (matches.length === 0) return null;

  const words: LyricWord[] = [];

  // 1. Text before the first syllable tag (e.g. "Intro text <00:10.50> next")
  if (matches[0]!.index > 0) {
    const leading = rawText.slice(0, matches[0]!.index).trim();
    if (leading) {
      const leadingWords = leading.split(/\s+/).filter(Boolean);
      const spanEnd = matches[0]!.time;
      const spanDuration = Math.max(0.2, spanEnd - baseTime);
      let cur = baseTime;
      for (let wIdx = 0; wIdx < leadingWords.length; wIdx++) {
        const lw = leadingWords[wIdx]!;
        const dur = spanDuration / leadingWords.length;
        words.push({ text: lw, startTime: cur, endTime: cur + dur });
        cur += dur;
      }
    }
  }

  // 2. Tagged syllables
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.end;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : rawText.length;
    const chunk = rawText.slice(start, end).trim();
    if (!chunk) continue;
    const wordStart = matches[i]!.time;
    const wordEnd = i + 1 < matches.length ? matches[i + 1]!.time : wordStart + Math.max(0.35, chunk.length * 0.08);

    const subWords = chunk.split(/\s+/).filter(Boolean);
    if (subWords.length > 1) {
      const totalDur = Math.max(0.2, wordEnd - wordStart);
      let cur = wordStart;
      for (let sIdx = 0; sIdx < subWords.length; sIdx++) {
        const sw = subWords[sIdx]!;
        const dur = totalDur / subWords.length;
        words.push({ text: sw, startTime: cur, endTime: cur + dur });
        cur += dur;
      }
    } else {
      words.push({ text: chunk, startTime: wordStart, endTime: Math.max(wordStart + 0.05, wordEnd) });
    }
  }

  const cleanText = rawText.replace(WORD_TS_RE, "").replace(/\s+/g, " ").trim();
  return { cleanText, words };
}

/**
 * Parses LRC text into synchronized LyricLine array WITHOUT mutating lyric text content.
 *
 * Nâng cấp nhận diện 2026-09-01 + Visuals & Lyrics 2.0 (Word-by-word Synced Lyrics):
 * - Phút 1..2 chữ số: [1:23.45] chuẩn như [01:23.45].
 * - Giây bắt buộc, ms tùy chọn với 1..3 chữ số: [.5] [.45] [.456].
 * - MULTI-TIMESTAMP trên 1 dòng: "[00:12.00][00:45.80]Đoạn điệp khúc"
 *   → sinh 2 entry cùng text (điệp khúc lặp).
 * - Word-by-word (syllable-level) sync: Hỗ trợ cú pháp Enhanced LRC `<mm:ss.xx>`
 *   gắn vào từng từ/âm tiết, tính thời lượng và startTime/endTime cho từng từ.
 * - Tag metadata LRC ([ti:], [ar:], [al:], [by:], [offset:]) bị bỏ qua
 *   đúng cách (không nhầm thành lời); tag [offset:±ms] được ÁP DỤNG vào
 *   timestamp của file (chuẩn LRC spec) — không đổi text gốc.
 * - Dòng không timestamp giữ nguyên vị trí như lời plain (không discard).
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText || !lrcText.trim()) return [];
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];

  const TS_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const META_RE = /^\[(ti|ar|al|by|offset|re|ve|length|au):/i;
  let globalOffsetMs = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Tag metadata — bỏ qua (trừ offset: áp 1 lần cho cả file).
    if (META_RE.test(trimmed)) {
      const off = trimmed.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) globalOffsetMs = parseInt(off[1]!, 10);
      continue;
    }

    // Gom MỌI timestamp ở đầu dòng (multi-timestamp = điệp khúc lặp).
    TS_RE.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = TS_RE.exec(trimmed)) !== null) {
      const minutes = parseInt(m[1]!, 10);
      const seconds = parseInt(m[2]!, 10);
      const fracRaw = m[3] || "0";
      // .5 → 500ms; .45 → 450ms; .456 → 456ms (pad phải theo số chữ số).
      const fracMs = parseInt(fracRaw.padEnd(3, "0").slice(0, 3), 10);
      stamps.push(Math.max(0, minutes * 60 + seconds + fracMs / 1000));
      consumed = TS_RE.lastIndex;
    }

    if (!stamps.length) continue; // dòng thường (không ts) — không nhầm
    const rawContent = trimmed.slice(consumed).trim();
    const parsedEnhanced = parseEnhancedWords(rawContent, stamps[0] || 0, globalOffsetMs / 1000);
    const text = parsedEnhanced ? parsedEnhanced.cleanText : rawContent;

    for (const base of stamps) {
      const time = Math.max(0, base + globalOffsetMs / 1000);
      let words: LyricWord[] | undefined = undefined;
      if (parsedEnhanced && parsedEnhanced.words.length > 0) {
        const delta = base - stamps[0]!;
        words = parsedEnhanced.words.map((w) => ({
          text: w.text,
          startTime: Math.max(0, w.startTime + delta),
          endTime: Math.max(0, w.endTime + delta),
        }));
      }
      result.push({ time, text, ...(words ? { words } : {}) });
    }
  }

  if (!result.length) return [];

  // Chronological; stable cho các dòng cùng timestamp (giữ thứ tự file).
  return result
    .map((line, idx) => ({ line, idx }))
    .sort((a, b) => a.line.time - b.line.time || a.idx - b.idx)
    .map((e) => e.line);
}

/**
 * Computes or retrieves word-by-word syllable timings for Apple Music-style smooth karaoke flow.
 * - If line already contains exact Enhanced LRC words, uses them directly.
 * - If line is standard line-synced, generates proportional syllable durations based on word lengths
 *   interpolating smoothly to next line time or line duration.
 */
export function computeWordTimings(line: LyricLine, nextLineTime?: number): LyricWord[] {
  if (line.words && line.words.length > 0) {
    return line.words;
  }
  const rawWords = line.text.trim().split(/\s+/).filter(Boolean);
  if (!rawWords.length) return [];

  const lineStart = line.time;
  let lineDuration: number;
  if (typeof nextLineTime === "number" && nextLineTime > lineStart) {
    lineDuration = Math.min(nextLineTime - lineStart, Math.max(1.2, rawWords.length * 0.55));
  } else {
    lineDuration = Math.max(1.5, rawWords.length * 0.42);
  }

  const activeDuration = Math.max(0.8, lineDuration * 0.94);
  const totalWeight = rawWords.reduce((sum, w) => sum + Math.max(2, w.length), 0);
  let currentStart = lineStart;
  const words: LyricWord[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    const word = rawWords[i]!;
    const weight = Math.max(2, word.length);
    const duration = (weight / totalWeight) * activeDuration;
    const end = currentStart + duration;
    words.push({
      text: word,
      startTime: currentStart,
      endTime: end,
    });
    currentStart = end;
  }

  return words;
}

/**
 * Cleans up and structures LRC text:
 * - Sorts lines by timestamp
 * - Trims whitespace
 * - Preserves syllable timestamps if present
 * - DOES NOT modify actual lyric words
 */
export function beautifyLrcString(lrcString: string): string {
  if (!lrcString || !lrcString.trim()) return "";
  const lines = parseLrc(lrcString);
  if (!lines.length) return lrcString.trim();

  return lines
    .map((line) => {
      const totalHundredths = Math.round(line.time * 100);
      const mm = Math.floor(totalHundredths / 6000)
        .toString()
        .padStart(2, "0");
      const ss = Math.floor((totalHundredths % 6000) / 100)
        .toString()
        .padStart(2, "0");
      const ms = (totalHundredths % 100).toString().padStart(2, "0");

      if (line.words && line.words.length > 0) {
        const wordsFormatted = line.words
          .map((w) => {
            const wHundredths = Math.round(w.startTime * 100);
            const wMm = Math.floor(wHundredths / 6000)
              .toString()
              .padStart(2, "0");
            const wSs = Math.floor((wHundredths % 6000) / 100)
              .toString()
              .padStart(2, "0");
            const wMs = (wHundredths % 100).toString().padStart(2, "0");
            return `<${wMm}:${wSs}.${wMs}> ${w.text}`;
          })
          .join(" ");
        return `[${mm}:${ss}.${ms}] ${wordsFormatted}`;
      }

      return `[${mm}:${ss}.${ms}] ${line.text}`;
    })
    .join("\n");
}

/**
 * Runtime lyrics offset (Master Plan §10.4).
 *
 * Returns a NEW array shifted for DISPLAY ONLY. The caller must keep using the
 * original parsed lines; original timestamps are never rewritten and the
 * stored LRC payload stays untouched.
 *
 * @param lines      Parsed lyric lines (source of truth)
 * @param offsetMs   Global offset in milliseconds (positive = show earlier)
 */
export function applyLyricsOffset(lines: readonly LyricLine[], offsetMs: number): LyricLine[] {
  if (!lines.length || !Number.isFinite(offsetMs) || offsetMs === 0) return [...lines];
  const delta = offsetMs / 1000;
  return lines.map((line) => ({
    ...line,
    time: Math.max(0, line.time + delta),
    words: line.words
      ? line.words.map((w) => ({
          ...w,
          startTime: Math.max(0, w.startTime + delta),
          endTime: Math.max(0, w.endTime + delta),
        }))
      : undefined,
  }));
}

/**
 * Shifts all timestamped lines in an LRC string by a given delta in seconds.
 * Does NOT mutate lyric words.
 */
export function shiftLrcTime(lrcString: string, deltaSeconds: number): string {
  if (!lrcString || !lrcString.trim() || deltaSeconds === 0) return lrcString;
  const lines = parseLrc(lrcString);
  if (!lines.length) return lrcString;

  const shifted = lines.map((l) => ({
    ...l,
    time: Math.max(0, parseFloat((l.time + deltaSeconds).toFixed(2))),
    words: l.words
      ? l.words.map((w) => ({
          ...w,
          startTime: Math.max(0, parseFloat((w.startTime + deltaSeconds).toFixed(2))),
          endTime: Math.max(0, parseFloat((w.endTime + deltaSeconds).toFixed(2))),
        }))
      : undefined,
  }));

  return shifted
    .map((line) => {
      const formatStamp = (sec: number) => {
        const totalHundredths = Math.round(sec * 100);
        const mm = Math.floor(totalHundredths / 6000)
          .toString()
          .padStart(2, "0");
        const ss = Math.floor((totalHundredths % 6000) / 100)
          .toString()
          .padStart(2, "0");
        const ms = (totalHundredths % 100).toString().padStart(2, "0");
        return `[${mm}:${ss}.${ms}]`;
      };

      if (line.words && line.words.length > 0) {
        const wordsFormatted = line.words
          .map((w) => {
            const wHundredths = Math.round(w.startTime * 100);
            const wMm = Math.floor(wHundredths / 6000)
              .toString()
              .padStart(2, "0");
            const wSs = Math.floor((wHundredths % 6000) / 100)
              .toString()
              .padStart(2, "0");
            const wMs = (wHundredths % 100).toString().padStart(2, "0");
            return `<${wMm}:${wSs}.${wMs}> ${w.text}`;
          })
          .join(" ");
        return `${formatStamp(line.time)} ${wordsFormatted}`;
      }

      return `${formatStamp(line.time)} ${line.text}`;
    })
    .join("\n");
}
