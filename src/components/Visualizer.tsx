import { useEffect, useRef, useState } from "react";
import { Activity, BarChart3, Orbit, Sparkles } from "lucide-react";
import { getAudioAnalyser } from "../lib/audio-analyser";
import { usePlayer } from "../lib/player";
import { subscribeTheme, accentCssVars, getThemeState } from "../lib/theme";
import { getSavedVisualizerMode, saveVisualizerMode, type VisualizerMode } from "../lib/visualizer-storage";
import { cn } from "../lib/utils";

export type { VisualizerMode };

export interface VisualizerProps {
  playing: boolean;
  bars?: number;
  className?: string;
  height?: number;
  mode?: VisualizerMode;
  showModeControls?: boolean;
  onModeChange?: (mode: VisualizerMode) => void;
}

/**
 * Visualizer Đa Dạng Hóa (Visuals & Lyrics 2.0).
 *
 * Hỗ trợ 4 chế độ hiển thị âm thanh Audio-Reactive độc bản:
 * 1. "bars" — VU Analog Spectrum (3 lớp thân + lõi + cap sáng theo theme)
 * 2. "wave" — Oscilloscope Glowing Ribbon (sóng âm mượt mà đa tầng với gradient lụa)
 * 3. "kinetic-3d" — 3D Canvas Kinetic Sphere & Audio Wireframe (khối cầu 3D tương tác rung theo tần số)
 * 4. "particles" — Audio Reactive Galaxy (vũ trụ hạt sao xoay 3D phát quang theo nhịp bass)
 */
export function Visualizer({
  playing,
  bars = 48,
  className = "",
  height = 64,
  mode: propMode,
  showModeControls = false,
  onModeChange,
}: VisualizerProps) {
  const [currentMode, setCurrentMode] = useState<VisualizerMode>(() => propMode ?? getSavedVisualizerMode());
  const activeMode = propMode ?? currentMode;

  const handleSelectMode = (newMode: VisualizerMode) => {
    setCurrentMode(newMode);
    saveVisualizerMode(newMode);
    onModeChange?.(newMode);
  };

  const ref = useRef<HTMLCanvasElement | null>(null);
  const levels = useRef<number[]>(Array.from({ length: bars }, () => 0.04));
  const { audioRef } = usePlayer();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Theme color subscriber
    let colors = { peak: "", body: "", core: "", base: "", accent: "" };
    const refreshColors = () => {
      const s = accentCssVars(getThemeState());
      const h = getThemeState().hue;
      const sat = getThemeState().sat;
      const dark = getThemeState().mode !== "light";
      const baseL = dark ? 0.76 : 0.52;
      colors = {
        peak: s.primary.replace(")", " / 0.98)"),
        body: `oklch(${(baseL - 0.06).toFixed(3)} ${sat} ${h} / 0.85)`,
        core: `oklch(${Math.min(0.97, baseL + 0.13).toFixed(3)} ${sat} ${h} / 0.9)`,
        base: `oklch(${(baseL - 0.24).toFixed(3)} ${(sat * 0.7).toFixed(3)} ${h} / 0.28)`,
        accent: s.primary,
      };
    };
    refreshColors();
    const unsub = subscribeTheme(refreshColors);

    let raf = 0;
    let t = 0;
    let yaw = 0;
    let pitch = 0.2;
    let isSettled = true;
    const freqData = new Uint8Array(64);
    const timeDomainData = new Uint8Array(128);
    let cachedAnalyserEl: HTMLAudioElement | null = null;
    let cachedAnalyser: AnalyserNode | null = null;

    // Particles mode state
    const particleCount = 56;
    const particles = Array.from({ length: particleCount }, (_, idx) => {
      const angle = (idx / particleCount) * Math.PI * 2;
      const radius = 25 + Math.random() * 55;
      const speed = 0.012 + Math.random() * 0.018;
      const z = (Math.random() - 0.5) * 80;
      return { angle, radius, speed, z, baseRadius: radius };
    });

    let isIntersecting = true;
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                isIntersecting = entry.isIntersecting;
                if (isIntersecting && !document.hidden && (playing || !isSettled)) {
                  cancelAnimationFrame(raf);
                  raf = requestAnimationFrame(draw);
                }
              }
            },
            { threshold: 0.01 },
          )
        : null;
    observer?.observe(canvas);

    const draw = () => {
      // Pause loop when document is hidden to save CPU/GPU; handleVisibilityChange cleanly resumes
      if (document.hidden) {
        return;
      }
      if (!isIntersecting) {
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
        ctx.fillStyle = colors.body;
        ctx.fillRect(0, h / 2 - 1.5, w, 3);
        return;
      }

      t += 0.035;
      isSettled = true;

      // Audio data extraction
      const el = audioRef?.current ?? null;
      if (el !== cachedAnalyserEl) {
        cachedAnalyserEl = el;
        cachedAnalyser = el ? getAudioAnalyser(el) : null;
      }
      const analyser = cachedAnalyser;
      let hasRealAudioData = false;
      let bassEnergy = 0;
      let midEnergy = 0;

      if (analyser && playing) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeDomainData);
        hasRealAudioData = freqData.some((v) => v > 0);
        if (hasRealAudioData) {
          const bassSum = (freqData[0] || 0) + (freqData[1] || 0) + (freqData[2] || 0) + (freqData[3] || 0);
          bassEnergy = bassSum / (4 * 255);
          const midSum = (freqData[8] || 0) + (freqData[9] || 0) + (freqData[10] || 0) + (freqData[11] || 0);
          midEnergy = midSum / (4 * 255);
        }
      }

      if (!hasRealAudioData && playing) {
        bassEnergy = (Math.sin(t * 3.5) * 0.5 + 0.5) * 0.45;
        midEnergy = (Math.sin(t * 5.2 + 1) * 0.5 + 0.5) * 0.35;
      }

      const drawRoundRect = (
        c: CanvasRenderingContext2D,
        rx: number,
        ry: number,
        rw: number,
        rh: number,
        radius: number,
      ) => {
        if (typeof c.roundRect === "function") {
          c.roundRect(rx, ry, rw, rh, radius);
        } else {
          c.rect(rx, ry, rw, rh);
        }
      };

      // ==========================================
      // MODE 1: BARS (VU Analog Spectrum)
      // ==========================================
      if (activeMode === "bars") {
        const gap = 2;
        const bw = Math.max(2, w / bars - gap);
        const center = (bars - 1) / 2 || 1;

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, colors.peak);
        grad.addColorStop(1, colors.base);

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
            } else {
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

          if (Math.abs(v - target) > 0.005) isSettled = false;

          const bh = Math.max(2, v * h);
          const x = i * (bw + gap);
          const y = h - bh;

          ctx.fillStyle = grad;
          ctx.beginPath();
          drawRoundRect(ctx, x, y, bw, bh, bw / 2);
          ctx.fill();

          if (bh > 6) {
            const coreW = bw * 0.56;
            const coreH = bh * 0.72;
            const cx = x + (bw - coreW) / 2;
            ctx.fillStyle = colors.core;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            drawRoundRect(ctx, cx, y + (bh - coreH) * 0.45, coreW, coreH, coreW / 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          if (v > 0.16) {
            const capH = Math.min(4, bh * 0.28);
            ctx.fillStyle = colors.peak;
            ctx.beginPath();
            drawRoundRect(ctx, x, y, bw, capH, bw / 2);
            ctx.fill();
          }
        }
      }

      // ==========================================
      // MODE 2: WAVE (Oscilloscope Glowing Ribbon)
      // ==========================================
      else if (activeMode === "wave") {
        const centerY = h / 2;
        const wavePoints = 64;
        const sliceWidth = w / (wavePoints - 1);

        // Mirrored smooth flowing ribbon
        ctx.beginPath();
        ctx.moveTo(0, centerY);

        const currentAmplitudes: number[] = [];
        for (let i = 0; i < wavePoints; i++) {
          let amp = 0;
          if (playing) {
            if (hasRealAudioData) {
              const td = (timeDomainData[Math.floor((i / wavePoints) * timeDomainData.length)] || 128) - 128;
              amp = (td / 128) * (h * 0.42);
            } else {
              amp = Math.sin(t * 3.2 + i * 0.2) * (h * 0.22) + Math.sin(t * 5.5 + i * 0.4) * (h * 0.12);
            }
          }
          currentAmplitudes.push(amp);
          const x = i * sliceWidth;
          const y = centerY + amp;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevX = (i - 1) * sliceWidth;
            const prevY = centerY + currentAmplitudes[i - 1]!;
            const midX = (prevX + x) / 2;
            const midY = (prevY + y) / 2;
            ctx.quadraticCurveTo(prevX, prevY, midX, midY);
          }
        }
        ctx.lineTo(w, centerY);

        // Gradient under ribbon
        const waveGrad = ctx.createLinearGradient(0, 0, 0, h);
        waveGrad.addColorStop(0, colors.peak);
        waveGrad.addColorStop(0.5, colors.core);
        waveGrad.addColorStop(1, colors.base);

        ctx.strokeStyle = colors.peak;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = colors.peak;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Mirrored bottom wave
        ctx.beginPath();
        for (let i = 0; i < wavePoints; i++) {
          const x = i * sliceWidth;
          const y = centerY - currentAmplitudes[i]! * 0.65;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevX = (i - 1) * sliceWidth;
            const prevY = centerY - currentAmplitudes[i - 1]! * 0.65;
            const midX = (prevX + x) / 2;
            const midY = (prevY + y) / 2;
            ctx.quadraticCurveTo(prevX, prevY, midX, midY);
          }
        }
        ctx.strokeStyle = colors.body;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        if (playing) isSettled = false;
      }

      // ==========================================
      // MODE 3: KINETIC 3D (3D Sphere & Audio Ring Tunnel)
      // ==========================================
      else if (activeMode === "kinetic-3d") {
        yaw += playing ? 0.016 + bassEnergy * 0.025 : 0.005;
        pitch = 0.25 + Math.sin(t * 0.8) * 0.1;

        const cx = w / 2;
        const cy = h / 2;
        const fov = 160;
        const camDist = 200;

        const baseRadius = Math.min(w, h) * 0.36;
        const dynamicRadius = playing ? baseRadius * (1 + bassEnergy * 0.35) : baseRadius;

        // 3D Rings
        const ringCount = 6;
        ctx.lineWidth = 1.5;

        for (let r = 0; r < ringCount; r++) {
          const phi = (r / ringCount) * Math.PI;
          const ringY = Math.cos(phi) * dynamicRadius;
          const ringR = Math.sin(phi) * dynamicRadius;

          const segments = 24;
          ctx.beginPath();

          for (let s = 0; s <= segments; s++) {
            const theta = (s / segments) * Math.PI * 2;
            // 3D Point
            let x3 = Math.cos(theta) * ringR;
            const y3 = ringY;
            let z3 = Math.sin(theta) * ringR;

            // Audio vertex ripple
            if (playing && hasRealAudioData) {
              const bin = (r * 4 + s) % freqData.length;
              const ripple = ((freqData[bin] || 0) / 255) * 12;
              x3 *= 1 + ripple / ringR;
              z3 *= 1 + ripple / ringR;
            }

            // Rotate around Y
            const xRot = x3 * Math.cos(yaw) - z3 * Math.sin(yaw);
            const zRot = x3 * Math.sin(yaw) + z3 * Math.cos(yaw);

            // Rotate around X
            const yRot = y3 * Math.cos(pitch) - zRot * Math.sin(pitch);
            const zRot2 = y3 * Math.sin(pitch) + zRot * Math.cos(pitch);

            // Perspective
            const scale = fov / (fov + zRot2 + camDist);
            const x2d = cx + xRot * scale;
            const y2d = cy + yRot * scale;

            if (s === 0) ctx.moveTo(x2d, y2d);
            else ctx.lineTo(x2d, y2d);
          }

          ctx.strokeStyle = r % 2 === 0 ? colors.peak : colors.body;
          ctx.globalAlpha = Math.max(0.3, Math.min(0.95, 0.5 + (r / ringCount) * 0.5));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Center Pulsing Core
        const coreR = Math.max(4, dynamicRadius * 0.22 * (1 + bassEnergy * 0.5));
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = colors.core;
        ctx.shadowColor = colors.peak;
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (playing) isSettled = false;
      }

      // ==========================================
      // MODE 4: PARTICLES (Audio Reactive Galaxy)
      // ==========================================
      else if (activeMode === "particles") {
        const cx = w / 2;
        const cy = h / 2;
        const fov = 140;
        const camDist = 180;

        for (const p of particles) {
          p.angle += p.speed * (playing ? 1 + bassEnergy * 2.2 : 1);
          p.radius = p.baseRadius * (playing ? 1 + bassEnergy * 0.45 : 1);

          const x3 = Math.cos(p.angle) * p.radius;
          const y3 = Math.sin(p.angle) * (p.radius * 0.45);
          const z3 = p.z;

          // Yaw rotation
          const xRot = x3 * Math.cos(t * 0.4) - z3 * Math.sin(t * 0.4);
          const zRot = x3 * Math.sin(t * 0.4) + z3 * Math.cos(t * 0.4);

          const scale = fov / (fov + zRot + camDist);
          const x2d = cx + xRot * scale;
          const y2d = cy + y3 * scale;

          const size = Math.max(1.2, scale * 3.5 * (1 + midEnergy));

          ctx.beginPath();
          ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
          ctx.fillStyle = p.z > 0 ? colors.peak : colors.body;
          ctx.globalAlpha = Math.min(1, Math.max(0.25, scale * 1.2));
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        if (playing) isSettled = false;
      }

      if (playing || !isSettled) {
        raf = requestAnimationFrame(draw);
      }
    };

    const handleVisibilityChange = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && isIntersecting && (playing || !isSettled)) {
        raf = requestAnimationFrame(draw);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden && isIntersecting) {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      observer?.disconnect();
      unsub();
    };
  }, [bars, playing, audioRef, activeMode]);

  return (
    <div className={cn("relative flex flex-col items-center justify-center select-none", className)}>
      <div className="w-full overflow-hidden shrink-0 pointer-events-none">
        <canvas ref={ref} style={{ height, width: "100%", display: "block" }} />
      </div>

      {showModeControls && (
        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/[0.04] p-1 border border-white/5 backdrop-blur-md">
          <button
            type="button"
            title="Cột sóng VU Analog"
            onClick={() => handleSelectMode("bars")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
              activeMode === "bars"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
          >
            <BarChart3 className="size-3" />
            <span className="hidden sm:inline">Cột sóng</span>
          </button>

          <button
            type="button"
            title="Dải sóng Ribbon"
            onClick={() => handleSelectMode("wave")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
              activeMode === "wave"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
          >
            <Activity className="size-3" />
            <span className="hidden sm:inline">Dải sóng</span>
          </button>

          <button
            type="button"
            title="Khối cầu 3D Kinetic"
            onClick={() => handleSelectMode("kinetic-3d")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
              activeMode === "kinetic-3d"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
          >
            <Orbit className="size-3" />
            <span className="hidden sm:inline">3D Kinetic</span>
          </button>

          <button
            type="button"
            title="Vũ trụ hạt Galaxy"
            onClick={() => handleSelectMode("particles")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
              activeMode === "particles"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
          >
            <Sparkles className="size-3" />
            <span className="hidden sm:inline">Vũ trụ hạt</span>
          </button>
        </div>
      )}
    </div>
  );
}
