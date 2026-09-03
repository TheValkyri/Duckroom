/**
 * SEARCH HISTORY (QoL A7, 2026-09-01) — 5 từ khóa gần nhất per page.
 *
 * - localStorage (duckroom.searchHistory.<scope>) — nhẹ, không cần server
 *   (từ khóa không phải dữ liệu cá nhân cần sync; Member sync là P2 sau
 *   này nếu muốn).
 * - Dedupe + unshift + cắt 5; giới hạn 40 ký tự/entry cho gọn.
 * - Host-agnostic: đọc storage QUA globalThis (browser có sẵn; test node
 *   tiêm bản Map giả) — pure functions, không cần jsdom.
 */
const KEY_PREFIX = "duckroom.searchHistory.";
const MAX_ITEMS = 5;
const MAX_LEN = 40;

type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

/** Browser → window.localStorage; test node → globalThis.localStorage giả. */
function storage(): StorageLike | null {
  const g = globalThis as Record<string, unknown>;
  const ls = g["localStorage"] as StorageLike | undefined;
  if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") return ls;
  return null;
}

export function readSearchHistory(scope: string): string[] {
  const ls = storage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(KEY_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

/** Ghi 1 từ khóa (trim + cắt dài). Trả về list mới (đầu tiên = mới nhất). */
export function pushSearchHistory(scope: string, term: string): string[] {
  const t = term.trim().slice(0, MAX_LEN);
  if (!t) return readSearchHistory(scope);
  const prev = readSearchHistory(scope).filter((x) => x.toLowerCase() !== t.toLowerCase());
  const next = [t, ...prev].slice(0, MAX_ITEMS);
  const ls = storage();
  if (ls) {
    try {
      ls.setItem(KEY_PREFIX + scope, JSON.stringify(next));
    } catch {
      // storage đầy/tắt — không phá flow.
    }
  }
  return next;
}

/** Xóa 1 entry (từng mục trong UI). */
export function removeSearchHistoryItem(scope: string, term: string): string[] {
  const next = readSearchHistory(scope).filter((x) => x !== term);
  const ls = storage();
  if (ls) {
    try {
      ls.setItem(KEY_PREFIX + scope, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

/** Xóa cả list. */
export function clearSearchHistory(scope: string): string[] {
  const ls = storage();
  if (ls) {
    try {
      ls.removeItem(KEY_PREFIX + scope);
    } catch {
      /* ignore */
    }
  }
  return [];
}
