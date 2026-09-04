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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // Vẽ canvas khi peaks/size/theme đổi (không phải mỗi tick).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const s = accentCssVars(getThemeState());
      // Màu played = accent; unplayed = foreground alpha thấp — bar
      // played/unplayed vẽ TRONG 1 pass, progress overlay là CSS.
      // Vẽ unplayed trước (toàn bộ), played đè lên theo pct — CSS mask
      // đắt hơn; canvas vẽ 2 lớp vẫn 1 lần khi đổi peaks.
      const gap = w / WAVEFORM_BARS > 3 ? 1 : 0.5; // khe co lại khi hẹp
      const bw = Math.max(1.5, w / WAVEFORM_BARS - gap);
      const playedBars = Math.floor((pct / 100) * WAVEFORM_BARS);

      for (let i = 0; i < peaks.length; i++) {
        const v = peaks[i]! / 255;
        // Nhân thêm ~0.25 để bar thấp (intro im lặng) vẫn thấy được —
        // không phóng đại peak, chỉ đảm bảo hiển thị tối thiểu.
        const bh = Math.max(2, v * (h - 4) * 0.92 + 1.5);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.fillStyle = i <= playedBars ? s.primary : "oklch(from var(--foreground) l c h / 0.22)";
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      }
    };
    draw();
    const unsub = subscribeTheme(draw);
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      unsub();
      ro.disconnect();
    };
  }, [peaks, pct]);

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
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      {/* Peak null → fallback thanh trơn (như SeekBar cũ) — không fake. */}
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
