import { useState } from "react";
import { Copy, Loader2, MoreVertical, ShieldAlert, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ProfileAvatar } from "./ProfileAvatar";
import { blockUser, removeFriend, type FriendItem } from "../../lib/social";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/utils";

import { useFriendPresence } from "../../lib/social/social-store";
import { socialSubscriptions } from "../../lib/social/social-subscriptions";
import { PresenceDot } from "./PresenceDot";
import { FriendActivity } from "./FriendActivity";
import { invalidateProfileCache } from "../../lib/social/profile-cache";

export interface FriendCardProps {
  friend: FriendItem;
  onActionSuccess?: () => void;
  onSelect?: (friend: FriendItem) => void;
  className?: string;
  showLiveActivity?: boolean;
}

export function FriendCard({ friend, onActionSuccess, onSelect, className, showLiveActivity = true }: FriendCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const presence = useFriendPresence(friend.userId);
  const status = presence?.status || "offline";
  const isListening = status === "listening" || status === "paused";

  const handleCopyHandle = async () => {
    try {
      await navigator.clipboard.writeText(`@${friend.handle}`);
      toast.success(`Đã sao chép @${friend.handle}`);
    } catch {
      toast.error("Không thể sao chép handle");
    }
  };

  const handleRemoveFriend = async () => {
    if (!window.confirm(`Bạn có chắc chắn muốn huỷ kết bạn với ${friend.displayName}?`)) {
      return;
    }
    setIsProcessing(true);
    try {
      await removeFriend({ data: { targetUserId: friend.userId } });
      socialSubscriptions.removeFriend(friend.userId);
      invalidateProfileCache(friend.userId);
      toast.success(`Đã huỷ kết bạn với ${friend.displayName}.`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể huỷ kết bạn");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBlockUser = async () => {
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn chặn ${friend.displayName}? Người này sẽ không thể liên hệ hoặc xem trạng thái của bạn.`,
      )
    ) {
      return;
    }
    setIsProcessing(true);
    try {
      await blockUser({ data: { targetUserId: friend.userId } });
      socialSubscriptions.removeFriend(friend.userId);
      invalidateProfileCache(friend.userId);
      toast.success(`Đã chặn ${friend.displayName}.`);
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể chặn người dùng");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between gap-2.5 rounded-2xl border border-white/5 bg-card/60 p-3.5 shadow-sm backdrop-blur-sm transition-all hover:border-white/10 hover:bg-card/80",
        onSelect && "cursor-pointer",
        className,
      )}
      onClick={() => onSelect?.(friend)}
    >
      <div className="flex items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-3.5 overflow-hidden">
          <div className="relative shrink-0">
            <ProfileAvatar src={friend.avatarUrl} name={friend.displayName} handle={friend.handle} size="md" />
            <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-0.5 shadow-sm">
              <PresenceDot status={status} size="xs" />
            </div>
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {friend.displayName}
            </p>
            <p className="truncate text-xs text-muted-foreground">@{friend.handle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isProcessing ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-foreground active:scale-95"
                  aria-label={`Tuỳ chọn cho ${friend.displayName}`}
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleCopyHandle} className="cursor-pointer gap-2">
                  <Copy className="size-4" />
                  <span>Sao chép @handle</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleRemoveFriend}
                  className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <UserMinus className="size-4" />
                  <span>Huỷ kết bạn</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={handleBlockUser}
                  className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <ShieldAlert className="size-4" />
                  <span>Chặn người dùng</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {showLiveActivity && isListening && (
        <div className="pt-0.5 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
          <FriendActivity userId={friend.userId} compact />
        </div>
      )}
    </div>
  );
}
