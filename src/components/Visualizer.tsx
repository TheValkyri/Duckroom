import { useEffect, useRef } from "react";
import { getAudioAnalyser } from "../lib/audio-analyser";
import { usePlayer } from "../lib/player";
import { subscribeTheme, accentCssVars, getThemeState } from "../lib/theme";
import { cn } from "../lib/utils";

/**
 * Visualizer "sóng nhạc" (nâng cấp 2026-09-01).
 *
 * Về màu: đọc accent TỪ THEME STORE (oklch theo hue/sat hiện tại) — đổi
 * theme/preset/kéo slider là sóng đổi màu theo tức thì (trước đây hardcode
 * 3 stops vàng). Store subscribe nghĩa là không re-render — chỉ đổi chuỗi
 * màu trong vòng vẽ, 0 cost React.
 *
 * Về hình dạng: mỗi thanh = thân bo tròn + "lõi" sáng hơn chạy trong
 * (2 lớp roundRect) + bóng nhè dưới đáy — cảm giác ống đèn VU analog
 * thay vì cột phẳng. Đỉnh thanh có cap sáng accent hơn tạo mặt sóng.
 *
 * Về perf: như trước — rAF chỉ khi playing/đang hãm phanh; hidden-tab
 * skip work; dpr-cache; analyser cache theo element (crossfade flip).
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

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Màu theo theme runtime — cập nhật mỗi lần theme đổi (kể cả kéo
    // slider liên tục: đổi chuỗi, không tạo lại gì cả).
    let colors = { peak: "", body: "", core: "", base: "" };
    const refreshColors = () => {
      const s = accentCssVars(getThemeState());
      // Lấy L/C từ công thức rồi tự pha 3 bậc + alpha: đỉnh sáng nhất,
      // thân trung, chân mờ. Dùng cùng hue/sat người dùng đang chọn.
      const h = getThemeState().hue;
      const sat = getThemeState().sat;
      const dark = getThemeState().mode !== "light";
      const baseL = dark ? 0.76 : 0.52;
      colors = {
        peak: s.primary.replace(")", " / 0.98)"),
        body: `oklch(${(baseL - 0.06).toFixed(3)} ${sat} ${h} / 0.85)`,
        core: `oklch(${Math.min(0.97, baseL + 0.13).toFixed(3)} ${sat} ${h} / 0.9)`,
        base: `oklch(${(baseL - 0.24).toFixed(3)} ${(sat * 0.7).toFixed(3)} ${h} / 0.28)`,
      };
    };
    refreshColors();
    const unsub = subscribeTheme(refreshColors);

    let raf = 0;
    let t = 0;
    const freqData = new Uint8Array(64);
    let cachedAnalyserEl: HTMLAudioElement | null = null;
    let cachedAnalyser: AnalyserNode | null = null;

    const draw = () => {
      // Never orphan the loop: skip WORK on hidden tabs but always reschedule,
      // otherwise the animation freezes mid-deceleration and never resumes.
      if (document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }

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
          ctx.fillStyle = colors.body;
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

      const el = audioRef?.current ?? null;
      if (el !== cachedAnalyserEl) {
        cachedAnalyserEl = el;
        cachedAnalyser = el ? getAudioAnalyser(el) : null;
      }
      const analyser = cachedAnalyser;
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

        const distFromCenter = Math.abs(i - center) / center;
        const centerSwell = Math.cos(distFromCenter * (Math.PI / 2.2));

        if (playing) {
          if (hasRealAudioData) {
            const binIdx = Math.min(freqData.length - 1, Math.floor(Math.pow(1 - distFromCenter, 1.3) * 44));

            const trebleBoost = 1.0 + Math.pow(distFromCenter, 1.2) * 1.4;
            const bassBoost = 1.0 + (1 - distFromCenter) * bassEnergy * 1.1;

            const rawVal = ((freqData[binIdx] || 0) / 255) * bassBoost * trebleBoost;
            target = Math.min(1.0, Math.max(0.04, Math.pow(rawVal, 0.82) * 1.55 * centerSwell));
          } else if (!audioRef?.current) {
            const lowBass = Math.abs(Math.sin(t * 3.4 + i * 0.28) * 0.65 + Math.sin(t * 1.7) * 0.35);
            const midVocal = Math.abs(Math.sin(t * 5.2 + i * 0.42) * 0.5 + Math.sin(t * 2.8 + i * 0.15) * 0.35);
            const highTreble = Math.abs(Math.sin(t * 9.1 + i * 0.75) * 0.45 + Math.sin(t * 4.4) * 0.3);

            target =
              (lowBass * (1 - distFromCenter) * 0.9 + midVocal * 0.7 + highTreble * distFromCenter * 0.85) *
                centerSwell *
                0.88 +
              0.05;
          }
        }

        const prev = levels.current[i] ?? 0.04;
        const v = prev + (target - prev) * (playing && target > prev ? 0.55 : 0.12);
        levels.current[i] = v;

        if (Math.abs(v - target) > 0.005) {
          isSettled = false;
        }

        const bh = Math.max(2, v * h);
        const x = i * (bw + gap);
        const y = h - bh;

        // THANH 3 LỚP (VU analog):
        // 1) thân chính — gradient dọc theo 2 bậc màu theme
        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, colors.peak);
        grad.addColorStop(1, colors.base);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();

        // 2) lõi sáng bên trong (khoét vào 22% mỗi bên) — chiều cao tỉ lệ
        if (bh > 6) {
          const coreW = bw * 0.56;
          const coreH = bh * 0.72;
          const cx = x + (bw - coreW) / 2;
          ctx.fillStyle = colors.core;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.roundRect(cx, y + (bh - coreH) * 0.45, coreW, coreH, coreW / 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // 3) mặt sóng: cap sáng nhỏ trên đỉnh khi thanh đang "sống"
        if (v > 0.16) {
          const capH = Math.min(4, bh * 0.28);
          ctx.fillStyle = colors.peak;
          ctx.beginPath();
          ctx.roundRect(x, y, bw, capH, bw / 2);
          ctx.fill();
        }
      }

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
      unsub();
    };
  }, [bars, playing, audioRef]);

  return (
    <div className={cn("overflow-hidden shrink-0 pointer-events-none", className)}>
      <canvas ref={ref} style={{ height, width: "100%", display: "block" }} />
    </div>
  );
}
