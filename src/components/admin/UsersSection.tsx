import { CheckCircle2, Copy, Filter, Loader2, RefreshCw, Search, Shield, ShieldAlert, User, UserCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/useAuth";
import { supabase } from "../../lib/supabase-client";
import { getOwnerUsersServer, setUserRoleServer, type OwnerUserProfile } from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

export interface UsersSectionProps {
  initialUsers?: OwnerUserProfile[] | null;
  onRefreshUsers?: () => Promise<void>;
}

export function UsersSection({ initialUsers, onRefreshUsers }: UsersSectionProps = {}) {
  const [users, setUsers] = useState<OwnerUserProfile[] | null>(initialUsers ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "owner" | "member">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user: me } = useAuth();

  useEffect(() => {
    if (initialUsers) {
      setUsers(initialUsers);
    }
  }, [initialUsers]);

  const loadUsers = useCallback(async (silent = false) => {
    if (onRefreshUsers) {
      await onRefreshUsers();
      return;
    }
    if (!silent) setError(null);
    try {
      const res = await getOwnerUsersServer();
      setUsers(res.users ?? []);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Không thể tải danh sách người dùng.");
    }
  }, [onRefreshUsers]);

  useEffect(() => {
    if (!initialUsers) {
      void loadUsers();
    }

    // Realtime listener for instant updates when a user logs in or profile changes
    const channel = supabase
      .channel("owner-admin-users")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
        },
        () => {
          void loadUsers(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadUsers, initialUsers]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadUsers();
    setIsRefreshing(false);
  };

  const handleToggleRole = async (target: OwnerUserProfile) => {
    const nextRole = target.role === "owner" ? "member" : "owner";
    if (!confirm(`Bạn có chắc chắn muốn chuyển vai trò của "${target.display_name || target.email}" thành "${nextRole.toUpperCase()}" không?`)) {
      return;
    }
    setBusyId(target.user_id);
    try {
      await setUserRoleServer({ data: { userId: target.user_id, role: nextRole } });
      setUsers((prev) => (prev ?? []).map((u) => (u.user_id === target.user_id ? { ...u, role: nextRole } : u)));
      if (onRefreshUsers) {
        void onRefreshUsers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đổi vai trò thất bại.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter((u) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (u.display_name && u.display_name.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        (u.handle && u.handle.toLowerCase().includes(q)) ||
        (u.friend_code && u.friend_code.toLowerCase().includes(q));

      if (!matchSearch) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      return true;
    });
  }, [users, search, roleFilter]);

  return (
    <SectionCard
      title="Người dùng & Phân quyền (User Directory)"
      description="Quản lý toàn bộ danh sách tài khoản Duckroom thật, đồng bộ tự động từ Supabase Auth & Google OAuth theo thời gian thực."
      icon={UserCog}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 hover:bg-accent text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3", isRefreshing && "animate-spin text-primary")} />
            <span>Đồng bộ Realtime</span>
          </button>
          <span className="text-xs text-muted-foreground font-mono font-medium">
            <strong>{users?.length ?? "…"}</strong> tài khoản
          </span>
        </div>
      }
    >
      {/* Search & Filter Controls */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên hiển thị, @handle, Google email hoặc friend code..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-background/60 border border-border rounded-xl outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border/60 text-xs">
          <button
            type="button"
            onClick={() => setRoleFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
              roleFilter === "all" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Tất cả
          </button>
          <button
            type="button"
            onClick={() => setRoleFilter("owner")}
            className={cn(
              "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
              roleFilter === "owner" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Owners
          </button>
          <button
            type="button"
            onClick={() => setRoleFilter("member")}
            className={cn(
              "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
              roleFilter === "member" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Members
          </button>
        </div>
      </div>

      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {!users && !error && (
        <p className="text-muted-foreground mt-6 flex items-center justify-center gap-2 text-xs py-8">
          <Loader2 className="size-4 animate-spin text-primary" /> Đang tải danh sách người dùng realtime…
        </p>
      )}

      {users && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {filteredUsers.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-xs">Không tìm thấy người dùng nào phù hợp.</p>
          ) : (
            <div className="divide-y divide-border/60 bg-card/40">
              {filteredUsers.map((u) => {
                const isMe = u.user_id === me?.id;
                const isOwner = u.role === "owner";

                return (
                  <div
                    key={u.user_id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-accent/20 transition-colors"
                  >
                    {/* User Identity Details */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="size-11 rounded-full overflow-hidden bg-muted/60 shrink-0 border border-white/10 relative flex items-center justify-center">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt={u.display_name || u.email} className="size-full object-cover" />
                        ) : (
                          <span className="text-sm font-semibold uppercase text-primary">
                            {(u.display_name || u.email).slice(0, 2)}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate text-foreground">
                            {u.display_name || u.email.split("@")[0]}
                          </p>
                          {isMe && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/20 text-primary border border-primary/30 font-medium">
                              Bạn
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                          {u.handle && (
                            <span className="font-mono text-primary/90 font-medium">@{u.handle}</span>
                          )}
                          <span>•</span>
                          <span className="truncate">{u.email}</span>
                          {u.friend_code && (
                            <>
                              <span>•</span>
                              <button
                                type="button"
                                onClick={() => handleCopy(u.friend_code!, u.user_id)}
                                className="font-mono text-[11px] text-muted-foreground/80 hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
                                title="Ấn để sao chép friend code"
                              >
                                {copiedId === u.user_id ? (
                                  <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                                    <CheckCircle2 className="size-3" /> Đã chép
                                  </span>
                                ) : (
                                  <>
                                    <span>#{u.friend_code}</span>
                                    <Copy className="size-2.5 opacity-60" />
                                  </>
                                )}
                              </button>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground/70 font-mono">
                          <span>Tham gia: {new Date(u.created_at).toLocaleDateString("vi-VN")}</span>
                          {u.last_sign_in_at && (
                            <span>
                              · Hoạt động: {new Date(u.last_sign_in_at).toLocaleDateString("vi-VN")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Role Badge and Action Button */}
                    <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1",
                          isOwner
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-border bg-muted/30 text-muted-foreground",
                        )}
                      >
                        <Shield className="size-3" /> {u.role}
                      </span>

                      <button
                        type="button"
                        disabled={busyId !== null || isMe}
                        title={isMe ? "Không thể tự thay đổi vai trò của chính mình" : undefined}
                        onClick={() => void handleToggleRole(u)}
                        className={cn(
                          "border-border hover:bg-accent shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer",
                          isOwner
                            ? "hover:border-destructive/40 hover:text-destructive"
                            : "hover:border-primary/40 hover:text-primary",
                        )}
                      >
                        {busyId === u.user_id
                          ? "Đang lưu…"
                          : isOwner
                            ? "Hạ thành Member"
                            : "Nâng thành Owner"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
