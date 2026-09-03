import { MoonStar, Timer } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useSleepTimer } from "../../hooks/use-sleep-timer";
import { springSnappy, tapScale, tweenFast } from "../../lib/motion";
import { cn } from "../../lib/utils";

/**
 * SLEEP TIMER MENU (QoL A2) — góc header fullscreen player.
 * Icon Moon: tắt = outline; đang hẹn = fill + badge phút còn lại.
 * Menu mốc: 15/30/45/60/90 phút + "Tắt hẹn giờ". Chọn xong tự đóng.
 * Fade 30s cuối: consumer (NowPlaying) nhận volume-ramp; hết giờ → pause.
 */
const PRESETS = [15, 30, 45, 60, 90];

export function SleepTimerMenu({ onFinish, onFadeTick }: { onFinish: () => void; onFadeTick: (v01: number) => void }) {
  const { state, setMinutes } = useSleepTimer(onFinish, onFadeTick);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <motion.button
        type="button"
        whileTap={tapScale}
        transition={springSnappy}
        onClick={() => setOpen((v) => !v)}
        aria-label={state.active ? `Hẹn tắt nhạc, còn ${Math.ceil(state.remainingMinutes)} phút` : "Hẹn giờ tắt nhạc"}
        aria-expanded={open}
        title="Hẹn giờ tắt nhạc"
        className={cn(
          "grid size-11 place-items-center rounded-full transition-colors cursor-pointer",
          state.active
            ? "text-primary bg-primary/10"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        <MoonStar className="size-5" fill={state.active ? "currentColor" : "none"} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={tweenFast}
              role="menu"
              aria-label="Chọn thời gian hẹn tắt nhạc"
              className="bg-card border-border absolute right-0 top-12 z-20 w-44 overflow-hidden rounded-2xl border p-1.5 shadow-2xl"
            >
              <p className="text-muted-foreground flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-[10px] font-semibold uppercase tracking-wider">
                <Timer className="size-3" /> Tắt nhạc sau
              </p>
              {PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitemradio"
                  aria-checked={false}
                  onClick={() => {
                    setMinutes(m);
                    setOpen(false);
                  }}
                  className="hover:bg-accent/60 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer"
                >
                  <span>{m} phút</span>
                </button>
              ))}
              {state.active && (
                <>
                  <div className="bg-border my-1 h-px" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMinutes(null);
                      setOpen(false);
                    }}
                    className="text-destructive hover:bg-destructive/10 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer"
                  >
                    Tắt hẹn giờ
                    <span className="text-muted-foreground tabular-nums">còn {Math.ceil(state.remainingMinutes)}p</span>
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Badge số phút còn lại trên icon (đang hẹn) */}
      <AnimatePresence>
        {state.active && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={tweenFast}
            aria-hidden
            className="bg-primary text-primary-foreground absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold tabular-nums"
          >
            {Math.ceil(state.remainingMinutes)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
