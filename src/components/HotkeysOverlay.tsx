import { useEffect, useState } from "react";

/**
 * HOTKEYS OVERLAY (QoL A5) — Shift+/ (hay "?") hiện bảng phím tắt.
 * Desktop-only mọi phím có ý nghĩa; overlay đóng bằng Esc/click nền/`?`.
 * Không render gì trên phone (không bàn phím).
 */
const KEYS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "Space", label: "Phát / Tạm dừng" },
  { keys: "Shift + →", label: "Bài kế tiếp" },
  { keys: "Shift + ←", label: "Bài trước (hoặc tua lại từ đầu)" },
  { keys: "S", label: "Trộn bài" },
  { keys: "R", label: "Lặp lại: Tắt → Tất cả → Một bài" },
  { keys: "L", label: "Bật/tắt lời bài hát" },
  { keys: "Esc", label: "Thu nhỏ trình phát" },
  { keys: "?", label: "Bảng phím tắt này" },
];

export function HotkeysOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/input|textarea|select/i.test(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Mở bằng Shift+/ (=> "?") hoặc "?" thường.
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {open && (
        <>
          {/* Backdrop: entrance fade CSS thuần; đóng = unmount ngay
              (utility overlay không cần exit animation — tránh class bug
              motion-exit stall trong tab occluded). */}
          <div
            className="hotkeys-in fixed inset-0 z-[85] bg-black/55 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-0 z-[90] grid place-items-center p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Phím tắt"
              className="hotkeys-in bg-card border-border w-full max-w-sm overflow-hidden rounded-3xl border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-border border-b px-6 py-4">
                <h2 className="font-display text-xl font-semibold">Phím tắt</h2>
                <p className="text-muted-foreground mt-0.5 text-xs">Nhấn Esc hoặc ? để đóng</p>
              </div>
              <ul className="p-3">
                {KEYS.map((k) => (
                  <li
                    key={k.keys}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-accent/40"
                  >
                    <span className="text-muted-foreground">{k.label}</span>
                    <kbd className="bg-muted text-foreground rounded-lg border border-border/60 px-2 py-1 font-mono text-[11px] font-semibold shadow-sm">
                      {k.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}
