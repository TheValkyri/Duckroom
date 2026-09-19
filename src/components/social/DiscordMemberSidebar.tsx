import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Headphones, LogIn, PanelRightClose, PanelRightOpen, Plus, Radio, UserPlus, Users } from "lucide-react";
import { motion } from "motion/react";
import { useAuth } from "../../lib/useAuth";
import { listFriends, type FriendItem } from "../../lib/social";
import { socialStore, useAllFriendsPresence } from "../../lib/social/social-store";
import { socialSubscriptions } from "../../lib/social/social-subscriptions";
import { ProfileAvatar } from "./ProfileAvatar";
import { PresenceDot } from "./PresenceDot";
import { ProfileCard } from "./ProfileCard";
import { springSnappy, tapScale } from "../../lib/motion";
import { cn } from "../../lib/utils";

export interface DiscordMemberSidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function DiscordMemberSidebar({ open, onToggle }: DiscordMemberSidebarProps) {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Subscribe to realtime presence updates across all friends
  useAllFriendsPresence();

  const loadFriends = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setIsLoading(true);
      const data = await listFriends();
      setFriends(data);
      const friendIds = data.map((f) => f.userId);
      socialSubscriptions.syncFriends(friendIds);
    } catch (err) {
      console.warn("[DiscordMemberSidebar] Failed to load friends:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) {
      loadFriends();
    } else {
      setFriends([]);
    }
  }, [isLoggedIn, loadFriends]);

  // Categorize friends Discord-style
  const listeningFriends: { friend: FriendItem; trackTitle: string; artistName: string }[] = [];
  const onlineFriends: FriendItem[] = [];
  const offlineFriends: FriendItem[] = [];

  for (const friend of friends) {
    const presence = socialStore.getFriend(friend.userId);
    const status = presence?.status || "offline";

    if (status === "listening" || status === "paused") {
      listeningFriends.push({
        friend,
        trackTitle: presence?.trackTitle || "Đang phát nhạc",
        artistName: presence?.artistName || "Nghệ sĩ",
      });
    } else if (status === "online") {
      onlineFriends.push(friend);
    } else {
      offlineFriends.push(friend);
    }
  }

  return (
    <>
      <div
        role="complementary"
        aria-label="Danh sách bạn bè"
        style={{ width: open ? 272 : 0 }}
        className={cn(
          "bg-sidebar/95 fixed inset-y-0 right-0 z-30 hidden flex-col select-none overflow-hidden transition-[width] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex",
          open ? "edge-shadow-l border-l border-white/5" : "border-l-0",
        )}
      >
        {/* Sidebar Header */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            <Users className="size-4 text-primary shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground truncate">
              Bạn bè ({friends.length})
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isLoggedIn && (
              <Link
                to="/friends"
                title="Tìm kiếm & Thêm bạn"
                aria-label="Tìm kiếm bạn bè"
                className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="size-4" />
              </Link>
            )}
            <motion.button
              type="button"
              whileTap={tapScale}
              onClick={onToggle}
              title="Đóng sidebar bạn bè"
              aria-label="Đóng sidebar bạn bè"
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors cursor-pointer"
            >
              <PanelRightClose className="size-4" />
            </motion.button>
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto px-2 py-3 pb-24 space-y-5">
          {!isLoggedIn ? (
            <div className="flex flex-col items-center justify-center p-4 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary mb-3">
                <Users className="size-6" />
              </div>
              <p className="text-xs font-bold text-foreground">Kết nối bạn bè</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Đăng nhập để xem bạn bè đang nghe nhạc gì và cùng chia sẻ bài hát.
              </p>
              <Link
                to="/login"
                className="mt-3.5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 active:scale-95"
              >
                <LogIn className="size-3.5" />
                <span>Đăng nhập</span>
              </Link>
            </div>
          ) : friends.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center p-4 text-center">
              <div className="grid size-10 place-items-center rounded-xl bg-white/5 text-muted-foreground mb-2.5">
                <UserPlus className="size-5" />
              </div>
              <p className="text-xs font-semibold text-foreground">Chưa có bạn bè</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Tìm kiếm bằng @handle hoặc mã bạn bè để kết nối.
              </p>
              <Link
                to="/friends"
                className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/10"
              >
                <Plus className="size-3.5" />
                <span>Thêm bạn bè</span>
              </Link>
            </div>
          ) : (
            <>
              {/* Category 1: ĐANG NGHE NHẠC */}
              {listeningFriends.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex size-2 items-center justify-center">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Đang nghe nhạc — {listeningFriends.length}
                      </h3>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    {listeningFriends.map(({ friend, trackTitle, artistName }) => (
                      <button
                        key={friend.friendshipId}
                        type="button"
                        onClick={() => setSelectedUserId(friend.userId)}
                        className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5 cursor-pointer"
                      >
                        <div className="relative shrink-0">
                          <ProfileAvatar
                            src={friend.avatarUrl}
                            name={friend.displayName}
                            handle={friend.handle}
                            size="sm"
                            className="size-8"
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-0.5">
                            <PresenceDot status="listening" size="xs" />
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                            {friend.displayName}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-primary/90 truncate">
                            {/* Animated Equalizer Wave */}
                            <span className="inline-flex items-end gap-[1.5px] h-2.5 shrink-0 py-0.5">
                              <span className="w-[2px] h-full bg-primary rounded-full animate-pulse" />
                              <span className="w-[2px] h-1/2 bg-primary rounded-full animate-pulse [animation-delay:150ms]" />
                              <span className="w-[2px] h-3/4 bg-primary rounded-full animate-pulse [animation-delay:300ms]" />
                            </span>
                            <span className="truncate">{trackTitle}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 2: TRỰC TUYẾN */}
              {onlineFriends.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
                    Trực tuyến — {onlineFriends.length}
                  </h3>

                  <div className="space-y-0.5">
                    {onlineFriends.map((friend) => (
                      <button
                        key={friend.friendshipId}
                        type="button"
                        onClick={() => setSelectedUserId(friend.userId)}
                        className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5 cursor-pointer"
                      >
                        <div className="relative shrink-0">
                          <ProfileAvatar
                            src={friend.avatarUrl}
                            name={friend.displayName}
                            handle={friend.handle}
                            size="sm"
                            className="size-8"
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-0.5">
                            <PresenceDot status="online" size="xs" />
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                            {friend.displayName}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">@{friend.handle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 3: NGOẠI TUYẾN */}
              {offlineFriends.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
                    Ngoại tuyến — {offlineFriends.length}
                  </h3>

                  <div className="space-y-0.5">
                    {offlineFriends.map((friend) => (
                      <button
                        key={friend.friendshipId}
                        type="button"
                        onClick={() => setSelectedUserId(friend.userId)}
                        className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left opacity-60 hover:opacity-100 transition-all hover:bg-white/5 cursor-pointer"
                      >
                        <div className="relative shrink-0">
                          <ProfileAvatar
                            src={friend.avatarUrl}
                            name={friend.displayName}
                            handle={friend.handle}
                            size="sm"
                            className="size-8 grayscale group-hover:grayscale-0 transition-all"
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-0.5">
                            <PresenceDot status="offline" size="xs" />
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{friend.displayName}</p>
                          <p className="truncate text-[10px] text-muted-foreground">Ngoại tuyến</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating Toggle Button when closed on wide screens */}
      {!open && (
        <motion.button
          type="button"
          whileTap={tapScale}
          whileHover={{ scale: 1.05 }}
          transition={springSnappy}
          onClick={onToggle}
          title="Mở danh sách bạn bè"
          aria-label="Mở danh sách bạn bè"
          className="fixed right-4 top-4 z-20 hidden lg:flex items-center gap-2 rounded-2xl border border-white/10 bg-card/80 px-3 py-2 text-xs font-semibold text-foreground backdrop-blur-xl shadow-lg hover:border-primary/40 hover:bg-card hover:text-primary transition-all cursor-pointer"
        >
          <Users className="size-4 text-primary" />
          <span>Bạn bè{isLoggedIn ? ` (${friends.length})` : ""}</span>
        </motion.button>
      )}

      {/* Profile Card Popover */}
      <ProfileCard
        userId={selectedUserId}
        open={Boolean(selectedUserId)}
        onClose={() => setSelectedUserId(null)}
        onActionSuccess={loadFriends}
      />
    </>
  );
}
