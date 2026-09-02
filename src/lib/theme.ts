import { useSyncExternalStore } from "react";

/**
 * THEME SYSTEM (2026-09-01) — mode + accent color runtime-able.
 *
 * Thiết kế:
 * - Mode (dark/light): đổi qua [data-theme="light"] trên <html> — toàn bộ
 *   token màu còn lại vẫn nằm ở một chỗ duy nhất trong styles.css (không
 *   có theme CSS thứ hai tách rời).
 * - Accent (màu nhấn): JS ghi đè trực tiếp các token --primary / --ring /
 *   --sidebar-primary / --chart-1 bằng oklch theo (hue, sat) — specificity
 *   cao nhất nên thắng cả hai mode; công thức L tự đổi theo mode để đảm bảo
 *   độ tương phản (dark: L=0.76, light: L=0.52).
 * - Store theo pattern engine (plain object + subscribe) để mọi component
 *   đọc theme không cần Context; FOUC chặn bằng public/theme-init.js chạy
 *   TRƯỚC hydrate (cùng công thức, mirror 1:1).
 * - Chuyển mode mượt: View Transitions API (circle reveal từ điểm bấm)
 *   nếu trình duyệt hỗ trợ; fallback: class .theme-fx transition màu 420ms.
 *   Drag slider accent thì ghi biến trực tiếp (repaint thuần, 0 layout).
 *
 * Quy tắc RR: mọi màu mới phải đi qua token — không hardcode hex.
 */

export type ThemeMode = "dark" | "light";

export type ThemeState = {
  mode: ThemeMode;
  /** Id preset hoặc "custom" khi người dùng kéo slider. */
  preset: string;
  hue: number; // 0..360
  sat: number; // 0.04..0.25
};

export const THEME_STORAGE_KEY = "duckroom.theme.v1";

export const ACCENT_PRESETS: ReadonlyArray<{ id: string; label: string; hue: number; sat: number }> = [
  { id: "gold", label: "Vàng đồng", hue: 66, sat: 0.14 },
  { id: "amber", label: "Hổ phách", hue: 48, sat: 0.16 },
  { id: "coral", label: "San hô", hue: 25, sat: 0.17 },
  { id: "rose", label: "Hồng", hue: 350, sat: 0.17 },
  { id: "violet", label: "Tím", hue: 295, sat: 0.18 },
  { id: "blue", label: "Xanh dương", hue: 255, sat: 0.16 },
  { id: "teal", label: "Xanh ngọc", hue: 190, sat: 0.14 },
  { id: "green", label: "Xanh lục", hue: 150, sat: 0.15 },
];

export const DEFAULT_THEME: ThemeState = { mode: "dark", preset: "gold", hue: 66, sat: 0.14 };

export const HUE_MIN = 0;
export const HUE_MAX = 360;
export const SAT_MIN = 0.04;
export const SAT_MAX = 0.25;

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHue(v: unknown): number {
  const n = clampNumber(v, 0, 720, DEFAULT_THEME.hue);
  return Math.round(((n % 360) + 360) % 360);
}

function loadState(): ThemeState {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeState>;
    const mode: ThemeMode = parsed.mode === "light" ? "light" : "dark";
    const hue = normalizeHue(parsed.hue);
    const sat = clampNumber(parsed.sat, SAT_MIN, SAT_MAX, DEFAULT_THEME.sat);
    const preset =
      typeof parsed.preset === "string" &&
      (ACCENT_PRESETS.some((p) => p.id === parsed.preset) || parsed.preset === "custom")
        ? parsed.preset
        : DEFAULT_THEME.preset;
    return { mode, preset, hue, sat };
  } catch {
    return DEFAULT_THEME;
  }
}

function persistState(s: ThemeState) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage disabled — theme vẫn hoạt động trong phiên.
  }
}

/**
 * Công thức accent dùng CHUNG cho store, init-script và test.
 * Pure — không đụng DOM.
 */
export function accentCssVars(state: ThemeState): { primary: string; primaryForeground: string } {
  const dark = state.mode !== "light";
  const L = dark ? 0.76 : 0.52;
  const pfL = dark ? 0.17 : 0.985;
  const pfS = dark ? Math.max(0.02, state.sat * 0.22) : 0.015;
  const hue = normalizeHue(state.hue);
  return {
    primary: `oklch(${L.toFixed(3)} ${state.sat.toFixed(3)} ${hue})`,
    primaryForeground: `oklch(${pfL.toFixed(3)} ${pfS.toFixed(3)} ${hue})`,
  };
}

function applyToDocument(s: ThemeState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", s.mode);
  const { primary, primaryForeground } = accentCssVars(s);
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-foreground", primaryForeground);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-primary-foreground", primaryForeground);
  root.style.setProperty("--sidebar-ring", primary);
  root.style.setProperty("--chart-1", primary);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", s.mode === "light" ? "#f7f6f3" : "#09090b");
}

/* ---------------- Store (pattern player-engine) ---------------- */

let state: ThemeState = loadState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getThemeState(): ThemeState {
  return state;
}

export function setTheme(next: Partial<ThemeState>) {
  state = { ...state, ...next };
  if (typeof next.hue === "number") state.hue = normalizeHue(next.hue);
  if (typeof next.sat === "number") state.sat = clampNumber(next.sat, SAT_MIN, SAT_MAX, state.sat);
  applyToDocument(state);
  persistState(state);
  emit();
}

/**
 * Chuyển mode với hiệu ứng "tròn lan tỏa" từ điểm bấm (peak moment có lý
 * do: người dùng thấy CHÍNH XÁC vùng màu mới tràn từ ngón tay mình ra).
 * Trình duyệt không hỗ trợ View Transitions → fallback .theme-fx transition
 * màu 420ms. prefers-reduced-motion → áp ngay không hiệu ứng.
 */
export async function setModeWithReveal(mode: ThemeMode, origin?: { x: number; y: number } | null) {
  if (mode === state.mode) return;
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> };
  };
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced || typeof doc.startViewTransition !== "function" || !origin) {
    if (!reduced && typeof doc.startViewTransition !== "function") {
      // Fallback mềm: bật transition màu tạm thời trên toàn cây.
      const root = document.documentElement;
      root.classList.add("theme-fx");
      setTheme({ mode });
      window.setTimeout(() => root.classList.remove("theme-fx"), 480);
      return;
    }
    setTheme({ mode });
    return;
  }

  const vt = doc.startViewTransition(() => {
    setTheme({ mode });
  });
  try {
    await vt.ready;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y));
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${origin.x}px ${origin.y}px)`,
          `circle(${Math.round(r)}px at ${origin.x}px ${origin.y}px)`,
        ],
      },
      {
        duration: 520,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  } catch {
    // view transition bị skip (tab ẩn/timeout) — state đã áp, an toàn.
  }
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, () => DEFAULT_THEME);
}

/** Gọi 1 lần trên client sau mount để đảm bảo vars khớp store (init-script
 *  đã chạy trước, đây là belt-and-suspenders cho môi trường thiếu script). */
export function ensureThemeApplied() {
  applyToDocument(state);
}
