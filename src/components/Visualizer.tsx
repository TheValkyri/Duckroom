import { useEffect, useRef } from "react";
import { getAudioAnalyser } from "../lib/audio-analyser";
import { usePlayer } from "../lib/player";
import { cn } from "../lib/utils";

/**
 * Motion graph: Phổ tần số dồn vào chính giữa (Center-Symmetric Swell)
 * Hỗ trợ tự động hãm phanh mượt khi Pause (Deceleration 300ms)
 * và giữ phẳng lặng tuyệt đối khi nhạc im lặng (Silence/Outro).
 */
export function Visualizer({
  playing,
  bars = 48,
  className = "",
  height = 64,
}: {
  playing: boolean;
  bars?: number;
  className?: string;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const levels = useRef<number[]>(Array.from({ length: bars }, () => 0.04));
  const { audioRef } = usePlayer();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let t = 0;
    const freqData = new Uint8Array(64);

    const draw = () => {
      if (document.hidden) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (prefersReducedMotion) {
        const gap = 2;
        const bw = Math.max(2, w / bars - gap);
        for (let i = 0; i < bars; i++) {
          const bh = 4;
          const x = i * (bw + gap);
          const y = h - bh;
          ctx.fillStyle = "oklch(0.82 0.14 70 / 0.4)";
          ctx.beginPath();
          ctx.roundRect(x, y, bw, bh, bw / 2);
          ctx.fill();
        }
        return;
      }

      t += 0.035;
      const gap = 2;
      const bw = Math.max(2, w / bars - gap);
      let isSettled = true;

      // Đọc phổ tần số thực tế từ Web Audio API AnalyserNode
      const analyser = audioRef?.current ? getAudioAnalyser(audioRef.current) : null;
      let hasRealAudioData = false;
      let bassEnergy = 0;

      if (analyser && playing) {
        analyser.getByteFrequencyData(freqData);
        hasRealAudioData = freqData.some((v) => v > 0);
        if (hasRealAudioData) {
          const bassSum = (freqData[0] || 0) + (freqData[1] || 0) + (freqData[2] || 0) + (freqData[3] || 0);
          bassEnergy = bassSum / (4 * 255);
        }
      }

      const center = (bars - 1) / 2 || 1;

      for (let i = 0; i < bars; i++) {
        let target = 0.04;

        // Tính khoảng cách từ vị trí i đến trung tâm để tạo kiểu hình "2 bên dồn vào chính giữa"
        const distFromCenter = Math.abs(i - center) / center;
        const centerSwell = Math.cos(distFromCenter * (Math.PI / 2.2));

        if (playing) {
          if (hasRealAudioData) {
            // Ánh xạ tần số: Bass ở trung tâm, Treble dồn về 2 mép
            const binIdx = Math.min(
              freqData.length - 1,
              Math.floor(Math.pow(1 - distFromCenter, 1.3) * 44),
            );

            const trebleBoost = 1.0 + Math.pow(distFromCenter, 1.2) * 1.4;
            const bassBoost = 1.0 + (1 - distFromCenter) * bassEnergy * 1.1;

            const rawVal = ((freqData[binIdx] || 0) / 255) * bassBoost * trebleBoost;
            target = Math.min(1.0, Math.max(0.04, Math.pow(rawVal, 0.82) * 1.55 * centerSwell));
          } else if (!audioRef?.current) {
            // Chỉ chạy sóng giả lập nếu KHÔNG CÓ phần tử audio (mô phỏng UI)
            const lowBass = Math.abs(Math.sin(t * 3.4 + i * 0.28) * 0.65 + Math.sin(t * 1.7) * 0.35);
            const midVocal = Math.abs(Math.sin(t * 5.2 + i * 0.42) * 0.5 + Math.sin(t * 2.8 + i * 0.15) * 0.35);
            const highTreble = Math.abs(Math.sin(t * 9.1 + i * 0.75) * 0.45 + Math.sin(t * 4.4) * 0.3);

            target =
              (lowBass * (1 - distFromCenter) * 0.9 +
                midVocal * 0.7 +
                highTreble * distFromCenter * 0.85) *
                centerSwell *
                0.88 +
              0.05;
          }
          // Nếu có audioRef nhưng nhạc im lặng (Outro / Silence), target giữ nguyên 0.04 (phẳng lặng)
        }

        const prev = levels.current[i] ?? 0.04;
        // Tốc độ nẩy snappy khi Play (0.55) và HÃM PHANH MƯỢT 300ms khi Pause / Im lặng (0.12)
        const v = prev + (target - prev) * (playing && target > prev ? 0.55 : 0.12);
        levels.current[i] = v;

        if (Math.abs(v - target) > 0.005) {
          isSettled = false;
        }

        const bh = Math.max(2, v * h);
        const x = i * (bw + gap);
        const y = h - bh;

        // Gradient màu rực rỡ từ trên đỉnh xuống chân thanh sóng
        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, "oklch(0.86 0.18 75 / 0.98)");
        grad.addColorStop(0.5, "oklch(0.72 0.15 65 / 0.85)");
        grad.addColorStop(1, "oklch(0.48 0.10 40 / 0.3)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      }

      // Tiếp tục vẽ nếu đang phát nhạc HOẶC thanh sóng chưa hoàn tất hãm phanh hạ xuống phẳng
      if (playing || !isSettled) {
        raf = requestAnimationFrame(draw);
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && (playing || !ref.current)) {
        raf = requestAnimationFrame(draw);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [bars, playing, audioRef]);

  return (
    <div className={cn("overflow-hidden shrink-0 pointer-events-none", className)}>
      <canvas ref={ref} style={{ height, width: "100%", display: "block" }} />
    </div>
  );
}