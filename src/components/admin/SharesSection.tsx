import { Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getOwnerSharesServer, revokeShareByIdServer, type OwnerShareRow } from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

function shareStatusStyle(status: OwnerShareRow["status"]): string {
  switch (status) {
    case "active":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "revoked":
      return "text-destructive border-destructive/30 bg-destructive/10";
    default:
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  }
}

export function SharesSection() {
  const [shares, setShares] = useState<OwnerShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    try {
      const res = await getOwnerSharesServer();
      setShares(res.shares ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách share links.");
    }
  }, []);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const handleRevoke = async (row: OwnerShareRow) => {
    if (!confirm("Thu hồi liên kết chia sẻ này? Người giữ link cũ sẽ không còn truy cập được.")) return;
    setBusyId(row.id);
    try {
      await revokeShareByIdServer({ data: { shareId: row.id } });
      setShares((prev) => (prev ?? []).map((s) => (s.id === row.id ? { ...s, status: "revoked" as const } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thu hồi thất bại.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard
      title="Share Links"
      description="Token chỉ lưu dạng hash — console hiển thị trạng thái, không hiển thị URL gốc."
      icon={Link2}
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {!shares && !error && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang tải…
        </p>
      )}
      {shares && shares.length === 0 && (
        <p className="text-muted-foreground mt-4 text-xs">Chưa có liên kết chia sẻ nào được tạo.</p>
      )}
      {shares && shares.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {shares.map((s) => (
            <div
              key={s.id}
              className="border-border bg-card/60 flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                  shareStatusStyle(s.status),
                )}
              >
                {s.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium capitalize">
                  {s.resource_type}{" "}
                  <span className="text-muted-foreground/60 font-mono">{s.resource_id.slice(0, 8)}…</span>
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Tạo {new Date(s.created_at).toLocaleString("vi-VN")}
                  {s.expires_at ? ` · hết hạn ${new Date(s.expires_at).toLocaleString("vi-VN")}` : ""}
                </p>
              </div>
              {s.status === "active" && (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void handleRevoke(s)}
                  className="hover:bg-destructive/10 text-destructive shrink-0 rounded-full border border-destructive/30 px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-40"
                >
                  {busyId === s.id ? "…" : "Thu hồi"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
