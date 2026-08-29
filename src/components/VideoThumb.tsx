import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

/**
 * Ảnh nền MV — chuỗi fallback đơn giản (overhaul 2026-08-29):
 * 1. Có thumb trong DB → <img>. Lỗi (403 URL hết hạn) → placeholder.
 * 2. Không có thumb → placeholder TRUNG TÍNH (icon Film).
 *
 * ⚠️  Video fallback (<video preload="metadata" #t=0.8>) đã bị XÓA:
 * presigned URL hết hạn → browser decode empty frame → render gradient
 * nâu giả (user thấy "video này đâu có màu đó"). Placeholder trung tính
 * trung thực hơn nhiều.
 */
export function VideoThumb({
  src,
  thumb,
  alt,
  className,
}: {
  src?: string | undefined;
  thumb?: string | undefined;
  alt: string;
  className?: string;
}) {
  // "img" → "empty". Nhảy xuống cấp khi nguồn hiện tại lỗi thật sự.
  const [mode, setMode] = useState<"img" | "empty">(() => (thumb ? "img" : "empty"));

  useEffect(() => {
    setMode(thumb ? "img" : "empty");
  }, [thumb, src]);

  if (mode === "img" && thumb) {
    return (
      <img
        src={thumb}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setMode("empty")}
        className={cn("size-full object-cover", className)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn("bg-card/80 size-full grid place-items-center border-b border-white/5", className)}
    >
      <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
        <Film className="size-8" />
        <span className="text-[10px] uppercase tracking-widest">Master gốc</span>
      </div>
    </div>
  );
}
