import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THEME SYSTEM GUARDS (2026-09-01).
 *
 * Rủi ro lớn nhất của theme runtime: init-script (public/theme-init.js)
 * và store (src/lib/theme.ts) là 2 bản sao cùng công thức — nếu lệch nhau
 * sẽ FOUC (flash màu mặc định) mỗi lần load. Các test này pin:
 *  1. Hai file dùng CÙNG key localStorage + cùng default + cùng clamp.
 *  2. styles.css có light-mode token block + view-transition rules +
 *     .theme-fx fallback (đủ 3 lớp chuyển mượt).
 *  3. Init script được mount trong __root trước khi CSS chính (thứ tự
 *     scripts/links pin cấu trúc — không test runtime render).
 *  4. Accent override tồn tại ở cả 2 nơi (JS set inline).
 */

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("theme: store & init-script parity (anti-FOUC)", () => {
  const store = read("src/lib/theme.ts");
  const init = read("public/theme-init.js");

  it("same storage key", () => {
    expect(store).toContain('"duckroom.theme.v1"');
    expect(init).toContain('"duckroom.theme.v1"');
  });

  it("same default accent (dark gold 66/0.14)", () => {
    expect(store).toContain('DEFAULT_THEME: ThemeState = { mode: "dark", preset: "gold", hue: 66, sat: 0.14 }');
    expect(init).toContain('var s = { mode: "dark", hue: 66, sat: 0.14 }');
  });

  it("same clamp bounds (sat 0.04..0.25)", () => {
    expect(store).toContain("SAT_MIN = 0.04");
    expect(store).toContain("SAT_MAX = 0.25");
    expect(init).toContain("0.25, Math.max(0.04");
  });

  it("same accent L formula per mode", () => {
    // dark L=0.76 / light L=0.52 — phải thấy cả hai file có cặp này.
    expect(store).toMatch(/dark \? 0\.76 : 0\.52/);
    expect(init).toMatch(/dark \? 0\.76 : 0\.52/);
  });

  it("same primary-foreground L formula", () => {
    expect(store).toMatch(/dark \? 0\.17 : 0\.985/);
    expect(init).toMatch(/dark \? 0\.17 : 0\.985/);
  });

  it("same token list overridden", () => {
    for (const token of ["--primary", "--primary-foreground", "--ring", "--sidebar-primary", "--chart-1"]) {
      expect(store).toContain(token);
      expect(init).toContain(token);
    }
  });

  it("init script never reads window (runs before DOM ready)", () => {
    // Chỉ dùng document.documentElement qua biến local; KHÔNG được đụng
    // outer window trong init (script chạy trong <head>).
    expect(init).not.toMatch(/\bwindow\./);
  });
});

describe("theme: CSS foundation", () => {
  const css = read("src/styles.css");

  it("light mode is a first-class token block (not inverted dark)", () => {
    expect(css).toContain('[data-theme="light"]');
    // Giấy ấm (warm paper) chứ không trắng thuần:
    expect(css).toMatch(/\[data-theme="light"\][\s\S]*?--background: oklch\(0\.965/);
  });

  it("view-transition rules present (circle reveal)", () => {
    expect(css).toContain("::view-transition-old(root)");
    expect(css).toContain("::view-transition-new(root)");
  });

  it(".theme-fx soft fallback present", () => {
    expect(css).toMatch(/\.theme-fx,/);
  });

  it("accent tokens defined as :root fallback (pre-hydration)", () => {
    // Nếu init script bị chặn, :root vẫn phải có accent mặc định.
    expect(css).toMatch(/:root[\s\S]*?--primary: oklch\(0\.76 0\.14 66\)/);
  });

  it("lyrics sheet animation is transform-safe (no offscreen base)", () => {
    // from phải là offset NHỎ (28px), KHÔNG phải 100% — QA lesson: nếu
    // animation stall, sheet không được biến mất khỏi màn hình.
    const m = css.match(/@keyframes lyricsSheetIn[\s\S]*?\}/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain("translateY(28px)");
    expect(m![0]).not.toContain("translateY(100%)");
  });
});

describe("theme: mount order in __root", () => {
  const root = read("src/routes/__root.tsx");

  it("init script registered in head", () => {
    expect(root).toContain("/theme-init.js");
  });

  it("ThemePicker entry reachable from AppShell", () => {
    const shell = read("src/components/AppShell.tsx");
    expect(shell).toContain("ThemePicker");
    expect(shell).toContain('aria-label="Tùy chỉnh giao diện"');
  });
});
