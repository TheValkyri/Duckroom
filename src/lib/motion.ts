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

export const springSnappy = { type: "spring", stiffness: 500, damping: 30, mass: 0.9 } as const;
export const springSmooth = { type: "spring", stiffness: 260, damping: 30 } as const;
export const springGentle = { type: "spring", stiffness: 180, damping: 26 } as const;
export const springPill = { type: "spring", stiffness: 420, damping: 34 } as const;

export const easeDuck = [0.22, 1, 0.36, 1] as const; // "duck glide" — ease-out mạnh, không nảy

export const durFast = 0.12;
export const durBase = 0.22;
export const durSlow = 0.42;

export const tweenFast = { duration: durFast, ease: easeDuck } as const;
export const tweenBase = { duration: durBase, ease: easeDuck } as const;
export const tweenSlow = { duration: durSlow, ease: easeDuck } as const;

// Micro-interaction chuẩn cho mọi nút bấm icon trong app
export const tapScale = { scale: 0.9 } as const;
export const hoverLift = { y: -1 } as const;

// Variants cho page/route transition (fade + dịch nhẹ theo trục Y)
export const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
} as const;

// Variants cho danh sách xuất hiện kiểu "stagger" nhẹ (album grid, track list...)
export const listContainerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
} as const;

export const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: durBase, ease: easeDuck } },
} as const;

// Variant cho modal/dialog dùng chung (overlay + panel)
export const modalOverlayVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: tweenBase },
  exit: { opacity: 0, transition: tweenFast },
} as const;

export const modalPanelVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 12 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSmooth },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: tweenFast },
} as const;
