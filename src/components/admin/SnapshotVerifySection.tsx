import { AlertTriangle, CheckCircle2, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { springSnappy, tapScale } from "../../lib/motion";
import {
  verifyBackupSnapshotServer,
  reconcileStorageWithDbServer,
  type SnapshotVerifyResult,
  type ReconcileStorageResult,
} from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

export function SnapshotVerifySection() {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<SnapshotVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileStorageResult | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);

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

  const handleReconcile = async (autoPurge = false) => {
    if (autoPurge) setIsPurging(true);
    else setReconciling(true);
    setReconcileError(null);
    try {
      const res = await reconcileStorageWithDbServer({ data: { autoPurgeGhosts: autoPurge } });
      setReconcileResult(res as unknown as ReconcileStorageResult);
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "Đối chiếu S3 thất bại.");
    } finally {
      setReconciling(false);
      setIsPurging(false);
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
      title="Snapshot sao lưu & Đồng bộ S3"
      description="Đối chiếu library_manifest.json và kiểm tra tính toàn vẹn vật lý giữa database Supabase với S3 Storage. Tự động phát hiện và xử lý ghost tracks (bài hát mất file audio)."
      icon={Save}
      action={
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={tapScale}
            transition={springSnappy}
            disabled={reconciling || isPurging}
            onClick={() => void handleReconcile(false)}
            className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-400 hover:bg-sky-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={cn("size-3", reconciling && "animate-spin")} />
            {reconciling ? "Đang quét S3…" : "Đối chiếu S3"}
          </motion.button>
          <motion.button
            whileTap={tapScale}
            transition={springSnappy}
            disabled={verifying}
            onClick={() => void handleVerify()}
            className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
          >
            {verifying ? "Đang đối chiếu…" : "Xác minh snapshot"}
          </motion.button>
        </div>
      }
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {reconcileError && <p className="text-destructive mt-4 text-xs">{reconcileError}</p>}

      {/* S3 Reconciliation Result */}
      {reconcileResult && (
        <div className="mt-4 p-3 rounded-2xl bg-card/60 border border-border space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              {reconcileResult.ghostTracks.length === 0 ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  <span className="text-emerald-400">Bộ nhớ S3 hoàn toàn đồng bộ với Database</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-4 text-amber-400" />
                  <span className="text-amber-400">
                    Phát hiện {reconcileResult.ghostTracks.length} bài hát bị mất file trên S3
                  </span>
                </>
              )}
            </div>
            {reconcileResult.ghostTracks.length > 0 && (
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                disabled={isPurging}
                onClick={() => void handleReconcile(true)}
                className="rounded-full bg-destructive/10 border border-destructive/30 text-destructive px-3 py-1 font-semibold hover:bg-destructive/20 cursor-pointer disabled:opacity-50"
              >
                {isPurging ? "Đang dọn dẹp…" : "Dọn dẹp Ghost Tracks"}
              </motion.button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="border-border bg-background/50 rounded-xl border p-2.5">
              <p className="text-muted-foreground text-[10px] uppercase">Tổng bài DB</p>
              <p className="mt-1 font-semibold tabular-nums">{reconcileResult.totalDbTracks}</p>
            </div>
            <div className="border-border bg-background/50 rounded-xl border p-2.5">
              <p className="text-muted-foreground text-[10px] uppercase">Hợp lệ trên S3</p>
              <p className="mt-1 font-semibold tabular-nums text-emerald-400">{reconcileResult.validDbTracks}</p>
            </div>
            <div className="border-border bg-background/50 rounded-xl border p-2.5">
              <p className="text-muted-foreground text-[10px] uppercase">Mất file S3</p>
              <p
                className={cn(
                  "mt-1 font-semibold tabular-nums",
                  reconcileResult.ghostTracks.length > 0 ? "text-amber-400 font-bold" : "text-muted-foreground",
                )}
              >
                {reconcileResult.ghostTracks.length}
              </p>
            </div>
            <div className="border-border bg-background/50 rounded-xl border p-2.5">
              <p className="text-muted-foreground text-[10px] uppercase">File S3 không dùng</p>
              <p className="mt-1 font-semibold tabular-nums">{reconcileResult.orphanS3Keys.length}</p>
            </div>
          </div>

          {reconcileResult.purgedGhostCount && reconcileResult.purgedGhostCount > 0 ? (
            <p className="text-emerald-400 text-[11px]">
              ✓ Đã dọn dẹp thành công {reconcileResult.purgedGhostCount} ghost tracks và cập nhật library_manifest.json!
            </p>
          ) : null}
        </div>
      )}

      {/* Snapshot Verification Result */}
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
