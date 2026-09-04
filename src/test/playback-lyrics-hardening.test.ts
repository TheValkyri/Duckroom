/**
 * WP1+WP2 2026-09-04 — playback/lyrics handover regression guards.
 *
 * Feedback: "tiếng nhạc bị ngắt", "lyric chớp chớp dựt dựt".
 *
 * Guard 1 (lyrics jitter): crossfade handover (cả 2 nhánh — timed
 * handover trong onTime VÀ ended-handover) phải reset timeRef đồng bộ
 * (setTime(0)) CÙNG lúc advanceWrapForHandover(). Trước đây timeRef
 * treo ở ~duration bài cũ cho tới timeupdate đầu của element mới →
 * LyricsTicker tính active line sai trên lines bài mới → highlight
 * nhảy loạn ("dựt") ~250ms.
 *
 * Guard 2 (audio stall soft-reload): stall threshold phải là 14s với
 * điều kiện readyState === 0 (không phải chỉ "buffer chậm") — soft
 * reload trên mobile 3G nhấp nháy stalled SẼ TẠO ra tiếng ngắt thay vì
 * chữa. Pin contract Agent-1 đã đặt xuống, chống rollback nhầm.
 *
 * Static guards (player.tsx không render được ngoài browser) — cùng
 * pattern client-boundary.test.ts / mobile-ui-shell.test.ts đã dùng.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("crossfade handover time-reset contract (WP2)", () => {
  const src = read("src/lib/player.tsx");

  it("both handover branches advance the engine AND reset the time store together", () => {
    // Đếm số cặp [advanceWrapForHandover() … setTime(0)] liền kề trong
    // phạm vi ~4 dòng — 2 nhánh handover (timed + ended).
    const lines = src.split("\n");
    let handoverAdvances = 0;
    let pairedWithTimeReset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (line.includes("actions.advanceWrapForHandover()")) {
        handoverAdvances++;
        // Từ điểm advance, quét tới gặp "el.pause()" kết thúc khối
        // handover — setTime(0) phải nằm TRƯỚC pause (comment WP2 dài
        // tùy ý xen giữa, không phụ thuộc số dòng).
        for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
          const inner = lines[j];
          if (!inner) continue;
          if (inner.includes("setTime(0)")) {
            pairedWithTimeReset++;
            break;
          }
          if (inner.includes("el.pause()")) break; // hết khối mà chưa reset
        }
      }
    }
    expect(handoverAdvances).toBe(2);
    expect(pairedWithTimeReset).toBe(2);
  });

  it("manual transports (next/prev/jumpTo/playQueue) still reset time (no regression)", () => {
    expect(src).toMatch(/playQueue[\s\S]{0,2000}setTime\(0\)/);
    expect(src).toMatch(/jumpTo[\s\S]{0,600}setTime\(0\)/);
  });
});

describe("stall soft-reload hardening contract (WP1, Agent-1 fix pinned)", () => {
  const src = read("src/lib/player.tsx");

  it("stall threshold is 14s, gated on readyState === 0 and end-of-track distance", () => {
    expect(src).toContain("}, 14000)");
    expect(src).toMatch(/el\.readyState > 0/);
    expect(src).toMatch(/remaining < 30/);
  });

  it("stall reload is once-per-track (dedupe set) and clears on playing", () => {
    expect(src).toContain("stalledReloadedRef.current.has(current.id)");
    expect(src).toMatch(/onPlaying[\s\S]{0,200}clearTimeout\(stallInfo\.timer\)/);
  });
});

describe("lyrics initial-render active contract (WP2)", () => {
  it("LyricsPane renders the first frame with the correct active line (no FUTURE flash)", () => {
    const src = read("src/components/player/Lyrics.tsx");
    expect(src).toContain("usePlayerTimeSnapshot");
    expect(src).toMatch(/activeFromTime\(lines, timeNow\)/);
    // Ticker vẫn là subscriber duy nhất theo tick — pane KHÔNG subscribe time.
    const paneBody = src.split("function LyricsTicker")[0];
    expect(paneBody).not.toMatch(/usePlayerTime\(\)/);
    expect(src.split("function LyricsTicker")[1]).toContain("usePlayerTime()");
  });

  it("player exports a non-subscribing time snapshot hook for one-shot reads", () => {
    const src = read("src/lib/player.tsx");
    expect(src).toContain("export function usePlayerTimeSnapshot");
  });
});
