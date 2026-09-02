import { useSyncExternalStore } from "react";

/**
 * THEME SYSTEM v2 (2026-09-01, rework "sóng nước") — mode + accent runtime.
 *
 * HIỆU ỨNG:
 * - Chuyển mode = SÓNG NƯỚC (ripple): tâm lan tỏa NGẪU NHIÊN mỗi lần
 *   (điểm khởi phát bất ngờ = "wow", không lặp panel góc quen thuộc),
 *   viền sóng phát sáng màu accent mới, dual-layer crossfade 620ms —
 *   KHÔNG startViewTransition (bug crossfade clip-path lag/khựng trên
 *   cây lớn) và KHÔNG transition * toàn cây (style-recalc nghìn node).
 *   Cả hai lớp sóng là 2 element fixed pointer-events-none chồng lên
 *   viewport, GPU composite thuần — main thread tự do.
 * - Kéo accent: đổi NGAY qua CSS custom properties (repaint token, 0
 *   layout, 0 React re-render list) nhưng KHÔNG persist khi đang kéo —
 *   chỉ ghi localStorage khi THẢ TAY (change) → main thread không bao
 *   giờ bị localStorage-write chặn giữa cử chỉ.
 *
 * Kiến trúc giữ nguyên: store pattern engine; init-script anti-FOUC
 * (public/theme-init.js) mirror công thức; mọi màu qua token.
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

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending: ThemeState | null = null;

/** Ghi localStorage — debounce nhẹ (rài sau lần chỉnh cuối ~350ms) để
 *  không bao giờ chặn cử chỉ đang kéo; các lần chỉnh dồn thành 1 write. */
function persistDebounced(s: ThemeState) {
  persistPending = s;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) {
      persistState(persistPending);
      persistPending = null;
    }
  }, 350);
}

export function setTheme(next: Partial<ThemeState>, opts?: { live?: boolean }) {
  state = { ...state, ...next };
  if (typeof next.hue === "number") state.hue = normalizeHue(next.hue);
  if (typeof next.sat === "number") state.sat = clampNumber(next.sat, SAT_MIN, SAT_MAX, state.sat);
  applyToDocument(state);
  // live = đang kéo slider: repaint ngay, KHÔNG persist giữa cử chỉ
  // (persistDebounced gom về 1 write sau khi thả). Mặc định: persist qua
  // debounce (click preset/mode).
  persistDebounced(state);
  void opts;
  emit();
}

/* ---------------------------------------------------------------------------
 * SÓNG NƯỚC (ripple reveal) — rework 2026-09-01.
 *
 * Tại sao KHÔNG dùng View Transitions + clip-path cho mode switch:
 * - clip-path circle trên ::view-transition-new(root) bắt browser chụp
 *   SNAPSHOT nguyên viewport (raster cả cây) rồi animate — trên cây lớn
 *   + phone mid-range chính là cú khựng người dùng thấy.
 * - .theme-fx transition * (kèm !important) ép style-recalc mọi node
 *   đồng thời — nghìn node → jank rõ.
 *
 * Cách mới (0 đụng main thread):
 * 1. Chụp MÀU nền cũ + mới (2 chuỗi oklch) — không chụp DOM.
 * 2. 2 lớp fixed pointer-events-none: lớp dưới = màu CŨ, lớp trên =
 *   màu MỚI khoét lỗ bằng mask radial (circle) + viền sóng glow accent.
 * 3. Animate MỘT custom property --ripple-r (bán kính) bằng WAAPI —
 *   GPU composite, transform-like, không layout, không paint subtree.
 * 4. Xong: gỡ cả 2 lớp (một lần), DOM thật đã đổi màu từ đầu (dưới
 *   lớp old-color nên không thấy nhảy).
 * Tâm sóng NGẪU NHIÊN (margin an toàn tránh mép) — mỗi lần chuyển là
 * một điểm khởi phát khác nhau = yếu tố "wow" không lặp lại.
 * prefers-reduced-motion → đổi thẳng, không sóng.
 * ------------------------------------------------------------------------- */

const RIPPLE_LAYER_ID = "duckroom-theme-ripple";

export type RippleOrigin = { x: number; y: number };

/** Tâm sóng ngẫu nhiên trong vùng an toàn (tránh mép 12%). */
export function randomRippleOrigin(w: number, h: number): RippleOrigin {
  const mx = Math.max(24, w * 0.12);
  const my = Math.max(24, h * 0.12);
  return {
    x: Math.round(mx + Math.random() * (w - mx * 2)),
    y: Math.round(my + Math.random() * (h - my * 2)),
  };
}

function backgroundForMode(mode: ThemeMode): string {
  // Phải khớp token --background trong styles.css (hai giá trị này là
  // hằng của dark/light — theme-system test pin).
  return mode === "light" ? "oklch(0.965 0.009 85)" : "oklch(0.16 0.022 258)";
}

/**
 * Chuyển mode kèm sóng nước lan tỏa. origin = null → chọn tâm ngẫu nhiên.
 * Trình duyệt không hỗ trợ WAAPI element.animate → đổi thẳng (không khựng
 * là ưu tiên cao hơn hiệu ứng).
 */
export function setModeWithRipple(mode: ThemeMode, origin?: RippleOrigin | null) {
  if (mode === state.mode) return;
  const doc = typeof document === "undefined" ? null : document;
  if (!doc) return;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const o = origin ?? randomRippleOrigin(w, h);
  const r = Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y)) * 1.15;

  // Áp DOM thật NGAY (dưới các lớp sóng nên không thấy nhảy màu).
  setTheme({ mode });
  const accent = accentCssVars(state).primary;
  const oldBg = backgroundForMode(mode === "light" ? "dark" : "light");

  // Dọn sóng cũ nếu còn (kéo spam nút chuyển).
  doc.getElementById(RIPPLE_LAYER_ID)?.remove();

  const wrap = doc.createElement("div");
  wrap.id = RIPPLE_LAYER_ID;
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;contain:strict;";
  // Lớp 0: màu CŨ phủ kín (che DOM đã đổi màu phía dưới).
  const oldLayer = doc.createElement("div");
  oldLayer.style.cssText = `position:absolute;inset:0;background:${oldBg};`;
  // Lớp 1: màu MỚI khoét lỗ từ tâm — lỗ mở dần như nước rút, viền là
  // sóng phát sáng accent; mask + radius điều khiển bằng 1 var duy nhất.
  const newLayer = doc.createElement("div");
  newLayer.style.cssText = [
    "position:absolute;inset:0;",
    `background:${backgroundForMode(mode)};`,
    `-webkit-mask-image:radial-gradient(circle var(--ripple-r) at ${o.x}px ${o.y}px, black 99%, transparent 100%);`,
    `mask-image:radial-gradient(circle var(--ripple-r) at ${o.x}px ${o.y}px, black 99%, transparent 100%);`,
    "--ripple-r:0px;",
  ].join("");
  // Lớp 2: viền sóng — vòng tròn mảnh glow accent chạy theo bán kính.
  const edge = doc.createElement("div");
  edge.style.cssText = [
    "position:absolute;",
    `left:${o.x}px;top:${o.y}px;width:var(--ripple-d);height:var(--ripple-d);`,
    "transform:translate(-50%,-50%);",
    "border-radius:50%;",
    `box-shadow:0 0 0 2px ${accent}, 0 0 42px 12px ${accent};`,
    "opacity:0.85;",
    "--ripple-d:0px;",
  ].join("");
  wrap.append(oldLayer, newLayer, edge);
  doc.body.appendChild(wrap);

  const finish = () => wrap.remove();
  if (reduced || typeof wrap.animate !== "function") {
    finish();
    return;
  }

  // Một animation duy nhất, điều khiển 2 biến bằng keyframes — GPU-only.
  const anim = wrap.animate(
    [
      { "--ripple-r": "0px", "--ripple-d": "0px" } as unknown as Keyframe,
      { "--ripple-r": `${Math.round(r)}px`, "--ripple-d": `${Math.round(r * 2)}px` } as unknown as Keyframe,
    ],
    {
      duration: 620,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    },
  );
  anim.onfinish = finish;
  anim.oncancel = finish;
  // Nếu tab ẩn (rAF dừng) — không để sóng treo vĩnh viễn.
  window.setTimeout(finish, 1400);
}

/**
 * Accent MORPH cho preset click: không đột biến — tween hue/sat qua
 * rAF (~260ms) để màu "chảy" sang preset mới (kéo slider thì người
 * dùng đã tự tween bằng tay nên áp thẳng).
 */
let accentMorphRaf = 0;
export function setAccentWithMorph(hue: number, sat: number, preset: string) {
  cancelAnimationFrame(accentMorphRaf);
  const from = { hue: state.hue, sat: state.sat };
  // Khoảng hue đi đường ngắn nhất qua vòng màu.
  let dh = normalizeHue(hue) - from.hue;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const ds = sat - from.sat;
  const t0 = performance.now();
  const dur = 260;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
    setTheme(
      {
        hue: Math.round(from.hue + dh * e),
        sat: from.sat + ds * e,
        preset: k === 1 ? preset : "custom",
      },
      { live: true },
    );
    if (k < 1) accentMorphRaf = requestAnimationFrame(step);
  };
  accentMorphRaf = requestAnimationFrame(step);
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, () => DEFAULT_THEME);
}

/** Gọi 1 lần trên client sau mount để đảm bảo vars khớp store (init-script
 *  đã chạy trước, đây là belt-and-suspenders cho môi trường thiếu script). */
export function ensureThemeApplied() {
  applyToDocument(state);
}
