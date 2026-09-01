import { Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

/**
 * Ảnh nền MV (v2 — 2026-09-01, feedback: "MV chưa có ảnh preview").
 * Chuỗi fallback 3 cấp:
 * 1. thumb trong DB (presigned) → <img>.
 * 2. KHÔNG có thumb → tự TẠO preview bằng cách decode frame đầu của
 *    video qua canvas: <video preload="metadata" muted #t=1> ẩn → khi
 *    frame đầu sẵn sàng (seeked) → vẽ vào canvas → dataURL làm ảnh.
 *    Presigned URL còn hạn thì luôn thành công; hết hạn → cấp 3.
 * 3. Placeholder trung tính (icon Film) — trung thực, không "bịa màu".
 *
 * Lý do không dùng <video> trực tiếp như ảnh: đã thử trước đây — khi URL
 * hết hạn browser decode empty frame và render gradient nâu giả làm
 * người dùng tưởng video "màu đó". Canvas chụp 1 lần + cache trong RAM
 * (map theo URL) thì UI luôn là ẢNH TĨNH rẻ, không decode lại.
 */
const previewCache = new Map<string, string>();

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
  const [mode, setMode] = useState<"img" | "generated" | "empty">(() => (thumb ? "img" : "empty"));
  const [generated, setGenerated] = useState<string | null>(() => (src ? (previewCache.get(src) ?? null) : null));
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Reset khi đổi nguồn.
  useEffect(() => {
    if (thumb) {
      setMode("img");
      return;
    }
    const cached = src ? previewCache.get(src) : undefined;
    if (cached) {
      setGenerated(cached);
      setMode("generated");
      return;
    }
    setGenerated(null);
    setMode("empty");
  }, [thumb, src]);

  // Cấp 2: sinh preview từ frame đầu của video qua canvas.
  const generateFromVideo = () => {
    const v = videoRef.current;
    if (!v || !src || mode === "img" || generated) return;
    if (v.readyState < 2 || v.videoWidth === 0) return; // chưa có frame
    try {
      // Giới hạn kích thước canvas — chỉ cần thumbnail, không cần full-res.
      const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.72);
      previewCache.set(src, url);
      setGenerated(url);
      setMode("generated");
    } catch {
      // Canvas tainted (URL không CORS) hoặc codec không decode — giữ empty.
    }
  };

  return (
    <>
      {mode === "img" && thumb ? (
        <img
          src={thumb}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setMode("empty")}
          className={cn("size-full object-cover", className)}
        />
      ) : mode === "generated" && generated ? (
        <img
          src={generated}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn("size-full object-cover", className)}
        />
      ) : (
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
      )}
      {/* Máy sinh preview: video ẩn (không chiếm layout), chỉ seek frame
          đầu rồi vẽ canvas. crossOrigin để canvas không bị tainted. */}
      {!thumb && !generated && src && mode === "empty" && (
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          muted
          playsInline
          crossOrigin="anonymous"
          onLoadedData={generateFromVideo}
          onSeeked={generateFromVideo}
          onError={() => void 0}
          className="pointer-events-none absolute size-px opacity-0"
          aria-hidden
          tabIndex={-1}
        />
      )}
    </>
  );
}
