import { Link2, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createAndShareLink, expiresAtFromChoice, type ShareExpiryChoice } from "../lib/share-client";
import { springSnappy, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";

const EXPIRY_OPTIONS: Array<{ id: ShareExpiryChoice; label: string }> = [
  { id: "forever", label: "Vĩnh viễn" },
  { id: "30d", label: "30 ngày" },
  { id: "7d", label: "7 ngày" },
  { id: "24h", label: "24 giờ" },
];

/**
 * §13.3 — share menu với lựa chọn thời hạn link. Dùng cho album/video pages;
 * TrackRow giữ hành vi chia sẻ tức thì (không thêm friction cho thao tác phổ
 biến nhất).
 */
export function ShareMenu({
  resourceType,
  resourceId,
  title,
  compact = false,
}: {
  resourceType: "album" | "video" | "playlist";
  resourceId: string;
  title: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const handleChoose = async (choice: ShareExpiryChoice) => {
    if (busy) return;
    setBusy(true);
    try {
      await createAndShareLink({ resourceType, resourceId, title, expiresInChoice: choice });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1400);
    } catch (err) {
      console.warn("Share error:", err);
      toast.error(`Không tạo được liên kết chia sẻ: ${err instanceof Error ? err.message : "lỗi không xác định."}`);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        whileTap={tapScale}
        transition={springSnappy}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tạo liên kết chia sẻ"
        aria-label="Tạo liên kết chia sẻ"
        className={cn(
          "flex items-center gap-2 rounded-full border transition-colors disabled:opacity-50 cursor-pointer",
          compact ? "px-3.5 py-1.5 text-xs" : "px-6 py-3 text-sm",
          done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border hover:bg-accent",
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Link2 className={cn(compact ? "size-3.5" : "size-4", done && "text-emerald-400")} />
        )}
        {compact ? (done ? "Đã tạo!" : busy ? "…" : "Chia sẻ") : done ? "Đã tạo!" : busy ? "Đang tạo…" : "Chia sẻ"}
      </motion.button>

      <AnimatePresence>
        {open && !busy && !done && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={springSnappy}
            role="menu"
            className="border-border bg-popover absolute left-0 top-12 z-30 w-44 overflow-hidden rounded-xl border shadow-xl backdrop-blur-md"
          >
            <p className="text-muted-foreground border-border border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider">
              Hiệu lực liên kết
            </p>
            {EXPIRY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                onClick={() => void handleChoose(option.id)}
                className="hover:bg-accent block w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer"
              >
                {option.label}
              </button>
            ))}
            <p className="text-muted-foreground border-border border-t px-3 py-2 text-[10px] leading-4">
              Link có thể bị thu hồi bất cứ lúc nào trong Owner console.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
