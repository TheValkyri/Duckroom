import type { LyricLine } from "../data/library";

/**
 * Parses LRC text into synchronized LyricLine array WITHOUT mutating lyric text content.
 * Respects original artist wording:
 * - Trims extraneous whitespace per line.
 * - Extracts timestamp [mm:ss.xx] and maps to seconds.
 * - Sorts by timestamp in ascending order.
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText || !lrcText.trim()) return [];
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const match = trimmed.match(regex);
    if (match) {
      const minutes = parseInt(match[1]!, 10);
      const seconds = parseInt(match[2]!, 10);
      const msStr = match[3] || "0";
      const ms = parseInt(msStr.padEnd(3, "0").slice(0, 3), 10) / 1000;
      const time = Math.max(0, minutes * 60 + seconds + ms);
      const text = match[4]?.trim() || "";

      result.push({ time, text });
    }
  }

  // Sort chronologically
  return result.sort((a, b) => a.time - b.time);
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
