import { Check, Moon, Palette, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { ACCENT_PRESETS, HUE_MAX, SAT_MAX, SAT_MIN, setModeWithReveal, setTheme, useTheme } from "../lib/theme";
import { springSnappy, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";
import { useScrollLock } from "../hooks/use-scroll-lock";

/**
 * ThemePicker — bảng tùy chỉnh giao diện (2026-09-01).
 * Mode (dark/light) + 8 preset accent + slider Hue & "Đậm" (saturation).
 * - Preset: chạm là đổi màu accent TOÀN app ngay (repaint biến, 0 layout).
 * - Slider: kéo liên tục — accent hiện đại ứng biến qua oklch; cả hai
 *   chân đều có mốc (mono → gold → neon-ish) cho cảm giác có quy luật.
 * - Mode: bấm Icon chuyển qua setModeWithReveal — hiệu ứng TRÒN LAN TỎA
 *   từ đúng vị trí ngón tay (View Transitions; fallback transition mềm).
 * Pure client (localStorage qua store) — Guest/Member đều dùng được;
 * Member sau này có thể sync server (user_preferences.theme — cột đã có).
 */
export function ThemePicker({
  open,
  onClose,
  triggerOrigin,
}: {
  open: boolean;
  onClose: () => void;
  /** Điểm bấm để làm tâm hiệu ứng reveal khi đổi mode. */
  triggerOrigin: { x: number; y: number } | null;
}) {
  useScrollLock(open);
  const theme = useTheme();
  const hueSliderRef = useRef<HTMLInputElement | null>(null);
  const satSliderRef = useRef<HTMLInputElement | null>(null);

  const swatches = useMemo(
    () =>
      ACCENT_PRESETS.map((p) => ({
        ...p,
        css: `oklch(${theme.mode === "dark" ? 0.76 : 0.52} ${p.sat} ${p.hue})`,
        active: theme.preset === p.id && theme.hue === p.hue && theme.sat === p.sat,
      })),
    [theme],
  );

  if (!open) return null;

  const pickPreset = (id: string, hue: number, sat: number) => {
    setTheme({ preset: id, hue, sat });
  };

  const onHueInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTheme({ hue: Number(e.target.value), preset: "custom" });
  };
  const onSatInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTheme({ sat: Number(e.target.value), preset: "custom" });
  };

  const previewCss = `oklch(${theme.mode === "dark" ? 0.76 : 0.52} ${theme.sat} ${theme.hue})`;

  const panel = (
    <div className="space-y-5 overflow-y-auto px-5 pb-6">
      {/* Mode */}
      <section>
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">Chế độ</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void setModeWithReveal("dark", triggerOrigin)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-medium transition-colors cursor-pointer",
              theme.mode === "dark"
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
            aria-pressed={theme.mode === "dark"}
          >
            <Moon className="size-4" /> Tối
          </button>
          <button
            type="button"
            onClick={() => void setModeWithReveal("light", triggerOrigin)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-medium transition-colors cursor-pointer",
              theme.mode === "light"
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
            aria-pressed={theme.mode === "light"}
          >
            <Sun className="size-4" /> Sáng
          </button>
        </div>
      </section>

      {/* Preset swatches */}
      <section>
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">Màu nhấn</p>
        <div className="grid grid-cols-4 gap-2.5">
          {swatches.map((s) => (
            <motion.button
              key={s.id}
              type="button"
              whileTap={tapScale}
              transition={springSnappy}
              onClick={() => pickPreset(s.id, s.hue, s.sat)}
              className={cn(
                "group flex flex-col items-center gap-1.5 rounded-2xl p-2 transition-colors cursor-pointer",
                s.active ? "bg-accent/60" : "hover:bg-accent/40",
              )}
              aria-label={`Màu ${s.label}`}
              aria-pressed={s.active}
            >
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-full border-2 shadow-inner",
                  s.active ? "border-foreground/60 scale-105" : "border-transparent",
                )}
                style={{ background: s.css }}
              >
                {s.active && <Check className="text-primary-foreground size-4" strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  "text-[10px] leading-tight",
                  s.active ? "text-foreground font-semibold" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* Custom sliders */}
      <section className="space-y-3">
        <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">Tự chỉnh</p>

        <div className="flex items-center gap-3">
          <span
            className="size-10 shrink-0 rounded-full border border-white/10 shadow-inner"
            style={{ background: previewCss }}
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-2.5">
            {/* Hue slider — track là CHÍNH vòng màu oklch (độc đáo,
                          người dùng thấy ngay cả dải màu đang kéo). */}
            <label className="block">
              <span className="text-muted-foreground mb-1 flex items-center justify-between text-[11px]">
                <span>Màu sắc</span>
                <span className="text-primary tabular-nums">{theme.hue}°</span>
              </span>
              <input
                ref={hueSliderRef}
                type="range"
                min={0}
                max={HUE_MAX}
                step={1}
                value={theme.hue}
                onChange={onHueInput}
                aria-label="Đổi màu nhấn"
                className="hue-range h-6 w-full cursor-pointer appearance-none bg-transparent"
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground mb-1 flex items-center justify-between text-[11px]">
                <span>Độ đậm</span>
                <span className="text-primary tabular-nums">{Math.round((theme.sat / SAT_MAX) * 100)}%</span>
              </span>
              <input
                ref={satSliderRef}
                type="range"
                min={SAT_MIN}
                max={SAT_MAX}
                step={0.005}
                value={theme.sat}
                onChange={onSatInput}
                aria-label="Đổi độ đậm màu"
                className="sat-range h-6 w-full cursor-pointer appearance-none bg-transparent"
              />
            </label>
          </div>
        </div>
        <p className="text-muted-foreground/70 text-[10px] leading-snug">
          Màu áp dụng ngay cho toàn ứng dụng và được ghi nhớ trên thiết bị này.
        </p>
      </section>
    </div>
  );

  return (
    <>
      {/* PHONE: bottom sheet */}
      <div className="lg:hidden">
        <div className="fixed inset-0 z-[65] bg-black/50" onClick={onClose} aria-hidden />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Tùy chỉnh giao diện"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          drag="y"
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          className="fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-w-lg flex-col rounded-t-[28px] border-t border-white/10 bg-card/95 backdrop-blur-md pb-safe"
        >
          <div className="flex cursor-grab justify-center pt-2.5 pb-1.5 active:cursor-grabbing touch-none" aria-hidden>
            <div className="h-1.5 w-10 rounded-full bg-white/25" />
          </div>
          <div className="flex items-center justify-between px-5 pt-1.5 pb-3">
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <Palette className="text-primary size-5" /> Giao diện
            </h2>
            <button
              onClick={onClose}
              aria-label="Đóng bảng tùy chỉnh giao diện"
              className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-9 place-items-center rounded-full transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
          {panel}
        </motion.div>
      </div>

      {/* DESKTOP (>=lg): centered dialog chuẩn desktop */}
      <div className="hidden lg:block">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tùy chỉnh giao diện"
          className="fixed inset-0 z-[70] grid place-items-center p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="bg-card border-border flex max-h-[min(38rem,90vh)] w-full max-w-md flex-col overflow-hidden rounded-3xl border shadow-2xl"
          >
            <div className="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
                <Palette className="text-primary size-5" /> Giao diện
              </h2>
              <button
                onClick={onClose}
                aria-label="Đóng bảng tùy chỉnh giao diện"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/60 grid size-9 place-items-center rounded-full transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
