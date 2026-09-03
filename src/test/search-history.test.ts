import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearSearchHistory,
  pushSearchHistory,
  readSearchHistory,
  removeSearchHistoryItem,
} from "../lib/search-history";

/**
 * QoL A7 — Search History guards (node env, storage tiêm qua globalThis).
 * localStorage per-scope; dedupe case-insensitive; cap 5; trim dài 40.
 * Module đọc storage qua globalThis → test tiêm Map-storage giả, không
 * cần jsdom (giữ nguyên tinh thần "no new deps" của repo).
 */
const scope = "test-qa";

class FakeLocalStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const g = globalThis as Record<string, unknown>;

beforeAll(() => {
  g["localStorage"] = new FakeLocalStorage();
});

afterAll(() => {
  delete g["localStorage"];
});

describe("search-history", () => {
  it("push ghi từ khóa mới nhất lên đầu", () => {
    clearSearchHistory(scope);
    pushSearchHistory(scope, "mck");
    const after = pushSearchHistory(scope, "hvl");
    expect(after[0]).toBe("hvl");
    expect(after[1]).toBe("mck");
  });

  it("dedupe case-insensitive — không trùng lặp", () => {
    clearSearchHistory(scope);
    pushSearchHistory(scope, "MCK");
    const after = pushSearchHistory(scope, "mck");
    expect(after).toHaveLength(1);
    expect(after[0]).toBe("mck"); // bản mới nhất thắng
  });

  it("cap 5 items — cũ nhất bị rơi", () => {
    clearSearchHistory(scope);
    for (let i = 1; i <= 7; i++) pushSearchHistory(scope, `kw${i}`);
    const after = readSearchHistory(scope);
    expect(after).toHaveLength(5);
    expect(after[0]).toBe("kw7");
    expect(after).not.toContain("kw1");
    expect(after).not.toContain("kw2");
  });

  it("trim + cắt 40 ký tự", () => {
    clearSearchHistory(scope);
    const long = "a".repeat(80);
    const after = pushSearchHistory(scope, `  ${long}  `);
    expect(after[0]).toHaveLength(40);
  });

  it("remove từng item + clear toàn bộ", () => {
    clearSearchHistory(scope);
    pushSearchHistory(scope, "x");
    pushSearchHistory(scope, "y");
    const afterRemove = removeSearchHistoryItem(scope, "x");
    expect(afterRemove).toEqual(["y"]);
    const afterClear = clearSearchHistory(scope);
    expect(afterClear).toEqual([]);
  });

  it("scope độc lập (library không dính scope khác)", () => {
    clearSearchHistory(scope);
    clearSearchHistory(scope + "-other");
    pushSearchHistory(scope, "only-a");
    expect(readSearchHistory(scope + "-other")).toEqual([]);
  });
});
