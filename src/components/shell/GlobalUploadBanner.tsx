import { Link, useLocation } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { getIngestionStoreState, subscribeIngestionStore, type IngestionStoreState } from "../../lib/upload-store";

export function GlobalUploadBanner() {
  const [ingestionState, setIngestionState] = useState<IngestionStoreState>(getIngestionStoreState);
  const location = useLocation();

  useEffect(() => {
    return subscribeIngestionStore(setIngestionState);
  }, []);

  const activeIngestion = ingestionState.items.find(
    (i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing",
  );

  if (!activeIngestion || location.pathname === "/upload") return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-card/95 border border-primary/40 text-foreground px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-sm mt-[var(--safe-top)]"
      >
        <Loader2 className="size-5 animate-spin text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs font-semibold mb-1">
            <span className="truncate">{activeIngestion.metadata.title || activeIngestion.file.name}</span>
            <span className="text-primary tabular-nums">{activeIngestion.progressPercent}%</span>
          </div>
          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300 rounded-full"
              style={{ width: `${activeIngestion.progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{activeIngestion.progressText}</p>
        </div>
        <Link
          to="/upload"
          className="text-xs bg-primary/20 text-primary hover:bg-primary/30 px-2.5 py-1 rounded-full font-medium transition-colors shrink-0"
        >
          Xem
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}

export function UploadNavDot() {
  const [hasActive, setHasActive] = useState(() => {
    const s = getIngestionStoreState();
    return s.items.some((i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing");
  });

  useEffect(() => {
    return subscribeIngestionStore((s) => {
      const active = s.items.some(
        (i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing",
      );
      setHasActive(active);
    });
  }, []);

  if (!hasActive) return null;
  return <span className="ml-auto size-2 rounded-full bg-primary animate-pulse shrink-0 z-10" />;
}
