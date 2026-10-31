import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { springSnappy, tapScale } from "../lib/motion";
import { motion } from "motion/react";

export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  console.warn("[Duckroom Route Error Isolated]", error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Đã xảy ra lỗi khi tải dữ liệu cho trang này. Trình phát nhạc vẫn tiếp tục hoạt động.";

  return (
    <div className="flex min-h-[48vh] items-center justify-center px-4 py-12">
      <div className="bg-card/40 border-border/80 flex max-w-md flex-col items-center rounded-2xl border p-8 text-center shadow-lg backdrop-blur-sm">
        <div className="bg-destructive/10 text-destructive mb-4 grid size-12 place-items-center rounded-full">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="font-display text-xl font-semibold text-foreground">Không thể tải nội dung</h2>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{message}</p>
        <div className="mt-6 flex items-center gap-3">
          <motion.button
            onClick={() => reset()}
            whileTap={tapScale}
            transition={springSnappy}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium cursor-pointer shadow-sm transition-colors"
          >
            <RotateCcw className="size-3.5" /> Thử lại
          </motion.button>
        </div>
      </div>
    </div>
  );
}
