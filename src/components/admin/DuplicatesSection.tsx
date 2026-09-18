import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { springSnappy, tapScale } from "../../lib/motion";
import { scanDuplicateMastersServer, type DuplicateMasterGroup } from "../../lib/owner-data";
import { SectionCard } from "./SectionCard";

export function DuplicatesSection() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof scanDuplicateMastersServer>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      setResult(await scanDuplicateMastersServer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quét trùng lặp thất bại.");
    } finally {
      setScanning(false);
    }
  };

  const groups: DuplicateMasterGroup[] = result?.groups ?? [];

  return (
    <SectionCard
      title="Master trùng lặp"
      description={`Nhóm file master có SHA-256 giống hệt nhau.${result ? ` Đã quét ${result.scannedFiles} file.` : ""}`}
      icon={Search}
      action={
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          disabled={scanning}
          onClick={() => void handleScan()}
          className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
        >
          {scanning ? "Đang quét…" : "Quét trùng lặp"}
        </motion.button>
      }
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {result && groups.length === 0 && !error && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <CheckCircle2 className="size-3.5" /> Không phát hiện master trùng SHA-256.
        </p>
      )}
      {groups.map((g) => (
        <div key={`${g.kind}-${g.sha256}`} className="border-border bg-card/60 mt-3 rounded-2xl border p-4">
          <p className="text-muted-foreground font-mono text-[11px] break-all">
            sha256:{g.sha256.slice(0, 32)}… ·{" "}
            {g.fileSizeBytes ? `${(Number(g.fileSizeBytes) / 1024 / 1024).toFixed(1)} MB` : "?"} · {g.kind}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {g.items.map((item) => (
              <li key={item.fileId} className="flex items-center gap-2">
                <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                <span className="truncate">{item.title}</span>
                <span className="text-muted-foreground/70 truncate font-mono text-[10px]">{item.storageKey}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  );
}
