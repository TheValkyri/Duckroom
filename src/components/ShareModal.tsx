import { Check, Copy, Disc, Disc3, Film, Link2, ListMusic, Loader2, Share2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useScrollLock } from "../hooks/use-scroll-lock";
import { modalOverlayVariants, modalPanelVariants, springSnappy, tapScale } from "../lib/motion";
import { expiresAtFromChoice, type ShareExpiryChoice } from "../lib/share-client";
import { createShareLinkServer } from "../lib/sharing";
import { cn } from "../lib/utils";

const EXPIRY_OPTIONS: Array<{ id: ShareExpiryChoice; label: string; desc: string }> = [
  { id: "forever", label: "1 năm", desc: "Hiệu lực tối đa 365 ngày" },
  { id: "30d", label: "30 ngày", desc: "Thích hợp chia sẻ bạn bè" },
  { id: "7d", label: "7 ngày", desc: "Hết hạn sau 1 tuần" },
  { id: "24h", label: "24 giờ", desc: "Liên kết tạm thời trong ngày" },
];

export interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  resourceType: "track" | "album" | "video" | "playlist";
  resourceId: string;
  title: string;
  artistOrSubtitle?: string | null | undefined;
  cover?: string | null | undefined;
}

export function ShareModal({
  open,
  onClose,
  resourceType,
  resourceId,
  title,
  artistOrSubtitle,
  cover,
}: ShareModalProps) {
  useScrollLock(open);

  const [expiryChoice, setExpiryChoice] = useState<ShareExpiryChoice>("forever");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Generate capability link when modal opens or expiry changes
  useEffect(() => {
    if (!open) {
      setShareUrl(null);
      setCopied(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const mint = async () => {
      try {
        const expiresAt = expiresAtFromChoice(expiryChoice);
        const { path } = await createShareLinkServer({
          data: {
            resourceType,
            resourceId,
            expiresAt,
          },
        });
        if (!cancelled) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          setShareUrl(`${origin}${path}`);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Mint share link failed:", err);
          setError(err instanceof Error ? err.message : "Không tạo được liên kết chia sẻ.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void mint();

    return () => {
      cancelled = true;
    };
  }, [open, resourceType, resourceId, expiryChoice]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Đã sao chép liên kết chia sẻ!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Không thể sao chép liên kết vào bộ nhớ tạm.");
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.share({
        title: `${title} — Duckroom`,
        text: artistOrSubtitle ? `${title} · ${artistOrSubtitle}` : title,
        url: shareUrl,
      });
    } catch {
      // User dismissed share dialog
    }
  };

  const TypeIcon = {
    track: Disc,
    album: Disc3,
    video: Film,
    playlist: ListMusic,
  }[resourceType];

  const typeLabel = {
    track: "Bài hát",
    album: "Album",
    video: "MV Video",
    playlist: "Danh sách phát",
  }[resourceType];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={modalOverlayVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            variants={modalPanelVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-modal-title"
            className="w-full max-w-md bg-card/95 border border-border/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md flex flex-col"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-primary" />
                <h3 id="share-modal-title" className="font-display font-semibold text-base text-foreground">
                  Chia sẻ {typeLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5">
              {/* Resource Preview Card */}
              <div className="flex items-center gap-3.5 p-3 rounded-xl bg-accent/40 border border-white/5">
                <div className="relative size-12 rounded-lg overflow-hidden bg-muted/60 shrink-0 border border-white/10 flex items-center justify-center">
                  {cover ? (
                    <img src={cover} alt={title} className="size-full object-cover" />
                  ) : (
                    <TypeIcon className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-primary px-1.5 py-0.5 rounded bg-primary/10 mb-0.5">
                    {typeLabel}
                  </span>
                  <h4 className="font-display font-semibold text-sm truncate text-foreground">{title}</h4>
                  {artistOrSubtitle && <p className="text-xs text-muted-foreground truncate">{artistOrSubtitle}</p>}
                </div>
              </div>

              {/* Expiry Selection */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Thời hạn liên kết
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {EXPIRY_OPTIONS.map((opt) => {
                    const active = expiryChoice === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setExpiryChoice(opt.id)}
                        className={cn(
                          "p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                          active
                            ? "border-primary bg-primary/10 text-foreground shadow-sm"
                            : "border-border bg-card/60 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                        )}
                      >
                        <span className="block text-xs font-semibold">{opt.label}</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Share URL Box */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Liên kết truy cập
                </label>
                {loading ? (
                  <div className="flex items-center justify-center gap-2.5 h-11 px-3 bg-muted/30 border border-border rounded-xl text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>Đang tạo mã liên kết an toàn...</span>
                  </div>
                ) : error ? (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-xs text-destructive">
                    {error}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl || ""}
                      className="flex-1 bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs font-mono text-foreground focus:outline-none select-all truncate"
                    />
                    <motion.button
                      type="button"
                      whileTap={tapScale}
                      transition={springSnappy}
                      onClick={handleCopy}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0 shadow-sm",
                        copied ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {copied ? (
                        <>
                          <Check className="size-3.5" />
                          <span>Đã sao chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </motion.button>
                  </div>
                )}
              </div>

              {/* Native Share button (Mobile / Supported browser) */}
              {canNativeShare && shareUrl && !loading && !error && (
                <motion.button
                  type="button"
                  whileTap={tapScale}
                  transition={springSnappy}
                  onClick={handleNativeShare}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-border bg-card hover:bg-accent text-foreground text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Share2 className="size-3.5 text-primary" />
                  <span>Chia sẻ qua ứng dụng khác...</span>
                </motion.button>
              )}

              <p className="text-[11px] text-muted-foreground/80 leading-relaxed text-center">
                Liên kết bảo mật độc lập với tài khoản. Người nhận có thể nghe hoặc xem ngay không cần đăng nhập.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
