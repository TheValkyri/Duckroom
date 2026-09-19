import { useEffect, useState, useTransition } from "react";
import { Check, CheckCircle2, Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  findUsers,
  rejectFriendRequest,
  sendFriendRequest,
  unblockUser,
  type FriendSearchResult,
} from "../../lib/social";
import { ProfileAvatar } from "./ProfileAvatar";
import { cn } from "../../lib/utils";

export interface FriendSearchProps {
  onActionSuccess?: () => void;
  className?: string;
}

export function FriendSearch({ onActionSuccess, className }: FriendSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Search effect with debounce
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await findUsers({ data: { query: trimmed } });
        setResults(data);
        setHasSearched(true);
      } catch (err: any) {
        console.error("Search error:", err);
        toast.error(err?.message || "Không thể tìm kiếm người dùng");
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSendRequest = async (targetUserId: string) => {
    setActionInProgress(targetUserId);
    try {
      const res = await sendFriendRequest({ data: { targetUserId } });
      if (res.status === "accepted") {
        toast.success("Hai bạn đã trở thành bạn bè!");
      } else {
        toast.success("Đã gửi lời mời kết bạn!");
      }
      // Optimistically update result
      setResults((prev) =>
        prev.map((r) =>
          r.userId === targetUserId
            ? { ...r, relationship: res.status === "accepted" ? "accepted" : "pending_sent" }
            : r,
        ),
      );
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể gửi lời mời kết bạn");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAccept = async (targetUserId: string) => {
    setActionInProgress(targetUserId);
    try {
      await acceptFriendRequest({ data: { targetUserId } });
      toast.success("Đã chấp nhận lời mời kết bạn!");
      setResults((prev) => prev.map((r) => (r.userId === targetUserId ? { ...r, relationship: "accepted" } : r)));
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể chấp nhận lời mời");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (targetUserId: string) => {
    setActionInProgress(targetUserId);
    try {
      await rejectFriendRequest({ data: { targetUserId } });
      toast.info("Đã từ chối lời mời kết bạn.");
      setResults((prev) => prev.map((r) => (r.userId === targetUserId ? { ...r, relationship: "none" } : r)));
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể từ chối lời mời");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancel = async (targetUserId: string) => {
    setActionInProgress(targetUserId);
    try {
      await cancelFriendRequest({ data: { targetUserId } });
      toast.info("Đã huỷ lời mời kết bạn.");
      setResults((prev) => prev.map((r) => (r.userId === targetUserId ? { ...r, relationship: "none" } : r)));
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể huỷ lời mời");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUnblock = async (targetUserId: string) => {
    setActionInProgress(targetUserId);
    try {
      await unblockUser({ data: { targetUserId } });
      toast.success("Đã bỏ chặn người dùng.");
      setResults((prev) => prev.map((r) => (r.userId === targetUserId ? { ...r, relationship: "none" } : r)));
      onActionSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Không thể bỏ chặn");
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Search Input Bar */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
          {isSearching ? <Loader2 className="size-4 animate-spin text-primary" /> : <Search className="size-4" />}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm @handle hoặc mã bạn bè (DUCK-XXXX-XXXX)..."
          className="w-full rounded-xl border border-white/10 bg-card/60 py-2.5 pl-10 pr-10 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            aria-label="Xoá tìm kiếm"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="space-y-2">
          {isSearching && !results.length && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin text-primary" />
              Đang tìm kiếm...
            </div>
          )}

          {!isSearching && hasSearched && results.length === 0 && (
            <div className="rounded-xl border border-white/5 bg-card/30 py-8 text-center text-sm text-muted-foreground">
              Không tìm thấy người dùng nào phù hợp với "{query.trim()}".
            </div>
          )}

          {results.map((user) => {
            const isProcessing = actionInProgress === user.userId;
            return (
              <div
                key={user.userId}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-card/50 p-3 shadow-sm transition hover:bg-card/70"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <ProfileAvatar src={user.avatarUrl} name={user.displayName} handle={user.handle} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{user.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{user.handle}</p>
                  </div>
                </div>

                {/* Relationship Actions */}
                <div className="flex shrink-0 items-center gap-2">
                  {user.relationship === "self" && (
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Bạn</span>
                  )}

                  {user.relationship === "accepted" && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
                      <CheckCircle2 className="size-3.5" />
                      Bạn bè
                    </span>
                  )}

                  {user.relationship === "pending_sent" && (
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Đã gửi lời mời
                      </span>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleCancel(user.userId)}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-white/5 hover:text-destructive"
                      >
                        Huỷ
                      </button>
                    </div>
                  )}

                  {user.relationship === "pending_received" && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAccept(user.userId)}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 active:scale-95"
                      >
                        {isProcessing ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Chấp nhận
                      </button>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleReject(user.userId)}
                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-white/5 hover:text-destructive active:scale-95"
                      >
                        Từ chối
                      </button>
                    </div>
                  )}

                  {user.relationship === "blocked_by_me" && (
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                        Đang chặn
                      </span>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUnblock(user.userId)}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                      >
                        Bỏ chặn
                      </button>
                    </div>
                  )}

                  {user.relationship === "none" && (
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleSendRequest(user.userId)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 active:scale-95"
                    >
                      {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                      Kết bạn
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
