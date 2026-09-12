import { useEffect, useRef, useState } from "react";
import { getTrackPeaks, WAVEFORM_BARS } from "../../lib/waveform-peaks";
import { usePlayer, usePlayerTime } from "../../lib/player";
import { subscribeTheme, accentCssVars, getThemeState } from "../../lib/theme";
import { cn } from "../../lib/utils";

/**
 * WAVEFORM SEEK BAR (F5 2026-09-04).
 *
 * Sóng THẬT của bài (96 peak bars — xem lib/waveform-peaks.ts) thay thanh
 * trơn: phần đã phát màu accent, phần chưa phát mờ — click lên đỉnh sóng
 * để seek. Đây là signature feature: waveform là DNA Duckroom nhưng từ
 * trước đến giờ chỉ là visualizer trang trí — giờ nó là CÔNG CỤ.
 *
 * Rendering: canvas 2D, vẽ LẦN khi peaks/size đổi + progress overlay cập
 * nhật bằng CSS width (không vẽ lại canvas mỗi tick — timeupdate chỉ đổi
 * width của 1 div). Peak bars vẽ mirrored quanh trục giữa kiểu SoundCloud.
 *
 * Fallback trung thực: không có peaks (chưa fetch xong / decode fail) →
 * thanh trơn như cũ. KHÔNG fake waveform vuông đều.
 *
 * Chỉ render ở NowPlaying (fullscreen) — không nằm PlayerBar mini.
 */
export function WaveformSeekBar({ height = 44 }: { height?: number }) {
  const { current, seek } = usePlayer();
  const time = usePlayerTime();
  const unplayedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Uint8Array | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const trackId = current?.id;
  const src = current?.src;

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    setPeaks(null);
    // Chỉ fetch peaks khi bài đang mở fullscreen — decode 30-100MB không
    // phải việc làm ngầm mỗi lần đổi bài trong mini-player.
    void getTrackPeaks(trackId, src).then((p: Uint8Array | null) => {
      if (!cancelled) setPeaks(p);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId, src]);

  const duration = current?.duration || 1;
  const displayTime = dragTime ?? time;
  const pct = Math.min(100, Math.max(0, (displayTime / duration) * 100));

  // Vẽ canvas khi peaks/size/theme đổi (KHÔNG vẽ lại mỗi tick — tiến trình cập nhật bằng CSS clipPath).
  useEffect(() => {
    const unplayedCanvas = unplayedCanvasRef.current;
    const playedCanvas = playedCanvasRef.current;
    if (!unplayedCanvas || !playedCanvas || !peaks) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = unplayedCanvas.clientWidth;
      const h = unplayedCanvas.clientHeight;
      if (w === 0 || h === 0) return;

      const gap = w / WAVEFORM_BARS > 3 ? 1 : 0.5;
      const bw = Math.max(1.5, w / WAVEFORM_BARS - gap);
      const s = accentCssVars(getThemeState());

      const renderLayer = (cvs: HTMLCanvasElement, fillStyle: string) => {
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
          cvs.width = w * dpr;
          cvs.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = fillStyle;

        for (let i = 0; i < peaks.length; i++) {
          const v = peaks[i]! / 255;
          const bh = Math.max(2, v * (h - 4) * 0.92 + 1.5);
          const x = i * (bw + gap);
          const y = (h - bh) / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, bw, bh, bw / 2);
          ctx.fill();
        }
      };

      renderLayer(unplayedCanvas, "oklch(from var(--foreground) l c h / 0.22)");
      renderLayer(playedCanvas, s.primary);
    };

    draw();
    const unsub = subscribeTheme(draw);
    const ro = new ResizeObserver(draw);
    ro.observe(unplayedCanvas);
    return () => {
      unsub();
      ro.disconnect();
    };
  }, [peaks]);

  // Tính thời gian theo vị trí pointer — dùng cho cả click + drag.
  const timeFromPointer = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  return (
    <div
      className="group relative w-full cursor-pointer touch-none select-none"
      style={{ height }}
      role="slider"
      aria-label="Tiến trình phát (sóng âm)"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={displayTime}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          seek(Math.min(duration, displayTime + 5));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          seek(Math.max(0, displayTime - 5));
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragTime(timeFromPointer(e.clientX, e.currentTarget));
      }}
      onPointerMove={(e) => {
        if (dragTime !== null) setDragTime(timeFromPointer(e.clientX, e.currentTarget));
      }}
      onPointerUp={(e) => {
        if (dragTime !== null) {
          seek(timeFromPointer(e.clientX, e.currentTarget));
          setDragTime(null);
        }
      }}
      onPointerCancel={() => setDragTime(null)}
    >
      {/* Unplayed layer (toàn bộ các thanh màu mờ) */}
      <canvas ref={unplayedCanvasRef} className="absolute inset-0 size-full" aria-hidden />
      {/* Played layer (các thanh màu accent được clip theo tiến độ pct bằng CSS GPU) */}
      <canvas
        ref={playedCanvasRef}
        className="pointer-events-none absolute inset-0 size-full"
        style={{ clipPath: `inset(0 calc(100% - ${pct}%) 0 0)` }}
        aria-hidden
      />
      {!peaks && (
        <div className="pointer-events-none absolute inset-0 grid items-center">
          <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {/* Kim hover (desktop) — hiển thị điểm sẽ seek tới. */}
      <div
        className="pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-foreground/50 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `calc(${pct}% - 1px)` }}
        aria-hidden
      />
    </div>
  );
}
