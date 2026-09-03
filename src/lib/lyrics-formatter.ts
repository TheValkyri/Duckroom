import type { LyricLine } from "../data/library";

/**
 * Parses LRC text into synchronized LyricLine array WITHOUT mutating lyric text content.
 *
 * Nâng cấp nhận diện 2026-09-01 (feedback "cải thiện nhận diện .LRC"):
 * - Phút 1..2 chữ số: [1:23.45] chuẩn như [01:23.45].
 * - Giây bắt buộc, ms tùy chọn với 1..3 chữ số: [.5] [.45] [.456].
 * - MULTI-TIMESTAMP trên 1 dòng: "[00:12.00][00:45.80]Đoạn điệp khúc"
 *   → sinh 2 entry cùng text (điệp khúc lặp).
 * - Tag metadata LRC ([ti:], [ar:], [al:], [by:], [offset:]) bị bỏ qua
 *   đúng cách (không nhầm thành lời); tag [offset:±ms] được ÁP DỤNG vào
 *   timestamp của file (chuẩn LRC spec) — không đổi text gốc.
 * - Dòng không timestamp giữ nguyên vị trí như lời plain (không discard)
 *   — chỉ khi file KHÔNG có bất kỳ timestamp nào thì trả [] để caller
 *   phân nhánh plain (kỷ luật hiện có).
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
    const text = trimmed.slice(consumed).trim();

    for (const base of stamps) {
      const time = Math.max(0, base + globalOffsetMs / 1000);
      result.push({ time, text });
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
 * Cleans up and structures LRC text:
 * - Sorts lines by timestamp
 * - Trims whitespace
 * - Removes empty trailing lines
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
  return lines.map((line) => ({ ...line, time: Math.max(0, line.time + delta) }));
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
  }));

  return shifted
    .map((line) => {
      const totalHundredths = Math.round(line.time * 100);
      const mm = Math.floor(totalHundredths / 6000)
        .toString()
        .padStart(2, "0");
      const ss = Math.floor((totalHundredths % 6000) / 100)
        .toString()
        .padStart(2, "0");
      const ms = (totalHundredths % 100).toString().padStart(2, "0");
      return `[${mm}:${ss}.${ms}] ${line.text}`;
    })
    .join("\n");
}
