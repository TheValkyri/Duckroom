import { Loader2, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/useAuth";
import { getOwnerUsersServer, setUserRoleServer, type OwnerUserProfile } from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

export function UsersSection() {
  const [users, setUsers] = useState<OwnerUserProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { user: me } = useAuth();

  const loadUsers = useCallback(async () => {
    setError(null);
    try {
      const res = await getOwnerUsersServer();
      setUsers(res.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách người dùng.");
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleToggleRole = async (target: OwnerUserProfile) => {
    const nextRole = target.role === "owner" ? "member" : "owner";
    if (!confirm(`Chuyển vai trò của ${target.email} thành "${nextRole}"?`)) return;
    setBusyId(target.user_id);
    try {
      await setUserRoleServer({ data: { userId: target.user_id, role: nextRole } });
      setUsers((prev) => (prev ?? []).map((u) => (u.user_id === target.user_id ? { ...u, role: nextRole } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đổi vai trò thất bại.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard
      title="Người dùng & Vai trò"
      description="Quản lý Guest/Member/Owner. Server từ chối tự đổi vai trò của chính bạn."
      icon={UserCog}
    >
      {error && <p className="text-destructive mt-4 text-xs">{error}</p>}
      {!users && !error && (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" /> Đang tải…
        </p>
      )}
      {users && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {users.map((u) => (
            <div
              key={u.user_id}
              className="border-border bg-card/60 flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.display_name || u.email}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {u.email} · tham gia {new Date(u.created_at).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  u.role === "owner"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground border-border bg-muted/20",
                )}
              >
                {u.role}
              </span>
              <button
                type="button"
                disabled={busyId !== null || u.user_id === me?.id}
                title={u.user_id === me?.id ? "Không thể tự thay đổi vai trò" : undefined}
                onClick={() => void handleToggleRole(u)}
                className="border-border hover:bg-accent shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyId === u.user_id ? "…" : u.role === "owner" ? "Hạ thành Member" : "Nâng thành Owner"}
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-muted-foreground p-6 text-center text-xs">Chưa có người dùng nào.</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
