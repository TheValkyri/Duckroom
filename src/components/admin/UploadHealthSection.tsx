import { AlertTriangle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { getUploadHealthServer, type UploadHealthSummary } from "../../lib/owner-data";
import { SectionCard } from "./SectionCard";

export function UploadHealthSection() {
  const [health, setHealth] = useState<UploadHealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUploadHealthServer()
      .then((res) => {
        // Transport có thể resolve với error-body thay vì reject (401) —
        // chỉ nhận payload đúng shape, mọi thứ khác coi như lỗi.
        setHealth(res && typeof res === "object" && "byStatus" in (res as object) ? res : null);
        if (!(res && typeof res === "object" && "byStatus" in (res as object))) {
          setError("Không có quyền truy cập hoặc dữ liệu không hợp lệ (cần đăng nhập Owner).");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải sức khoẻ upload."));
  }, []);

  return (
    <SectionCard title="Hàng đợi Upload" description="Phiên ingest chưa kết thúc hoặc thất bại gần đây." icon={Zap}>
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {health && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(health.byStatus ?? {}).map(([status, count]) => (
              <span
                key={status}
                className="text-muted-foreground rounded-full border border-border bg-muted/20 px-3 py-1 text-[11px] font-medium"
              >
                {status}: <strong className="text-foreground tabular-nums">{count}</strong>
              </span>
            ))}
            {Object.keys(health.byStatus ?? {}).length === 0 && (
              <span className="text-muted-foreground text-xs">Chưa có phiên upload nào.</span>
            )}
          </div>
          {(health.stuckSessions ?? []).length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {health.stuckSessions.map((s) => (
                <li
                  key={s.id}
                  className="border-border bg-card/60 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                >
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                  <span className="min-w-0 flex-1 truncate">{s.expectedFilename}</span>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {s.status}/{s.stage}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
