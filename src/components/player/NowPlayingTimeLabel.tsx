import { formatTime } from "../../data/library";
import { usePlayerTime } from "../../lib/player";

// Tách nhãn thời gian ra component riêng: chỉ phần này re-render mỗi tick
// (~4-15 lần/giây), toàn bộ đĩa than/ảnh bìa/gradient không cần tính lại.
export function NowPlayingTimeLabel({ duration }: { duration: number }) {
  const time = usePlayerTime();
  return (
    <div className="text-muted-foreground flex justify-between text-xs tabular-nums mt-1">
      <span>{formatTime(time)}</span>
      <span>-{formatTime(duration - time)}</span>
    </div>
  );
}
