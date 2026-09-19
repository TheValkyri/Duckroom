import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, Search, UserPlus, Users } from "lucide-react";
import { MobileSheet } from "../MobileSheet";
import { FriendCard } from "./FriendCard";
import { FriendRequestRow } from "./FriendRequestRow";
import { FriendSearch } from "./FriendSearch";
import { ProfileCard } from "./ProfileCard";
import { listFriends, listIncomingRequests, type FriendItem, type FriendRequestItem } from "../../lib/social";
import { socialStore, useAllFriendsPresence } from "../../lib/social/social-store";
import { socialSubscriptions } from "../../lib/social/social-subscriptions";
import { cn } from "../../lib/utils";

export interface FriendsSheetProps {
  open: boolean;
  onClose: () => void;
}

type SheetView = "friends" | "requests" | "search";

export function FriendsSheet({ open, onClose }: FriendsSheetProps) {
  const [currentView, setCurrentView] = useState<SheetView>("friends");
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const handleCloseProfile = useCallback(() => setSelectedFriendId(null), []);

  // Subscribe to realtime presence updates across all friends
  useAllFriendsPresence();

  const loadSocialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [friendsList, incomingList] = await Promise.all([listFriends(), listIncomingRequests()]);
      setFriends(friendsList);
      setIncomingRequests(incomingList);

      // Sync realtime channel subscriptions
      const friendIds = friendsList.map((f) => f.userId);
      socialSubscriptions.syncFriends(friendIds);
    } catch (err) {
      console.warn("[FriendsSheet] Failed to load friends:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadSocialData();
      setCurrentView("friends");
    }
  }, [open, loadSocialData]);

  // Split friends into Active vs Offline based on socialStore
  const activeFriends: FriendItem[] = [];
  const offlineFriends: FriendItem[] = [];

  friends.forEach((f) => {
    const presence = socialStore.getFriend(f.userId);
    const status = presence?.status || "offline";
    if (status !== "offline") {
      activeFriends.push(f);
    } else {
      offlineFriends.push(f);
    }
  });

  return (
    <>
      <MobileSheet open={open} onClose={onClose} title="Bạn bè" maxHeightVh={82}>
        <div className="flex flex-col h-full overflow-hidden px-4 pb-4">
          {/* Navigation sub-tabs */}
          <div className="flex items-center gap-2 border-b border-white/5 pb-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setCurrentView("friends")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
                currentView === "friends"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Users className="size-3.5" />
              <span>Bạn bè ({friends.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentView("requests")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
                currentView === "requests"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Inbox className="size-3.5" />
              <span>Lời mời</span>
              {incomingRequests.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.2 text-[10px] font-bold text-primary-foreground">
                  {incomingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCurrentView("search")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ml-auto",
                currentView === "search"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Search className="size-3.5" />
              <span>Tìm kiếm</span>
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto pt-3 space-y-4 pr-1">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {/* View: All Friends (Active + Offline groups §21, §23) */}
                {currentView === "friends" && (
                  <div className="space-y-4">
                    {friends.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-card/40 py-10 px-4 text-center">
                        <Users className="size-8 text-muted-foreground mb-2" />
                        <p className="text-sm font-semibold text-foreground">Chưa có bạn bè</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Tìm kiếm bạn bè qua @handle hoặc mã bạn bè để kết nối.
                        </p>
                        <button
                          type="button"
                          onClick={() => setCurrentView("search")}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          <UserPlus className="size-3.5" />
                          <span>Tìm bạn bè</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Đang hoạt động group */}
                        {activeFriends.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Đang hoạt động ({activeFriends.length})
                              </h3>
                            </div>
                            <div className="space-y-2">
                              {activeFriends.map((friend) => (
                                <FriendCard
                                  key={friend.friendshipId}
                                  friend={friend}
                                  onActionSuccess={loadSocialData}
                                  onSelect={(f) => setSelectedFriendId(f.userId)}
                                  showLiveActivity
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Ngoại tuyến group */}
                        {offlineFriends.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                              Ngoại tuyến ({offlineFriends.length})
                            </h3>
                            <div className="space-y-2">
                              {offlineFriends.map((friend) => (
                                <FriendCard
                                  key={friend.friendshipId}
                                  friend={friend}
                                  onActionSuccess={loadSocialData}
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

                {/* View: Friend Requests */}
                {currentView === "requests" && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Lời mời đã nhận ({incomingRequests.length})
                    </h3>
                    {incomingRequests.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        Không có lời mời kết bạn nào đang chờ.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {incomingRequests.map((req) => (
                          <FriendRequestRow key={req.friendshipId} request={req} onActionSuccess={loadSocialData} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* View: Search */}
                {currentView === "search" && (
                  <div className="space-y-3">
                    <FriendSearch onActionSuccess={loadSocialData} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </MobileSheet>

      {/* Profile Detail Dialog */}
      <ProfileCard
        userId={selectedFriendId}
        open={Boolean(selectedFriendId)}
        onClose={handleCloseProfile}
        onActionSuccess={loadSocialData}
      />
    </>
  );
}
