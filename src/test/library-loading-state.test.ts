/**
 * WP3 2026-09-04 — Library loading-state contract guards.
 *
 * Feedback round: "vào web phải đợi 2-3s nó khựng cái rồi mới load full
 * album/thư viện". Root cause: client cache khởi đầu rỗng + KHÔNG có
 * trạng thái nào phân biệt "đang hydrate" với "thư viện thật trống" →
 * trang render empty-state onboarding sai nội dung rồi pop sang full
 * library đột ngột.
 *
 * Các guard dưới đây pin contract của fix:
 * 1. useLibrary snapshot PHẢI expose `status` (LibrarySyncStatus) —
 *    không có nó thì route không thể phân biệt hydrate/empty.
 * 2. Route content chính (index/library/albums) PHẢI render skeleton
 *    khi hydrate lần đầu — kiểm tra bằng static source check vì các
 *    route là file-route TanStack không render được ngoài browser.
 * 3. Skeleton KHÔNG được chứa spinner (quy ước feedback: layout giữ
 *    geometry, không spinner/glow) và KHÔNG artificial delay.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("library loading-state contract (WP3)", () => {
  it("useLibrary exposes sync status + error in the snapshot", () => {
    const src = read("src/lib/useLibrary.ts");
    expect(src).toContain("status: LibrarySyncStatus");
    expect(src).toContain("error: string | null");
    expect(src).toContain("status: librarySyncStatus");
  });

  it("data/library exports the LibrarySyncStatus type for the snapshot", () => {
    const src = read("src/data/library.ts");
    expect(src).toMatch(/export\s+type\s+LibrarySyncStatus/);
  });

  const skeletonRoutes: Array<[string, string]> = [
    ["src/routes/index.tsx", "HomeSkeleton"],
    ["src/routes/library.tsx", "LibrarySkeleton"],
    ["src/routes/albums.index.tsx", "AlbumsSkeleton"],
  ];

  it.each(skeletonRoutes)("%s renders its skeleton during initial hydration", (file, comp) => {
    const src = read(file);
    expect(src).toContain(comp);
    // Phân biệt hydrate (idle/syncing + chưa data) — không phải chỉ "syncing"
    // (sync ngầm sau khi có data KHÔNG được hiện skeleton lại).
    expect(src).toMatch(/isInitialHydrating/);
    expect(src).toMatch(/status === "idle" \|\| status === "syncing"|status === "idle"\s*\|\|\s*status === "syncing"/);
  });

  it("skeleton component family contains no spinner and no artificial delay", () => {
    const src = read("src/components/LibrarySkeleton.tsx");
    expect(src).not.toMatch(/animate-spin|Loader2/i);
    expect(src).not.toMatch(/setTimeout\s*\(\s*\d/);
    expect(src).toMatch(/role="status"/); // a11y: screen reader biết đang tải
  });

  it("skeleton uses geometry-preserving bones (skeleton-bone), not full-page blank", () => {
    const src = read("src/components/LibrarySkeleton.tsx");
    expect(src).toContain("skeleton-bone");
    expect(src).toMatch(/aspect-square/); // album grid geometry giữ đúng
  });
});
