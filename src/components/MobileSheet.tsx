import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { springSnappy, springSmooth, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";
import { useScrollLock } from "../hooks/use-scroll-lock";

/**
 * MobileSheet — bottom sheet primitive (MOBILE_UI_ARCHITECTURE §5).
 *
 * Lightweight, dependency-free alternative to vaul/Radix for the two
 * mobile-only surfaces (QueueSheet, TrackActionsSheet):
 * - Fixed to the bottom edge, full-width on phones, capped + rounded on
 *   wider touch viewports (max-w-md, still bottom-docked up to md).
 * - Drag-to-dismiss on the header handle area only — the body stays
 *   scrollable so sheet content never fights the dismiss gesture.
 * - Safe-area padded (pb-safe), Escape + backdrop close, focus moves into
 *   the sheet on open and returns to the invoker on close.
 * - Unmounts when closed (conditional render in parents) so closed sheets
 *   cost zero listeners/Renders.
 *
 * `reducedMotion="user"` (root MotionConfig) automatically strips the
 * slide/drag animations for users who ask for it.
 */
export function MobileSheet({
  open,
  onClose,
  title,
  children,
  maxHeightVh = 70,
  includeHandle = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxHeightVh?: number;
  includeHandle?: boolean;
}) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // QoL: khoá body-scroll khi sheet mở (consumer không cần tự làm).
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    // Dismiss on a committed downward flick or a 96px downward drag.
    if (info.offset.y > 96 || (info.velocity.y > 600 && info.offset.y > 24)) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] lg:hidden"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springSmooth}
            drag={includeHandle ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={handleDragEnd}
            style={{ maxHeight: `${maxHeightVh}dvh` }}
            className="bg-card border-border fixed inset-x-0 bottom-0 z-[80] flex flex-col rounded-t-3xl border-t pb-safe lg:hidden"
          >
            {includeHandle && (
              <div className="flex cursor-grab items-center justify-center pt-2.5 pb-1 active:cursor-grabbing">
                <div className="bg-muted h-1.5 w-10 rounded-full" aria-hidden />
              </div>
            )}
            <div className="flex shrink-0 items-center justify-between px-5 pt-1.5 pb-2">
              <h2 className="font-display truncate text-lg font-semibold text-foreground">{title}</h2>
              <motion.button
                onClick={onClose}
                aria-label={`Đóng ${title}`}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </motion.button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-2 pb-3">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
