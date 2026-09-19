import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox, Loader2, LogIn, ShieldAlert, UserCheck, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/useAuth";
import {
  listBlockedUsers,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  type BlockedUserItem,
  type FriendItem,
  type FriendRequestItem,
} from "../lib/social";
import { FriendCard } from "../components/social/FriendCard";
import { FriendRequestRow } from "../components/social/FriendRequestRow";
import { FriendSearch } from "../components/social/FriendSearch";
import { BlockedUserRow } from "../components/social/BlockedUserRow";
import { ProfileCard } from "../components/social/ProfileCard";
import { socialStore, useAllFriendsPresence } from "../lib/social/social-store";
import { socialSubscriptions } from "../lib/social/social-subscriptions";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [
      { title: "Bạn bè — Duckroom" },
      { name: "description", content: "Danh sách bạn bè, lời mời kết bạn và tìm kiếm thành viên trên Duckroom." },
    ],
  }),
  component: FriendsPage,
});

type TabKey = "friends" | "requests" | "add" | "blocked";

function FriendsPage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("friends");

  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const handleCloseProfile = useCallback(() => setSelectedFriendId(null), []);

  // Subscribe to reactive presence updates across all friends
  useAllFriendsPresence();

  const loadData = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const [friendsData, incomingData, outgoingData, blockedData] = await Promise.all([
        listFriends(),
        listIncomingRequests(),
        listOutgoingRequests(),
        listBlockedUsers(),
      ]);
      setFriends(friendsData);
      setIncomingRequests(incomingData);
      setOutgoingRequests(outgoingData);
      setBlockedUsers(blockedData);

      // Synchronize Realtime channel subscriptions for friends (§11, §20)
      const friendIds = friendsData.map((f) => f.userId);
      socialSubscriptions.syncFriends(friendIds);
    } catch (err) {
      console.error("Failed to load friend data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [isLoggedIn, authLoading, loadData]);

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-4">
          <Users className="size-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Bạn bè trên Duckroom</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Đăng nhập để kết nối, xem trạng thái bạn bè và chia sẻ trải nghiệm âm nhạc cùng nhau.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 active:scale-95"
        >
          <LogIn className="size-4" />
          Đăng nhập ngay
        </Link>
      </div>
    );
  }

  // Split friends into Active vs Offline based on real-time presence (§21, §22)
  const activeFriends: FriendItem[] = [];
  const offlineFriends: FriendItem[] = [];

  friends.forEach((friend) => {
    const presence = socialStore.getFriend(friend.userId);
    const status = presence?.status || "offline";
    if (status !== "offline") {
      activeFriends.push(friend);
    } else {
      offlineFriends.push(friend);
    }
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Bạn bè</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quản lý kết nối, gửi lời mời và tìm kiếm thành viên Duckroom.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab("add")}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-95",
            activeTab === "add"
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground hover:opacity-95",
          )}
        >
          <UserPlus className="size-4" />
          Thêm bạn bè
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-2 border-b border-white/5 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("friends")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "friends"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <UserCheck className="size-4" />
          <span>Tất cả bạn bè</span>
          {friends.length > 0 && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
              {friends.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("requests")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "requests"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Inbox className="size-4" />
          <span>Lời mời</span>
          {incomingRequests.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
              {incomingRequests.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("add")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "add"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <UserPlus className="size-4" />
          <span>Tìm kiếm</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("blocked")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "blocked"
              ? "bg-destructive/15 text-destructive"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <ShieldAlert className="size-4" />
          <span>Đang chặn</span>
          {blockedUsers.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {blockedUsers.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="mt-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex flex-col justify-between gap-2.5 rounded-2xl border border-white/5 bg-card/60 p-3.5 shadow-sm backdrop-blur-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <div className="size-10 rounded-full bg-white/10 animate-pulse motion-reduce:animate-none" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 rounded bg-white/10 animate-pulse motion-reduce:animate-none" />
                      <div className="h-2.5 w-20 rounded bg-white/5 animate-pulse motion-reduce:animate-none" />
                    </div>
                  </div>
                  <div className="size-8 rounded-lg bg-white/5 animate-pulse motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Tab: All Friends */}
            {activeTab === "friends" && (
              <div className="space-y-6">
                {friends.length === 0 ? (
                  <div className="rounded-2xl border border-white/5 bg-card/40 p-8 text-center backdrop-blur-sm">
                    <div className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/10 text-primary mb-3">
                      <Users className="size-6" />
                    </div>
                    <p className="text-base font-semibold text-foreground">Chưa có bạn bè nào</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Hãy tìm kiếm bạn bè qua @handle hoặc mã bạn bè để kết nối cùng nhau.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab("add")}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-95"
                    >
                      <UserPlus className="size-4" />
                      Tìm bạn ngay
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Active friends group */}
                    {activeFriends.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="relative flex size-2.5 items-center justify-center">
                            <span className="absolute inline-flex size-full animate-ping motion-reduce:animate-none rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                          </span>
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Đang hoạt động ({activeFriends.length})
                          </h2>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {activeFriends.map((friend) => (
                            <FriendCard
                              key={friend.friendshipId}
                              friend={friend}
                              onActionSuccess={loadData}
                              onSelect={(f) => setSelectedFriendId(f.userId)}
                              showLiveActivity
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Offline friends group */}
                    {offlineFriends.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-zinc-600/60" />
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ngoại tuyến ({offlineFriends.length})
                          </h2>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {offlineFriends.map((friend) => (
                            <FriendCard
                              key={friend.friendshipId}
                              friend={friend}
                              onActionSuccess={loadData}
                              onSelect={(f) => setSelectedFriendId(f.userId)}
                              showLiveActivity={false}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Tab: Pending Requests */}
            {activeTab === "requests" && (
              <div className="space-y-6">
                {/* Incoming Requests */}
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Lời mời đã nhận ({incomingRequests.length})
                  </h2>
                  {incomingRequests.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground/80">Không có lời mời kết bạn nào đang chờ.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {incomingRequests.map((req) => (
                        <FriendRequestRow key={req.friendshipId} request={req} onActionSuccess={loadData} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Outgoing Requests */}
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Lời mời đã gửi ({outgoingRequests.length})
                  </h2>
                  {outgoingRequests.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground/80">Bạn chưa gửi lời mời kết bạn nào.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {outgoingRequests.map((req) => (
                        <FriendRequestRow key={req.friendshipId} request={req} onActionSuccess={loadData} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab: Add Friend Search */}
            {activeTab === "add" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Nhập chính xác <strong className="text-foreground">@handle</strong> hoặc{" "}
                  <strong className="text-foreground">mã bạn bè</strong> (ví dụ:{" "}
                  <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-xs text-primary">DUCK-XXXX-XXXX</code>
                  ) để tìm kiếm và gửi lời mời kết bạn.
                </p>
                <FriendSearch onActionSuccess={loadData} />
              </div>
            )}

            {/* Tab: Blocked */}
            {activeTab === "blocked" && (
              <div className="space-y-3">
                {blockedUsers.length === 0 ? (
                  <div className="rounded-2xl border border-white/5 bg-card/40 p-8 text-center backdrop-blur-sm">
                    <p className="text-sm text-muted-foreground">Danh sách chặn đang trống.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {blockedUsers.map((user) => (
                      <BlockedUserRow key={user.friendshipId} user={user} onActionSuccess={loadData} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Profile Detail Dialog (§19, §26) */}
      <ProfileCard
        userId={selectedFriendId}
        open={Boolean(selectedFriendId)}
        onClose={handleCloseProfile}
        onActionSuccess={loadData}
      />
    </div>
  );
}
