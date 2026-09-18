import { Save } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { springSnappy, tapScale } from "../../lib/motion";
import { verifyBackupSnapshotServer, type SnapshotVerifyResult } from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

export function SnapshotVerifySection() {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<SnapshotVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      setResult(await verifyBackupSnapshotServer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xác minh snapshot thất bại.");
    } finally {
      setVerifying(false);
    }
  };

  const driftRow = result
    ? [
        { label: "Tracks", drift: result.drift.tracks },
        { label: "Albums", drift: result.drift.albums },
        { label: "Videos", drift: result.drift.videos },
      ]
    : [];

  return (
    <SectionCard
      title="Snapshot sao lưu"
      description="Đối chiếu library_manifest.json trên S3 với database hiện tại. Chỉ đọc — restore thật sự là quy trình có người duyệt."
      icon={Save}
      action={
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={verifying}
          onClick={() => void handleVerify()}
          className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
        >
          {verifying ? "Đang đối chiếu…" : "Xác minh snapshot"}
        </motion.button>
      }
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2 text-xs">
          <p
            className={cn(
              "rounded-xl border p-3",
              result.parsedOk && result.snapshotFound
                ? "border-border bg-card/60"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400",
            )}
          >
            {result.message}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {driftRow.map(({ label, drift }) => (
              <div key={label} className="border-border bg-background/50 rounded-xl border p-3 text-center">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {drift === 0 ? "✓ đồng bộ" : `${drift > 0 ? "+" : ""}${drift}`}
                </p>
              </div>
            ))}
          </div>
          {result.createdAt && (
            <p className="text-muted-foreground">
              Snapshot tạo lúc: {new Date(result.createdAt).toLocaleString("vi-VN")}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
