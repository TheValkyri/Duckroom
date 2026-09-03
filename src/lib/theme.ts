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

/* rAF-throttle cho emit khi drag liên tục: input có thể bắn 60-120 lần/giây
 * nhưng React chỉ cần re-render 1 lần/MỖI FRAME. applyToDocument (CSS var
 * write) vẫn chạy thẳng mỗi event — đó là phần người dùng "thấy" tức thì
 * (đổi màu), còn re-render swatch-label là phần được ghép frame. */
let emitRaf = 0;
function emitThrottled() {
  if (emitRaf) return;
  emitRaf = requestAnimationFrame(() => {
    emitRaf = 0;
    emit();
  });
}

export function setTheme(next: Partial<ThemeState>, opts?: { live?: boolean }) {
  state = { ...state, ...next };
  if (typeof next.hue === "number") state.hue = normalizeHue(next.hue);
  if (typeof next.sat === "number") state.sat = clampNumber(next.sat, SAT_MIN, SAT_MAX, state.sat);
  applyToDocument(state);
  // live = đang kéo slider: màu đổi NGAY (CSS var write thẳng — không
  // chờ frame), React UI ghép về 1 render/frame, KHÔNG persist giữa cử
  // chỉ. Mặc định (preset/mode): persist debounce + emit đầy đủ.
  if (opts?.live) {
    emitThrottled();
    persistDebounced(state);
  } else {
    emit();
    persistDebounced(state);
  }
  void opts;
}
/* ---------------------------------------------------------------------------
 * SÓNG NƯỚC v3 (fix "trắng tinh/đen thui" 2026-09-01).
 *
 * LỖI v2: phủ 2 lớp màu ĐẶC kín toàn màn (oldBg + newBg) → trong 620ms
 * người dùng thấy màn hình trống trơn đúng như feedback "khựng trắng
 * tinh hoặc đen thui rồi mới đổi". RẤT SAI — sóng phải là HIỆU ỨNG
 * quét trên NỘI DUNG, không phải màn màu che nội dung.
 *
 * v3 (chỉ 1 lớp, không che gì):
 * - DOM đổi màu NGAY như cũ (dưới sóng không thấy nhảy).
 * - MỘT layer duy nhất: vòng tròn viền (accent mới) + fill rất mờ
 *   (18%) chạy theo mặt sóng — như gợn nước ánh sáng quét qua, nội
 *   dung luôn thấy xuyên qua.
 * - Sóng lan từ tâm ngẫu nhiên ra ngoài; ngoài biên tan dần (mask).
 * - Vẫn GPU-only: 1 WAAPI trên 2 custom props, 0 snapshot, 0 recalc
 *   cây lớn; cleanup onfinish + failsafe 1.2s cho tab ẩn.
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

function accentFor(s: ThemeState): string {
  return accentCssVars(s).primary;
}

/**
 * Chuyển mode kèm sóng nước quét (không che nội dung). origin = null →
 * tâm ngẫu nhiên. WAAPI thiếu → đổi thẳng (không hiệu ứng).
 */
export function setModeWithRipple(mode: ThemeMode, origin?: RippleOrigin | null) {
  if (mode === state.mode) return;
  const doc = typeof document === "undefined" ? null : document;
  if (!doc) return;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Áp DOM thật NGAY (nội dung đổi màu tức thì — sóng chỉ là vệt quét).
  setTheme({ mode });

  if (reduced) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const o = origin ?? randomRippleOrigin(w, h);
  const r = Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y)) * 1.2;
  const accent = accentFor(state);

  // Dọn sóng cũ (kéo spam nút).
  doc.getElementById(RIPPLE_LAYER_ID)?.remove();

  const wrap = doc.createElement("div");
  wrap.id = RIPPLE_LAYER_ID;
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;contain:strict;";

  // MỘT vòng sóng: fill accent cực mờ (như gợn nước ánh sáng) + viền
  // sáng dày hơn. Vòng TĂNG dần từ tâm (giá trị -r → r) và chỉ hiện
  // MẶT SÓNG (dải mỏng), tan biến khi đi qua mép.
  const ring = doc.createElement("div");
  const ringSize = Math.round(r * 2);
  ring.style.cssText = [
    "position:absolute;",
    `left:${o.x}px;top:${o.y}px;`,
    `width:${ringSize}px;height:${ringSize}px;`,
    "transform:translate(-50%,-50%) var(--ripple-ring-scale,0);",
    "border-radius:50%;",
    // Dải ring: viền 2px accent + quầng 24px mờ; chiều dày tessler theo
    // tỉ lệ vòng để không quá mỏng ở bán kính lớn.
    `box-shadow:0 0 0 2px ${accent}, inset 0 0 0 2px ${accent}, 0 0 32px 6px ${accent} / 0.22;`,
    "opacity:0.95;",
    "--ripple-ring-scale:0;",
  ].join("");
  wrap.appendChild(ring);
  doc.body.appendChild(wrap);

  const finish = () => wrap.remove();
  if (typeof wrap.animate !== "function") {
    finish();
    return;
  }
  const anim = wrap.animate(
    [
      { "--ripple-ring-scale": "0", opacity: "0.95" } as unknown as Keyframe,
      { "--ripple-ring-scale": "1", opacity: "0.9" } as unknown as Keyframe,
      { "--ripple-ring-scale": "1", opacity: "0" } as unknown as Keyframe,
    ],
    {
      duration: 760,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    },
  );
  anim.onfinish = finish;
  anim.oncancel = finish;
  // Failsafe cho tab ẩn (rAF không vẽ).
  window.setTimeout(finish, 1300);
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
