import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Ghost,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Shield,
  User,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useRef, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";
import { useSocialProfile, normalizeHandle, isValidHandle } from "../lib/social";
import { ProfileAvatar } from "../components/social/ProfileAvatar";
import { springSnappy, tapScale } from "../lib/motion";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Hồ sơ của tôi — Duckroom" },
      { name: "description", content: "Quản lý hồ sơ cá nhân, mã bạn bè và quyền riêng tư trên Duckroom." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: authLoading, signOut } = useAuth();
  const { isOwner } = useDuckroomRole();
  const { profile, isLoading: profileLoading, updateProfile, uploadAvatar } = useSocialProfile();

  // Edit states
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
          <User className="size-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Đăng nhập tài khoản</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vui lòng đăng nhập để xem và quản lý hồ sơ cá nhân, kết nối với bạn bè trên Duckroom.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:opacity-95 active:scale-95"
        >
          <LogIn className="size-4" />
          Đăng nhập ngay
        </Link>
      </div>
    );
  }

  const displayName = profile?.displayName || "Thành viên Duckroom";
  const handle = profile?.handle || "duck_member";
  const friendCode = profile?.friendCode || "DUCK-0000-0000";
  const isGhostMode = profile?.presenceVisibility === "none" && profile?.listeningVisibility === "none";

  const handleCopyFriendCode = async () => {
    try {
      await navigator.clipboard.writeText(friendCode);
      setCopiedCode(true);
      toast.success("Đã sao chép mã bạn bè!");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Không thể sao chép mã bạn bè.");
    }
  };

  const handleAvatarFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ảnh quá lớn. Vui lòng chọn ảnh dung lượng dưới 5MB.");
      return;
    }

    try {
      setIsUploadingAvatar(true);
      await uploadAvatar(file);
      toast.success("Đã cập nhật ảnh đại diện thành công!");
    } catch (err: any) {
      toast.error(err?.message || "Cập nhật ảnh đại diện thất bại.");
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveDisplayName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      toast.error("Tên hiển thị không được để trống.");
      return;
    }
    if (trimmed.length > 50) {
      toast.error("Tên hiển thị tối đa 50 ký tự.");
      return;
    }

    try {
      setIsSaving(true);
      await updateProfile({ displayName: trimmed });
      setEditingName(false);
      toast.success("Đã cập nhật tên hiển thị!");
    } catch (err: any) {
      toast.error(err?.message || "Cập nhật tên thất bại.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveHandle = async () => {
    const clean = normalizeHandle(handleInput);
    if (!isValidHandle(clean)) {
      toast.error("Handle từ 3-24 ký tự, chỉ chứa chữ thường (a-z), số (0-9), gạch dưới (_) và dấu chấm (.).");
      return;
    }

    try {
      setIsSaving(true);
      await updateProfile({ handle: clean });
      setEditingHandle(false);
      toast.success(`Đã đổi handle thành @${clean}!`);
    } catch (err: any) {
      toast.error(err?.message || "Cập nhật handle thất bại.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setIsSaving(true);
      await updateProfile({ avatarStorageKey: null });
      toast.success("Đã xóa ảnh đại diện");
    } catch (err: any) {
      toast.error(err?.message || "Không thể xóa ảnh đại diện.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleGhostMode = async () => {
    const target = isGhostMode ? "friends" : "none";
    try {
      await updateProfile({
        presenceVisibility: target,
        listeningVisibility: target,
      });
      if (target === "none") {
        toast.info("Đã bật Ghost Mode: Trạng thái và bài hát đang nghe được ẩn.");
      } else {
        toast.success("Đã tắt Ghost Mode: Trạng thái hiển thị lại với bạn bè.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Không thể thay đổi Ghost Mode.");
    }
  };

  const handleTogglePresence = async () => {
    const current = profile?.presenceVisibility || "friends";
    const next = current === "friends" ? "none" : "friends";
    try {
      await updateProfile({ presenceVisibility: next });
      toast.success(next === "friends" ? "Hiện diện: Hiển thị với bạn bè" : "Hiện diện: Đã ẩn");
    } catch (err: any) {
      toast.error(err?.message || "Không thể cập nhật quyền riêng tư hiện diện.");
    }
  };

  const handleToggleListening = async () => {
    const current = profile?.listeningVisibility || "friends";
    const next = current === "friends" ? "none" : "friends";
    try {
      await updateProfile({ listeningVisibility: next });
      toast.success(next === "friends" ? "Hoạt động nghe: Hiển thị với bạn bè" : "Hoạt động nghe: Đã ẩn");
    } catch (err: any) {
      toast.error(err?.message || "Không thể cập nhật quyền riêng tư hoạt động nghe.");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-32">
      {/* Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnappy}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/60 p-6 backdrop-blur-xl shadow-xl md:p-8"
      >
        <div className="flex flex-col items-center text-center">
          {/* Avatar with upload overlay */}
          <div className="relative group mb-4">
            <ProfileAvatar
              src={profile?.avatarUrl}
              name={displayName}
              handle={handle}
              size="xl"
              className="size-28 md:size-32 ring-4 ring-primary/20 shadow-lg"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              aria-label="Chọn ảnh đại diện mới"
              className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:pointer-events-none cursor-pointer"
            >
              {isUploadingAvatar ? (
                <Loader2 className="size-6 animate-spin text-primary" />
              ) : (
                <>
                  <Camera className="size-6" />
                  <span className="mt-1 text-[11px] font-medium">Đổi ảnh</span>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarFileSelect}
              className="hidden"
            />
          </div>

          {profile?.avatarStorageKey && (
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={isSaving || isUploadingAvatar}
              className="mb-3 text-xs text-muted-foreground/80 hover:text-destructive transition-colors cursor-pointer"
            >
              Gỡ ảnh đại diện
            </button>
          )}

          {/* Display Name Section */}
          <div className="w-full max-w-md">
            {editingName ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveDisplayName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  placeholder="Nhập tên hiển thị..."
                  maxLength={50}
                  className="w-full rounded-xl border border-primary/40 bg-background/80 px-3.5 py-2 text-center text-lg font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveDisplayName}
                  disabled={isSaving}
                  className="rounded-xl bg-primary p-2.5 text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  title="Lưu"
                >
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="rounded-xl bg-accent p-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Hủy"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 group">
                <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl truncate">
                  {displayName}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(displayName);
                    setEditingName(true);
                  }}
                  title="Sửa tên hiển thị"
                  className="rounded-lg p-1 text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground hover:bg-accent transition-all cursor-pointer"
                >
                  <Pencil className="size-4" />
                </button>
              </div>
            )}
          </div>

          {/* Handle Section */}
          <div className="mt-1 w-full max-w-md">
            {editingHandle ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">@</span>
                  <input
                    type="text"
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value.toLowerCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveHandle();
                      if (e.key === "Escape") setEditingHandle(false);
                    }}
                    placeholder="handle_moi"
                    maxLength={24}
                    className="w-full rounded-xl border border-primary/40 bg-background/80 py-2 pl-8 pr-3 text-center text-sm font-mono text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveHandle}
                  disabled={isSaving}
                  className="rounded-xl bg-primary p-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  title="Lưu"
                >
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingHandle(false)}
                  className="rounded-xl bg-accent p-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Hủy"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 mt-0.5">
                <span className="rounded-full bg-white/5 px-3 py-0.5 text-xs font-mono text-muted-foreground">
                  @{handle}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setHandleInput(handle);
                    setEditingHandle(true);
                  }}
                  title="Đổi handle"
                  className="rounded-lg p-1 text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground hover:bg-accent transition-all cursor-pointer"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Role Badge */}
          <div className="mt-3 flex items-center gap-2">
            {isOwner ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                <Shield className="size-3.5" />
                Owner Console
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary border border-primary/20">
                🦆 Member
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Friend Code Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSnappy, delay: 0.05 }}
        className="mt-6 rounded-3xl border border-white/10 bg-card/60 p-6 backdrop-blur-xl shadow-xl"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Mã bạn bè Duckroom</h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              Bạn bè có thể dùng mã này hoặc @handle của bạn để tìm và kết bạn.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 font-mono text-sm font-semibold tracking-wider text-primary select-all">
              {friendCode}
            </code>
            <motion.button
              type="button"
              whileTap={tapScale}
              onClick={handleCopyFriendCode}
              aria-label="Sao chép mã bạn bè"
              title="Sao chép mã bạn bè"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer",
                copiedCode
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {copiedCode ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span>{copiedCode ? "Đã chép" : "Sao chép"}</span>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Privacy Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSnappy, delay: 0.1 }}
        className="mt-6 rounded-3xl border border-white/10 bg-card/60 p-6 backdrop-blur-xl shadow-xl"
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Quyền riêng tư & Hoạt động</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kiểm soát thông tin trực tuyến và bài hát bạn đang nghe với bạn bè trên Duckroom.
          </p>
        </div>

        {/* Ghost Mode Toggle */}
        <div className="mb-4 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 transition-colors">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-purple-500/20 text-purple-400 shrink-0">
                <Ghost className="size-5" />
              </div>
              <div>
                <span className="text-sm font-semibold text-foreground block">Ghost Mode (Ẩn toàn bộ hoạt động)</span>
                <span className="text-xs text-muted-foreground leading-relaxed block mt-0.5">
                  Ẩn hoàn toàn trạng thái online và bài hát đang phát khỏi danh sách bạn bè.
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isGhostMode}
              onClick={handleToggleGhostMode}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                isGhostMode ? "bg-purple-600" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                  isGhostMode ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>

        {/* Independent Controls */}
        <div className="flex flex-col divide-y divide-white/5">
          {/* Presence visibility */}
          <div className="flex items-center justify-between py-3.5">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-card border border-white/5 text-muted-foreground shrink-0">
                {profile?.presenceVisibility === "friends" ? (
                  <Eye className="size-4 text-emerald-400" />
                ) : (
                  <EyeOff className="size-4 text-muted-foreground" />
                )}
              </div>
              <div>
                <span className="text-sm font-medium text-foreground block">Hiện diện trực tuyến</span>
                <span className="text-xs text-muted-foreground block">
                  {profile?.presenceVisibility === "friends"
                    ? "Hiển thị trạng thái Online với bạn bè"
                    : "Ẩn trạng thái trực tuyến"}
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={profile?.presenceVisibility === "friends"}
              disabled={isGhostMode}
              onClick={handleTogglePresence}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed",
                profile?.presenceVisibility === "friends" ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                  profile?.presenceVisibility === "friends" ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>

          {/* Listening activity visibility */}
          <div className="flex items-center justify-between py-3.5">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-card border border-white/5 text-muted-foreground shrink-0">
                {profile?.listeningVisibility === "friends" ? (
                  <Eye className="size-4 text-emerald-400" />
                ) : (
                  <EyeOff className="size-4 text-muted-foreground" />
                )}
              </div>
              <div>
                <span className="text-sm font-medium text-foreground block">Hoạt động nghe nhạc</span>
                <span className="text-xs text-muted-foreground block">
                  {profile?.listeningVisibility === "friends"
                    ? "Cho phép bạn bè thấy bài hát đang nghe"
                    : "Ẩn thông tin bài hát đang nghe"}
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={profile?.listeningVisibility === "friends"}
              disabled={isGhostMode}
              onClick={handleToggleListening}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed",
                profile?.listeningVisibility === "friends" ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                  profile?.listeningVisibility === "friends" ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Account / Session Management Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springSnappy, delay: 0.15 }}
        className="mt-6 rounded-3xl border border-white/10 bg-card/60 p-6 backdrop-blur-xl shadow-xl flex items-center justify-between"
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">Phiên đăng nhập</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Đăng xuất khỏi phiên hiện tại trên thiết bị này.</p>
        </div>
        <motion.button
          type="button"
          whileTap={tapScale}
          onClick={async () => {
            await signOut();
            toast.info("Đã đăng xuất tài khoản");
            void navigate({ to: "/" });
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
        >
          <LogOut className="size-4" />
          Đăng xuất
        </motion.button>
      </motion.div>
    </div>
  );
}
