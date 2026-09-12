import { Link2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { springSnappy, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";
import { ShareModal } from "./ShareModal";

/**
 * §13.3 — Nút chia sẻ mở ShareModal hoàn chỉnh với tùy chọn thời hạn,
 * xem trước thông tin và sao chép link an toàn.
 */
export function ShareMenu({
  resourceType,
  resourceId,
  title,
  subtitle,
  cover,
  compact = false,
}: {
  resourceType: "album" | "video" | "playlist";
  resourceId: string;
  title: string;
  subtitle?: string;
  cover?: string | null;
  compact?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <motion.button
        type="button"
        whileTap={tapScale}
        transition={springSnappy}
        onClick={() => setModalOpen(true)}
        title="Tạo liên kết chia sẻ"
        aria-label="Tạo liên kết chia sẻ"
        className={cn(
          "flex items-center gap-2 rounded-full border border-border hover:bg-accent transition-colors cursor-pointer",
          compact ? "px-3.5 py-1.5 text-xs" : "px-6 py-3 text-sm",
        )}
      >
        <Link2 className={compact ? "size-3.5 text-primary" : "size-4 text-primary"} />
        <span>Chia sẻ</span>
      </motion.button>

      <ShareModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        resourceType={resourceType}
        resourceId={resourceId}
        title={title}
        artistOrSubtitle={subtitle}
        cover={cover}
      />
    </>
  );
}
