import { useEffect, useRef, useState } from "react";

/**
 * SLEEP TIMER (QoL A2, 2026-09-01) — hẹn giờ tắt nhạc.
 *
 * Thiết kế:
 * - Countdown chạy bằng timestamp ABSOLUTE (không interval-đếm) nên ngủ
 *   tab/lag CPU không làm lệch giờ: còn lại = endsAt - Date.now().
 * - 30s CUỐI: fade-out êm — volume ramp tuyến tính về 0 rồi MỚI pause.
 *   Người dùng không bao giờ bị "cắt" đột ngột giữa đoạn nhạc dịu.
 * - Tạm dừng nhạc (bằng tay) giữa chừng → timer vẫn chạy (đúng đồng
 *   hồ ngủ), nhưng nếu nhạc KHÔNG phát lúc hết giờ thì chỉ tắt timer.
 * - Số mốc preset: 15/30/45/60/90 phút + tắt.
 *
 * Hook trả về: số phút còn lại (làm tròn, cho UI), hàm bật mốc, đang-bật.
 * Việc pause & restore-volume do CONSUMER thực hiện qua callback — hook
 * không đụng player engine (tách testable).
 */
export type SleepTimerState = {
  /** Số phút còn lại (float, người gọi tự format); 0 = không bật. */
  remainingMinutes: number;
  /** Đã bật hay chưa. */
  active: boolean;
  /** Timestamp kết thúc (ms) — cho hiển thị giờ cụ thể nếu cần. */
  endsAt: number | null;
};

const FADE_SECONDS = 30;
const TICK_MS = 1000;

export function useSleepTimer(onFinish: () => void, onFadeTick?: (vol01: number) => void) {
  const [remainingMs, setRemainingMs] = useState(0);
  const endsAtRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const cbRef = useRef({ onFinish, onFadeTick });
  cbRef.current = { onFinish, onFadeTick };

  useEffect(() => {
    if (endsAtRef.current === null) return;
    const tick = () => {
      const endsAt = endsAtRef.current;
      if (endsAt === null) return;
      const left = endsAt - Date.now();
      if (left <= 0) {
        if (!finishingRef.current) {
          finishingRef.current = true;
          cbRef.current.onFinish();
        }
        endsAtRef.current = null;
        setRemainingMs(0);
        return;
      }
      setRemainingMs(left);
      // Trong cửa sổ fade: báo volume tỉ lệ (1 → 0) mỗi giây.
      if (left < FADE_SECONDS * 1000 && cbRef.current.onFadeTick) {
        cbRef.current.onFadeTick(left / (FADE_SECONDS * 1000));
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const setMinutes = (minutes: number | null) => {
    finishingRef.current = false;
    if (!minutes || minutes <= 0) {
      endsAtRef.current = null;
      setRemainingMs(0);
      // Hủy giữa chừng: trả volume về 1 (consumer đã giữ volume gốc).
      cbRef.current.onFadeTick?.(1);
      return;
    }
    endsAtRef.current = Date.now() + minutes * 60_000;
    setRemainingMs(minutes * 60_000);
  };

  const state: SleepTimerState = {
    remainingMinutes: remainingMs / 60_000,
    active: endsAtRef.current !== null && remainingMs > 0,
    endsAt: endsAtRef.current,
  };
  return { state, setMinutes };
}
