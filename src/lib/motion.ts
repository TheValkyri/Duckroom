/**
 * Motion Design Tokens — Duckroom
 * ---------------------------------------------------------------------------
 * Bộ token chuyển động dùng chung cho toàn app để mọi animation (nút bấm,
 * tab sidebar, panel, route transition, list...) có cùng một "nhịp" và "độ
 * nảy", thay vì mỗi nơi tự bịa ra duration/stiffness/damping riêng.
 *
 * Quy tắc chọn loại animation:
 * - spring "snappy"  → phản hồi tức thời cho tương tác trực tiếp (nút bấm, tab, toggle)
 * - spring "smooth"  → panel/sheet trượt vào (queue, cover art, info block)
 * - spring "gentle"  → chuyển động lớn mang tính "không gian" (overlay Now Playing)
 * - spring "pill"    → viên nền active trượt giữa các tab
 * - tween "fast/base/slow" → fade/crossfade thuần, không có yếu tố vật lý
 *
 * Luôn ưu tiên animate transform & opacity (GPU compositing) — tránh animate
 * width/height/padding/top/left vì ép trình duyệt reflow (layout) mỗi frame,
 * nguyên nhân phổ biến gây giật/khựng.
 */

export const springSnappy = { type: "spring", stiffness: 450, damping: 28, mass: 0.8 } as const;
export const springSmooth = { type: "spring", stiffness: 240, damping: 26 } as const;
export const springGentle = { type: "spring", stiffness: 160, damping: 24 } as const;
export const springPill = { type: "spring", stiffness: 380, damping: 30 } as const;

export const easeDuck = [0.16, 1, 0.3, 1] as const; // "duck glide" — ultra-smooth ease-out

export const durFast = 0.16;
export const durBase = 0.32;
export const durSlow = 0.5;

export const tweenFast = { duration: durFast, ease: easeDuck } as const;
export const tweenBase = { duration: durBase, ease: easeDuck } as const;
export const tweenSlow = { duration: durSlow, ease: easeDuck } as const;

// Micro-interaction chuẩn cho mọi nút bấm icon trong app
export const tapScale = { scale: 0.92 } as const;
export const hoverLift = { y: -2 } as const;

// Variants cho page/route transition (fade + dịch nhẹ theo trục Y)
export const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: tweenBase },
  exit: { opacity: 0, y: -6, transition: tweenFast },
} as const;

// Variants cho danh sách xuất hiện kiểu "stagger" nhẹ mượt mà (album grid, track list...)
export const listContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.01 },
  },
} as const;

export const listItemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: durBase, ease: easeDuck } },
} as const;

// Variant cho modal/dialog dùng chung (overlay + panel)
export const modalOverlayVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: tweenBase },
  exit: { opacity: 0, transition: tweenFast },
} as const;

export const modalPanelVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 14 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSmooth },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: tweenFast },
} as const;

// Cross-dissolve cho cover art swap — chỉ opacity, không y-shift, tránh layout shift
export const coverSwapVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: easeDuck } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
} as const;

