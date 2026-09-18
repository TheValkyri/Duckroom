import { Link } from "@tanstack/react-router";
import { BarChart3, Disc, Disc3, ShieldCheck, UploadCloud, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
}

export function MobileMoreSheet({ open, onClose, isOwner }: MobileMoreSheetProps) {
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
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || (info.velocity.y > 600 && info.offset.y > 24)) onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Xem thêm mục điều hướng"
            className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[28px] border-t border-white/10 bg-card/95 backdrop-blur-md pb-safe lg:hidden"
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing" aria-hidden>
              <div className="h-1.5 w-10 rounded-full bg-white/25" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1.5 pb-2">
              <h2 className="font-display text-lg font-semibold">Khám phá</h2>
              <button
                onClick={onClose}
                aria-label="Đóng bảng xem thêm"
                className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {[
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
                  onClick={onClose}
                  className="border-border bg-background/50 flex min-h-20 flex-col items-start justify-center gap-1 rounded-2xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
                >
                  <Icon className="text-primary size-5" />
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-muted-foreground text-xs">{desc}</span>
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
