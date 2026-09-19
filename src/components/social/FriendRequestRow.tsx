import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ProfileAvatar } from "./ProfileAvatar";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  rejectFriendRequest,
  type FriendRequestItem,
} from "../../lib/social";
import { cn } from "../../lib/utils";

export interface FriendRequestRowProps {
  request: FriendRequestItem;
  onActionSuccess?: () => void;
  className?: string;
}

export function FriendRequestRow({ request, onActionSuccess, className }: FriendRequestRowProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAccept = async () => {
    setIsProcessing(true);
    try {
      await acceptFriendRequest({ data: { targetUserId: request.userId } });
      toast.success(`Đã chấp nhận lời mời từ ${request.displayName}!`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể chấp nhận lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    setIsProcessing(true);
    try {
      await rejectFriendRequest({ data: { targetUserId: request.userId } });
      toast.info(`Đã từ chối lời mời từ ${request.displayName}.`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể từ chối lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    setIsProcessing(true);
    try {
      await cancelFriendRequest({ data: { targetUserId: request.userId } });
      toast.info(`Đã huỷ lời mời kết bạn gửi đến ${request.displayName}.`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể huỷ lời mời");
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
        <ProfileAvatar src={request.avatarUrl} name={request.displayName} handle={request.handle} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{request.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">@{request.handle}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            {request.direction === "incoming" ? "Muốn kết bạn với bạn" : "Đã gửi lời mời"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {request.direction === "incoming" ? (
          <>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleAccept}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Chấp nhận
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleReject}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-white/10 hover:text-destructive active:scale-95 disabled:opacity-50"
            >
              <X className="size-3.5" />
              Từ chối
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive active:scale-95 disabled:opacity-50"
          >
            {isProcessing && <Loader2 className="size-3.5 animate-spin" />}
            Huỷ lời mời
          </button>
        )}
      </div>
    </div>
  );
}
