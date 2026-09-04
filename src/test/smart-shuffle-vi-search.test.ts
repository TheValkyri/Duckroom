/**
 * F1 + F2 2026-09-04 — unit tests cho logic thuần mới.
 *
 * - viFold: chuẩn hóa tiếng Việt không dấu ("dam cuoi" → match "Đám Cưới").
 * - smartShuffledWithRng: rải nghệ sĩ — không 2 bài cùng nghệ sĩ kề nhau
 *   khi tránh được; giữ bài đầu; đủ số bài; deterministic theo RNG.
 */

import { describe, expect, it } from "vitest";
import { viFold } from "../lib/vi-search";
import { smartShuffledWithRng, shuffledWithRng } from "../lib/player-queue";

const seqRng = (seed: number) => {
  let s = seed;
  return () => {
    // LCG — deterministic cho test.
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

describe("viFold (F1 — tìm không dấu)", () => {
  it("bỏ mọi dấu tiếng Việt về ASCII gốc", () => {
    expect(viFold("Đám Cưới Đầu Em")).toBe("dam cuoi dau em");
    expect(viFold("Trái Tim Băng Bổ")).toBe("trai tim bang bo");
    expect(viFold("Bảy")).toBe("bay");
    expect(viFold("HVL")).toBe("hvl");
  });

  it("match chuỗi không dấu trong chuỗi có dấu", () => {
    const title = viFold("Đám Cưới");
    expect(title.includes("dam cuoi")).toBe(true);
    expect(title.includes("cuoi")).toBe(true);
    expect(title.includes("dám")).toBe(false); // fold chỉ bỏ dấu, không thêm
  });

  it("case-insensitive + gọn khoảng trắng", () => {
    expect(viFold("  MCK   đỉnh   ").toLowerCase()).toBe(viFold("mck đỉnh"));
    expect(viFold("a\u00A0 b")).toBe("a b"); // NBSP → space
  });

  it("chuỗi rỗng an toàn", () => {
    expect(viFold("")).toBe("");
    expect(viFold("   ")).toBe("");
  });
});

describe("smartShuffledWithRng (F2 — shuffle rải nghệ sĩ)", () => {
  type T = { id: string; artist: string };

  const adjacentSame = (list: T[]) => {
    let count = 0;
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i]!.artist === list[i + 1]!.artist) count++;
    }
    return count;
  };

  it("không có 2 bài cùng nghệ sĩ kề nhau khi tránh được", () => {
    // 3 nghệ sĩ × 4 bài = 12 — hoàn toàn tránh được.
    const items: T[] = [];
    for (let a = 0; a < 3; a++) {
      for (let i = 0; i < 4; i++) items.push({ id: `a${a}-t${i}`, artist: `artist${a}` });
    }
    for (let seed = 1; seed <= 10; seed++) {
      const out = smartShuffledWithRng(items, seqRng(seed), (t) => t.artist);
      expect(out).toHaveLength(12);
      expect(adjacentSame(out)).toBe(0);
    }
  });

  it("nghệ sĩ chiếm đa số (không tránh được hết) đạt gần cận dưới pigeonhole", () => {
    // 7/10 cùng nghệ sĩ: cận dưới lý thuyết = 7 - 3(small) - 1 = 3 cặp kề
    // bắt buộc. Greedy toàn cục đạt 3; cho phép ≤4 (dự phòng nhỏ).
    const items: T[] = [];
    for (let i = 0; i < 7; i++) items.push({ id: `big-${i}`, artist: "big" });
    for (let i = 0; i < 3; i++) items.push({ id: `s-${i}`, artist: `small${i}` });
    for (let seed = 1; seed <= 5; seed++) {
      const out = smartShuffledWithRng(items, seqRng(seed), (t) => t.artist);
      expect(out).toHaveLength(10);
      expect(adjacentSame(out)).toBeLessThanOrEqual(4);
      expect(adjacentSame(out)).toBeGreaterThanOrEqual(3); // cận dưới pigeonhole
    }
  });

  it("giữ nguyên bài đang phát ở vị trí đầu (keepFirst)", () => {
    const items: T[] = [];
    for (let a = 0; a < 3; a++) {
      for (let i = 0; i < 3; i++) items.push({ id: `a${a}-t${i}`, artist: `artist${a}` });
    }
    const keep = items[4]!;
    const out = smartShuffledWithRng(items, seqRng(7), (t) => t.artist, keep);
    expect(out[0]).toBe(keep);
    expect(out).toHaveLength(9);
    expect(adjacentSame(out)).toBe(0);
  });

  it("queue nhỏ (≤2) fallback random thuần, đủ bài", () => {
    const items: T[] = [
      { id: "x", artist: "A" },
      { id: "y", artist: "B" },
    ];
    const out = smartShuffledWithRng(items, seqRng(3), (t) => t.artist);
    expect(out).toHaveLength(2);
    expect(out).toContain(items[0]);
    expect(out).toContain(items[1]);
  });

  it("đủ bài khi nhiều nghệ sĩ 1 bài (không mất item nào)", () => {
    // 10 nghệ sĩ, mỗi người 1 bài — bucket = 10×1; furrow phẳng.
    const items: T[] = Array.from({ length: 10 }, (_, i) => ({ id: `solo-${i}`, artist: `art${i}` }));
    const out = smartShuffledWithRng(items, seqRng(9), (t) => t.artist);
    expect(out).toHaveLength(10);
    const ids = new Set(out.map((t) => t.id));
    expect(ids.size).toBe(10);
  });

  it("deterministic theo RNG — cùng seed ra cùng kết quả", () => {
    const items: T[] = [];
    for (let a = 0; a < 4; a++) {
      for (let i = 0; i < 3; i++) items.push({ id: `a${a}-t${i}`, artist: `artist${a}` });
    }
    const out1 = smartShuffledWithRng(items, seqRng(123), (t) => t.artist);
    const out2 = smartShuffledWithRng(items, seqRng(123), (t) => t.artist);
    expect(out1.map((x) => x.id)).toEqual(out2.map((x) => x.id));
  });

  it("không phá các contract Fisher-Yates cũ — shuffledWithRng vẫn hoạt động", () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffledWithRng(items, seqRng(5));
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual(items);
  });
});
