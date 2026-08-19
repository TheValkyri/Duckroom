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
      const mm = Math.floor(line.time / 60)
        .toString()
        .padStart(2, "0");
      const ss = Math.floor(line.time % 60)
        .toString()
        .padStart(2, "0");
      const ms = Math.floor((line.time % 1) * 100)
        .toString()
        .padStart(2, "0");
      return `[${mm}:${ss}.${ms}] ${line.text}`;
    })
    .join("\n");
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
      const mm = Math.floor(line.time / 60)
        .toString()
        .padStart(2, "0");
      const ss = Math.floor(line.time % 60)
        .toString()
        .padStart(2, "0");
      const ms = Math.floor((line.time % 1) * 100)
        .toString()
        .padStart(2, "0");
      return `[${mm}:${ss}.${ms}] ${line.text}`;
    })
    .join("\n");
}
