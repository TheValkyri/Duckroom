import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Loader2, ShieldAlert, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  acceptFriendRequest,
  blockUser,
  cancelFriendRequest,
  getProfile,
  rejectFriendRequest,
  removeFriend,
  sendFriendRequest,
  type MemberProfileView,
} from "../../lib/social";
import { useFriendPresence } from "../../lib/social/social-store";
import { socialSubscriptions } from "../../lib/social/social-subscriptions";
import { ProfileAvatar } from "./ProfileAvatar";
import { PresenceDot } from "./PresenceDot";
import { FriendActivity } from "./FriendActivity";
import { springSmooth } from "../../lib/motion";
import { useScrollLock } from "../../hooks/use-scroll-lock";
import { cn } from "../../lib/utils";

import { getCachedProfile, invalidateProfileCache, setCachedProfile } from "../../lib/social/profile-cache";

export interface ProfileCardProps {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  onActionSuccess?: () => void;
}

export function ProfileCard({ userId, open, onClose, onActionSuccess }: ProfileCardProps) {
  const [profile, setProfile] = useState<MemberProfileView | null>(() => {
    if (!userId) return null;
    return getCachedProfile(userId);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const presence = useFriendPresence(userId || "");
  const status = presence?.status || "offline";

  useScrollLock(open);

  useEffect(() => {
    if (!open || !userId) {
      setProfile(null);
      return;
    }

    const cached = getCachedProfile(userId);
    if (cached) {
      setProfile(cached);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    getProfile({ data: { userId } })
      .then((data) => {
        if (isMounted) {
          setCachedProfile(userId, data);
          setProfile(data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          toast.error(err?.message || "Không thể tải thông tin hồ sơ");
          onCloseRef.current?.();
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCopyHandle = async () => {
    if (!profile?.handle) return;
    try {
      await navigator.clipboard.writeText(`@${profile.handle}`);
      setCopiedHandle(true);
      toast.success(`Đã sao chép @${profile.handle}`);
      setTimeout(() => setCopiedHandle(false), 2000);
    } catch {
      toast.error("Không thể sao chép handle");
    }
  };

  const handleCopyCode = async () => {
    if (!profile?.friendCode) return;
    try {
      await navigator.clipboard.writeText(profile.friendCode);
      setCopiedCode(true);
      toast.success(`Đã sao chép mã bạn bè ${profile.friendCode}`);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Không thể sao chép mã");
    }
  };

  const handleRemoveFriend = async () => {
    if (!userId || !profile) return;
    if (!window.confirm(`Bạn có chắc muốn huỷ kết bạn với ${profile.displayName}?`)) return;
    setIsProcessing(true);
    try {
      await removeFriend({ data: { targetUserId: userId } });
      socialSubscriptions.removeFriend(userId);
      invalidateProfileCache(userId);
      toast.success(`Đã huỷ kết bạn với ${profile.displayName}`);
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Lỗi huỷ kết bạn");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBlockUser = async () => {
    if (!userId || !profile) return;
    if (
      !window.confirm(
        `Bạn có chắc muốn chặn ${profile.displayName}? Họ sẽ không thể gửi lời mời hoặc xem trạng thái của bạn.`,
      )
    ) {
      return;
    }
    setIsProcessing(true);
    try {
      await blockUser({ data: { targetUserId: userId } });
      socialSubscriptions.removeFriend(userId);
      invalidateProfileCache(userId);
      toast.success(`Đã chặn ${profile.displayName}`);
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Lỗi chặn người dùng");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendRequest = async () => {
    if (!userId) return;
    setIsProcessing(true);
    try {
      await sendFriendRequest({ data: { targetUserId: userId } });
      invalidateProfileCache(userId);
      toast.success("Đã gửi lời mời kết bạn");
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Không thể gửi lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!userId) return;
    setIsProcessing(true);
    try {
      await acceptFriendRequest({ data: { targetUserId: userId } });
      invalidateProfileCache(userId);
      toast.success("Đã chấp nhận lời mời kết bạn");
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Không thể chấp nhận lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectRequest = async () => {
    if (!userId) return;
    setIsProcessing(true);
    try {
      await rejectFriendRequest({ data: { targetUserId: userId } });
      invalidateProfileCache(userId);
      toast.success("Đã từ chối lời mời kết bạn");
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Không thể từ chối lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!userId) return;
    setIsProcessing(true);
    try {
      await cancelFriendRequest({ data: { targetUserId: userId } });
      invalidateProfileCache(userId);
      toast.success("Đã huỷ lời mời kết bạn");
      onActionSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Không thể huỷ lời mời");
    } finally {
      setIsProcessing(false);
    }
  };

  const cardMotionProps = {
    initial: { opacity: 0, scale: 0.95, y: 10 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 10 },
    transition: springSmooth,
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            aria-hidden
          />

          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Hồ sơ thành viên"
              {...cardMotionProps}
              className="pointer-events-auto relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-card/95 p-6 shadow-2xl backdrop-blur-xl"
            >
              {/* Close button */}
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground active:scale-95"
                aria-label="Đóng"
              >
                <X className="size-4" />
              </button>

              {isLoading || !profile ? (
                <div className="flex flex-col gap-5 py-2">
                  <div className="flex items-start gap-4">
                    <div className="size-16 rounded-full bg-white/10 animate-pulse motion-reduce:animate-none shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-5 w-36 rounded bg-white/10 animate-pulse motion-reduce:animate-none" />
                      <div className="h-3.5 w-24 rounded bg-white/5 animate-pulse motion-reduce:animate-none" />
                      <div className="h-3 w-16 rounded bg-white/5 animate-pulse motion-reduce:animate-none" />
                    </div>
                  </div>
                  <div className="h-12 w-full rounded-2xl bg-white/5 animate-pulse motion-reduce:animate-none" />
                  <div className="flex gap-2 pt-2 border-t border-white/5">
                    <div className="h-9 flex-1 rounded-xl bg-white/5 animate-pulse motion-reduce:animate-none" />
                    <div className="h-9 w-24 rounded-xl bg-white/5 animate-pulse motion-reduce:animate-none" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {/* Header: Avatar, Names, Presence */}
                  <div className="flex items-start gap-4">
                    <div className="relative shrink-0">
                      <ProfileAvatar
                        src={profile.avatarUrl}
                        name={profile.displayName}
                        handle={profile.handle}
                        size="lg"
                        className="size-16 ring-2 ring-white/10"
                      />
                      <div className="absolute -bottom-1 -right-1 rounded-full bg-card p-1 shadow-sm">
                        <PresenceDot status={status} size="md" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <h3 className="truncate text-lg font-bold text-foreground">{profile.displayName}</h3>
                      <button
                        type="button"
                        onClick={handleCopyHandle}
                        className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <span className="truncate">@{profile.handle}</span>
                        {copiedHandle ? (
                          <Check className="size-3 text-emerald-400 shrink-0" />
                        ) : (
                          <Copy className="size-3 opacity-60 group-hover:opacity-100 shrink-0" />
                        )}
                      </button>

                      <div className="mt-2 flex items-center gap-2">
                        <PresenceDot status={status} size="xs" showText />
                      </div>
                    </div>
                  </div>

                  {/* Friend code block if accepted or self */}
                  {profile.friendCode && (
                    <div className="flex items-center justify-between rounded-2xl bg-white/5 border border-white/5 px-3.5 py-2.5">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block tracking-wider">
                          Mã bạn bè
                        </span>
                        <span className="font-mono text-xs font-bold text-foreground">{profile.friendCode}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="grid size-8 place-items-center rounded-xl bg-white/5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                        aria-label="Sao chép mã bạn bè"
                      >
                        {copiedCode ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  )}

                  {/* Live Activity Section */}
                  {userId && (status === "listening" || status === "paused") && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Đang nghe gần đây
                      </span>
                      <FriendActivity userId={userId} />
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-2 flex flex-wrap gap-2 pt-2 border-t border-white/5">
                    {profile.relationship === "accepted" && (
                      <>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleRemoveFriend}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/20 active:scale-95 disabled:opacity-50"
                        >
                          <UserMinus className="size-3.5" />
                          <span>Huỷ kết bạn</span>
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleBlockUser}
                          className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/10 hover:text-destructive active:scale-95 disabled:opacity-50"
                        >
                          <ShieldAlert className="size-3.5" />
                          <span>Chặn</span>
                        </button>
                      </>
                    )}

                    {profile.relationship === "pending_received" && (
                      <>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleAcceptRequest}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 active:scale-95 disabled:opacity-50"
                        >
                          <UserCheck className="size-3.5" />
                          <span>Chấp nhận</span>
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleRejectRequest}
                          className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/10 hover:text-foreground active:scale-95 disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                          <span>Từ chối</span>
                        </button>
                      </>
                    )}

                    {profile.relationship === "pending_sent" && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={handleCancelRequest}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/10 hover:text-foreground active:scale-95 disabled:opacity-50"
                      >
                        <X className="size-3.5" />
                        <span>Huỷ lời mời</span>
                      </button>
                    )}

                    {profile.relationship === "none" && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={handleSendRequest}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 active:scale-95 disabled:opacity-50"
                      >
                        <UserPlus className="size-3.5" />
                        <span>Kết bạn</span>
                      </button>
                    )}

                    {profile.relationship === "self" && (
                      <span className="text-xs text-muted-foreground italic w-full text-center">
                        Đây là hồ sơ cá nhân của bạn
                      </span>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
