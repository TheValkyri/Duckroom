import { Link } from "@tanstack/react-router";
import { BarChart3, Disc, Disc3, ShieldCheck, UploadCloud, Users, X } from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "motion/react";

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
}

export function MobileMoreSheet({ open, onClose, isOwner }: MobileMoreSheetProps) {
  const dragControls = useDragControls();

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || (info.velocity.y > 600 && info.offset.y > 24)) onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Xem thêm mục điều hướng"
            className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[28px] border-t border-white/10 bg-card/95 backdrop-blur-md pb-safe lg:hidden select-none"
          >
            <div
              className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing touch-none"
              aria-hidden
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="h-1.5 w-10 rounded-full bg-white/25 pointer-events-none" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1.5 pb-2">
              <h2 className="font-display text-lg font-semibold">Khám phá</h2>
              <button
                onClick={onClose}
                aria-label="Đóng bảng xem thêm"
                className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
              >
                <X className="size-5 pointer-events-none" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {[
                { to: "/friends", label: "Bạn bè", icon: Users, desc: "Kết nối bạn bè" },
                { to: "/albums", label: "Albums", icon: Disc3, desc: "Bộ sưu tập đĩa" },
                { to: "/singles", label: "Đĩa đơn", icon: Disc, desc: "Single & EP" },
                { to: "/stats", label: "Thống kê", icon: BarChart3, desc: "Số liệu nghe của bạn" },
                ...(isOwner
                  ? [
                      { to: "/upload", label: "Tải lên", icon: UploadCloud, desc: "Trung tâm tiếp nhận" },
                      { to: "/admin", label: "Owner Console", icon: ShieldCheck, desc: "Quản trị hệ thống" },
                    ]
                  : []),
              ].map(({ to, label, icon: Icon, desc }) => (
                <Link
                  key={to}
                  to={to}
                  preload="intent"
                  preloadDelay={80}
                  onClick={onClose}
                  className="border-border bg-background/50 flex min-h-20 flex-col items-start justify-center gap-1 rounded-2xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer touch-manipulation select-none active:scale-[0.98] active:bg-primary/10"
                >
                  <Icon className="text-primary size-5 pointer-events-none" />
                  <span className="text-sm font-semibold pointer-events-none">{label}</span>
                  <span className="text-muted-foreground text-xs pointer-events-none">{desc}</span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] bg-black/50 lg:hidden"
            onClick={onClose}
            aria-hidden
          />
        )}
      </AnimatePresence>
    </>
  );
}
