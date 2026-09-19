import { useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { ProfileAvatar } from "./ProfileAvatar";
import { unblockUser, type BlockedUserItem } from "../../lib/social";
import { cn } from "../../lib/utils";

export interface BlockedUserRowProps {
  user: BlockedUserItem;
  onActionSuccess?: () => void;
  className?: string;
}

export function BlockedUserRow({ user, onActionSuccess, className }: BlockedUserRowProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUnblock = async () => {
    setIsProcessing(true);
    try {
      await unblockUser({ data: { targetUserId: user.userId } });
      toast.success(`Đã bỏ chặn ${user.displayName}.`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể bỏ chặn");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-card/60 p-3.5 shadow-sm transition hover:bg-card/80",
        className,
      )}
    >
      <div className="flex items-center gap-3.5 overflow-hidden">
        <ProfileAvatar src={user.avatarUrl} name={user.displayName} handle={user.handle} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{user.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">@{user.handle}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          disabled={isProcessing}
          onClick={handleUnblock}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-white/10 hover:text-foreground active:scale-95 disabled:opacity-50"
        >
          {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
          Bỏ chặn
        </button>
      </div>
    </div>
  );
}
