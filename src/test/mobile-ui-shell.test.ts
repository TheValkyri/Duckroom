import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MOBILE UI GUARD (MOBILE_UI_ARCHITECTURE §12).
 *
 * Static regression tests pinning the mobile shell contract that is easy
 * to break silently with a "quick CSS fix" and that no runtime test can
 * catch cheaply:
 *
 *  1. Safe-area plumbing: viewport-fit=cover + --safe-* tokens exist.
 *  2. The bottom nav dock renders exactly 4 primary destinations
 *     (information-architecture decision ADR-M2) with aria-current.
 *  3. Mini-player + fullscreen player + sheets reserve the safe bottom
 *     inset (pb-safe / bottom-safe) — notch devices must not clip them.
 *  4. PlayerBar routes the queue to the phone bottom sheet and the
 *     desktop drawer from one component (no duplicated player logic).
 *  5. Phone TrackRow exposes a non-hover entry to actions (the ⋯ sheet
 *     trigger) — touch devices have no hover, actions must stay reachable.
 */

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("mobile shell: safe-area plumbing", () => {
  it("viewport meta enables viewport-fit=cover (env(safe-area-*) resolves)", () => {
    const root = read("routes/__root.tsx");
    expect(root).toContain("viewport-fit=cover");
  });

  it("styles.css defines --safe-top/--safe-bottom tokens and pb-safe/bottom-safe utilities", () => {
    const css = read("styles.css");
    expect(css).toContain("--safe-top: max(env(safe-area-inset-top)");
    expect(css).toContain("--safe-bottom: max(env(safe-area-inset-bottom)");
    expect(css).toMatch(/@utility\s+pb-safe\s*\{/);
    expect(css).toMatch(/@utility\s+bottom-safe\s*\{/);
  });
});

describe("mobile shell: bottom navigation contract", () => {
  it("bottom dock has exactly 4 primary destinations", () => {
    const shell = read("components/AppShell.tsx");
    const m = shell.match(/const bottomNav = \[([\s\S]*?)\] as const;/);
    expect(m).toBeTruthy();
    const items = m?.[1]?.match(/\{ to: "/g) ?? [];
    expect(items.length).toBe(4);
  });

  it("bottom nav tabs announce current page via aria-current", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain('aria-current={isActive ? "page" : undefined}');
  });

  it("bottom nav is hidden on desktop (lg:hidden) and reserves the gesture bar", () => {
    const shell = read("components/AppShell.tsx");
    // flush to screen bottom; internal padding absorbs safe-area (pb-safe)
    expect(shell).toMatch(/fixed inset-x-0 bottom-0 z-30 border-t pb-safe lg:hidden/);
  });
});

describe("mobile shell: player surfaces respect safe areas", () => {
  it("phone mini-player dock is safe-area padded and 44px+ targets", () => {
    const bar = read("components/player/PlayerBar.tsx");
    // dock sits above the bottom nav (3.5rem) + gesture bar inset
    expect(bar).toMatch(/bottom-\[calc\(3\.5rem\+var\(--safe-bottom\)\)\]/);
    // play/next hit areas are size-11 (44px)
    expect(bar).toMatch(/grid size-11 shrink-0 place-items-center rounded-full/);
  });

  it("fullscreen player pads the top notch (pt-safe) and the home bar (pb-safe)", () => {
    const np = read("components/player/NowPlaying.tsx");
    expect(np).toContain("pt-safe");
    expect(np).toContain("pb-safe");
  });

  it("MobileSheet dialogs are safe-area padded and modal-labelled", () => {
    const sheet = read("components/MobileSheet.tsx");
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain("pb-safe");
  });
});

describe("mobile shell: queue + track actions reachable without hover", () => {
  it("phone queue uses QueueSheet while desktop keeps QueuePanel (one player API)", () => {
    const bar = read("components/player/PlayerBar.tsx");
    expect(bar).toContain("QueueSheet");
    expect(bar).toContain("useIsPhoneLayout()");
    const sheet = read("components/player/QueueSheet.tsx");
    // reorder is button-based (a11y-first like AD-11), no HTML5 drag on phone
    expect(sheet).toContain("moveInQueue");
    expect(sheet).not.toContain("draggable");
  });

  it("TrackRow exposes an actions sheet trigger that does not depend on hover", () => {
    const row = read("components/TrackRow.tsx");
    expect(row).toContain("TrackActionsSheet");
    expect(row).toMatch(/isPhone && \(\s*<motion\.button/);
  });

  it("TrackActionsSheet wires owner delete behind a two-step confirm (no alert)", () => {
    const sheet = read("components/TrackActionsSheet.tsx");
    expect(sheet).toContain("confirmingDelete");
    // no *invocation* of alert()/confirm() — comments may mention them
    expect(sheet).not.toMatch(/[^/\s]alert\(/);
    expect(sheet).not.toMatch(/[^/\s"']confirm\(/);
  });
});
