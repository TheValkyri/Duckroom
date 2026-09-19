import { Link, useLocation } from "@tanstack/react-router";
import {
  BarChart3,
  CheckCircle2,
  Disc,
  Disc3,
  Film,
  Heart,
  Home,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  UploadCloud,
  User,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { springSnappy, tapScale } from "../lib/motion";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";
import { useSocialProfile } from "../lib/social";
import { ProfileAvatar } from "./social/ProfileAvatar";
import { FriendsSheet } from "./social/FriendsSheet";
import { SocialPresenceAdapter } from "./social/SocialPresenceAdapter";
import { cn } from "../lib/utils";
import { useScrollLock } from "../hooks/use-scroll-lock";
import { HotkeysOverlay } from "./HotkeysOverlay";
import { ThemePicker } from "./ThemePicker";
import { CommandPalette } from "./CommandPalette";
import { ensureThemeApplied } from "../lib/theme";
import { NowPlaying } from "./player/NowPlaying";
import { PlayerBar } from "./player/PlayerBar";
import { ModernDuckLogo, GlobalUploadBanner, UploadNavDot, MobileMoreSheet, NavigationProgressBar } from "./shell";

export { ModernDuckLogo } from "./shell";

// Perf fix 2026-08-25: thu/mở sidebar dùng CSS transition width thuần thay vì
// framer-motion. Animation JS (animate={{width}}) re-render + set style mỗi
// frame và tranh main thread với route change → giật. CSS transition không tốn
// thêm một render nào; main padding bên dưới đã dùng CÙNG duration + easing
// nên 2 bên vẫn khớp khung hình.
const SIDEBAR_WIDTH_EXPANDED = 256;
const SIDEBAR_WIDTH_COLLAPSED = 80;

const nav = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/friends", label: "Bạn bè", icon: Users },
  { to: "/library", label: "Thư viện", icon: ListMusic },
  { to: "/my-library", label: "Kho của tôi", icon: Heart },
  { to: "/stats", label: "Thống kê", icon: BarChart3 },
  { to: "/albums", label: "Albums", icon: Disc3 },
  { to: "/singles", label: "Đĩa đơn", icon: Disc },
  { to: "/videos", label: "MV", icon: Film },
  { to: "/upload", label: "Tải lên", icon: UploadCloud },
] as const;

/**
 * Bottom navigation (mobile <lg only — MOBILE_UI_ARCHITECTURE §2).
 * 4 destinations duy nhất; các nơi đến phụ (Albums/Đĩa đơn/Tải lên/
 * Owner Console) vào header + liên kết ngữ cảnh. Tab nào cũng đạt chuẩn
 * touch target 44px+ và aria-current. Active state là CSS thuần (không
 * layoutId) theo quy ước perf 2026-08-25.
 */
const bottomNav = [
  { to: "/", label: "Trang chủ", icon: Home, match: "exact" },
  { to: "/library", label: "Thư viện", icon: ListMusic, match: "prefix" },
  { to: "/my-library", label: "Kho của tôi", icon: Heart, match: "prefix" },
  { to: "/videos", label: "MV", icon: Film, match: "prefix" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isLoggedIn, signOut } = useAuth();
  const { isOwner } = useDuckroomRole();
  const { profile } = useSocialProfile();
  const displayName = profile?.displayName || user?.email?.split("@")[0] || "Thành viên";
  const handle = profile?.handle ? `@${profile.handle}` : null;
  const avatarUrl = profile?.avatarUrl || null;
  const visibleNav = useMemo(() => nav.filter((item) => item.to !== "/upload" || isOwner), [isOwner]);

  const isItemActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  };
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // QoL: khoá scroll nền khi More sheet mở.
  useScrollLock(moreOpen);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeOrigin, setThemeOrigin] = useState<{ x: number; y: number } | null>(null);
  // F4: Command Palette — Ctrl+K (desktop) / nút 🔍 (mobile header).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

  // Ctrl+K / Cmd+K — mở palette từ bất kỳ đâu (không đụng input đang gõ:
  // browser default của Ctrl+K là search bar — preventDefault chiếm lại).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Belt-and-suspenders: đảm bảo inline vars khớp store sau khi hydrate
  // (init-script đã chạy trước trong <head>; gọi lại 1 lần vô hại).
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "true");
    ensureThemeApplied();
  }, []);

  // Tab "Xem thêm" active khi đang ở 1 trong các đích phụ của More sheet.
  const isMoreActive =
    location.pathname.startsWith("/friends") ||
    location.pathname.startsWith("/albums") ||
    location.pathname.startsWith("/singles") ||
    location.pathname.startsWith("/stats") ||
    location.pathname === "/upload" ||
    location.pathname === "/admin";

  return (
    <div className="bg-background min-h-screen" suppressHydrationWarning>
      {/* Top navigation micro-progress bar — instant feedback for all route transitions */}
      <NavigationProgressBar />

      {/* Floating Global Upload Notification Banner — isolated subscriber */}
      <GlobalUploadBanner />

      {/* Desktop Collapsible Sidebar — redesign 2026-09-04: bỏ border-r
          (feedback "hạn chế kẻ dọc"), tách khỏi nội dung bằng bóng mềm; vẫn
          giữ transition width CSS thuần (perf 2026-08-25). */}
      <aside
        style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
        className="bg-sidebar/95 edge-shadow-r fixed inset-y-0 left-0 z-30 hidden flex-col px-3 py-6 lg:flex overflow-hidden select-none transition-[width] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="flex items-center justify-between px-2 mb-8">
          <Link to="/" className="flex items-center gap-3 overflow-hidden">
            <ModernDuckLogo className="size-8 shrink-0" />
            {!collapsed && (
              <span className="font-display text-2xl tracking-tight whitespace-nowrap">
                <span className="text-primary">Duck</span>
                <span className="text-foreground">room</span>
              </span>
            )}
          </Link>
          <motion.button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Mở rộng Sidebar" : "Thu gọn Sidebar"}
            whileTap={tapScale}
            whileHover={{ scale: 1.08 }}
            transition={springSnappy}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent/60 transition-colors cursor-pointer shrink-0"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </motion.button>
        </div>

        <nav className="flex flex-col gap-1.5 relative">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Tìm nhanh trong Duckroom"
            title={collapsed ? "Tìm nhanh (Ctrl K)" : undefined}
            className="flex items-center gap-3.5 rounded-xl px-3 h-11 text-sm font-medium border border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer transition-colors select-none"
          >
            <Search className="size-5 shrink-0 text-primary/70 pointer-events-none" />
            {!collapsed && (
              <span className="flex items-center justify-between flex-1 pointer-events-none">
                <span>Tìm kiếm</span>
                <kbd className="text-[10px] font-mono border border-border/70 px-1.5 py-0.5 rounded text-muted-foreground/80">
                  Ctrl K
                </kbd>
              </span>
            )}
          </button>
          {visibleNav.map(({ to, label, icon: Icon }) => {
            const isActive = isItemActive(to);
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                preloadDelay={80}
                activeOptions={{ exact: to === "/" }}
                title={collapsed ? label : undefined}
                className={cn(
                  // Fixed 44px height (h-11) + pointer-events-none on content prevents
                  // layout shifts or bounding box flutter during hover/transitions.
                  "flex items-center gap-3.5 rounded-xl px-3 h-11 text-sm font-medium transition-colors duration-150 relative group cursor-pointer select-none touch-manipulation active:scale-[0.98]",
                  isActive
                    ? "bg-accent/80 border border-white/10 shadow-sm text-foreground font-semibold"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 active:bg-accent/60",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0 z-10 pointer-events-none transition-transform duration-150 group-hover:scale-110",
                    isActive ? "text-primary font-bold" : "text-primary/70",
                  )}
                />
                {!collapsed && <span className="whitespace-nowrap truncate z-10 pointer-events-none">{label}</span>}
                {to === "/upload" && <UploadNavDot />}
              </Link>
            );
          })}

          {isOwner && (
            <Link
              to="/admin"
              preload="intent"
              preloadDelay={80}
              title={collapsed ? "Owner Console" : undefined}
              className={cn(
                "flex items-center gap-3.5 rounded-xl px-3 h-11 text-sm font-medium transition-colors duration-150 relative group cursor-pointer select-none touch-manipulation active:scale-[0.98] mt-1",
                location.pathname === "/admin"
                  ? "bg-accent/80 border border-white/10 shadow-sm text-foreground font-semibold"
                  : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 active:bg-accent/60",
              )}
            >
              <ShieldCheck
                className={cn(
                  "size-5 shrink-0 z-10 pointer-events-none transition-transform duration-150 group-hover:scale-110",
                  location.pathname === "/admin" ? "text-emerald-400 font-bold" : "text-emerald-400/70",
                )}
              />
              {!collapsed && <span className="whitespace-nowrap truncate z-10 pointer-events-none">Owner Console</span>}
            </Link>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          {/* Theme — desktop parity với mobile header (feedback: máy tính
              không có nút chuyển theme). Collapsed → chỉ icon + tooltip. */}
          <motion.button
            type="button"
            whileTap={tapScale}
            transition={springSnappy}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setThemeOrigin({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
              setThemeOpen(true);
            }}
            aria-label="Tùy chỉnh giao diện"
            title="Tùy chỉnh giao diện"
            className="text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer"
          >
            <Palette className="size-5 shrink-0 text-primary" />
            {!collapsed && <span className="whitespace-nowrap truncate">Giao diện</span>}
          </motion.button>
          {isLoggedIn ? (
            <div className="flex flex-col gap-1">
              {!collapsed ? (
                <div className="px-3 py-2.5 rounded-xl bg-card/60 border border-white/5 flex items-center justify-between gap-2 hover:bg-card/80 transition-colors group">
                  <Link
                    to="/profile"
                    className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                    title="Xem hồ sơ cá nhân"
                  >
                    <ProfileAvatar
                      src={avatarUrl}
                      name={displayName}
                      handle={handle}
                      size="sm"
                      className="size-8 group-hover:ring-2 group-hover:ring-primary/40 transition-all"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-foreground font-semibold truncate block group-hover:text-primary transition-colors">
                        {displayName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {handle && <span className="text-[11px] text-muted-foreground truncate block">{handle}</span>}
                        {isOwner && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wider font-bold">
                            Owner
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => signOut()}
                    title="Đăng xuất"
                    aria-label="Đăng xuất"
                    className="text-muted-foreground hover:text-destructive p-1.5 rounded-lg hover:bg-accent transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <Link
                    to="/profile"
                    title={`Hồ sơ (${displayName}${handle ? ` · ${handle}` : ""})`}
                    className="p-1 rounded-xl hover:bg-accent/60 transition-colors cursor-pointer"
                  >
                    <ProfileAvatar src={avatarUrl} name={displayName} handle={handle} size="sm" />
                  </Link>
                  <button
                    onClick={() => signOut()}
                    title={`Đăng xuất (${displayName})`}
                    aria-label="Đăng xuất"
                    className="text-muted-foreground hover:text-destructive flex items-center justify-center p-2 rounded-xl hover:bg-accent/60 transition-colors cursor-pointer"
                  >
                    <LogOut className="size-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              title={collapsed ? "Đăng nhập" : undefined}
              className="text-muted-foreground hover:bg-primary/20 hover:text-primary flex items-center gap-3.5 rounded-xl px-3 py-3 text-sm font-medium transition-all border border-transparent hover:border-primary/30"
              activeProps={{ className: "text-primary font-semibold bg-primary/20 shadow-sm border-primary/30" }}
            >
              <LogIn className="size-5 shrink-0 text-primary" />
              {!collapsed && <span className="whitespace-nowrap truncate">Đăng nhập</span>}
            </Link>
          )}

          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-3 py-3 rounded-xl bg-card/40 border border-white/5 text-[11px] leading-relaxed text-muted-foreground"
            >
              <p className="font-semibold text-foreground mb-0.5 flex items-center gap-1.5">
                <span>🦆 Duckroom Master</span>
              </p>
              Phát bản thu gốc Hi-Res 24-bit / 96kHz không nén.
            </motion.div>
          )}
        </div>
      </aside>

      {/* Mobile Top Header (compact — nav lives in the bottom dock).
          Redesign 2026-09-04 (feedback "hạn chế kẻ ngang/dọc, đồng bộ
          bề mặt"): bỏ border-b — bề mặt glass tách khỏi nội dung bằng
          bóng đổ mềm theo token (đã có sẵn), không còn đường kẻ cứng. */}
      <nav
        aria-label="Thanh trên"
        className="glass edge-shadow-b pt-safe fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between px-4 lg:hidden"
      >
        <Link to="/" className="flex items-center gap-2" aria-label="Duckroom — Trang chủ">
          <ModernDuckLogo className="size-7" />
          <span className="font-display text-xl">
            <span className="text-primary">Duck</span>room
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {/* F4: Palette trên mobile — Ctrl+K không tồn tại trên phone nên
              đây là cửa vào chính (44px, cùng modal như desktop). */}
          <motion.button
            type="button"
            whileTap={tapScale}
            transition={springSnappy}
            onClick={() => setPaletteOpen(true)}
            aria-label="Tìm nhanh trong Duckroom"
            title="Tìm nhanh (Ctrl K)"
            className="text-muted-foreground hover:text-primary grid size-11 place-items-center rounded-full transition-colors hover:bg-accent/50 cursor-pointer"
          >
            <Search className="size-5" />
          </motion.button>
          <motion.button
            type="button"
            whileTap={tapScale}
            transition={springSnappy}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setThemeOrigin({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
              setThemeOpen(true);
            }}
            aria-label="Tùy chỉnh giao diện"
            title="Tùy chỉnh giao diện"
            className="text-muted-foreground hover:text-primary grid size-11 place-items-center rounded-full transition-colors hover:bg-accent/50 cursor-pointer"
          >
            <Palette className="size-5" />
          </motion.button>
          {isOwner && (
            <>
              <Link
                to="/upload"
                aria-label="Trung tâm Tiếp nhận"
                title="Trung tâm Tiếp nhận"
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors",
                  location.pathname === "/upload"
                    ? "bg-accent text-primary"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <UploadCloud className="size-5" />
              </Link>
              <Link
                to="/admin"
                aria-label="Owner Console"
                title="Owner Console"
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors",
                  location.pathname === "/admin"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-emerald-400/70 hover:bg-emerald-500/10 hover:text-emerald-400",
                )}
              >
                <ShieldCheck className="size-5" />
              </Link>
            </>
          )}
          {isLoggedIn ? (
            <>
              <motion.button
                type="button"
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => setFriendsOpen(true)}
                aria-label="Bạn bè"
                title="Bạn bè"
                className={cn(
                  "text-muted-foreground hover:text-primary grid size-11 place-items-center rounded-full transition-colors hover:bg-accent/50 cursor-pointer",
                  friendsOpen && "bg-accent text-primary",
                )}
              >
                <Users className="size-5" />
              </motion.button>
              <Link
                to="/profile"
                aria-label={`Hồ sơ cá nhân (${displayName})`}
                title="Hồ sơ cá nhân"
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors hover:bg-accent/50 cursor-pointer",
                  location.pathname === "/profile" && "bg-accent text-primary ring-2 ring-primary/40",
                )}
              >
                <ProfileAvatar
                  src={avatarUrl}
                  name={displayName}
                  handle={handle}
                  size="sm"
                  className="size-7 border border-white/15"
                />
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="bg-primary/20 text-primary rounded-full px-4 text-xs whitespace-nowrap py-2.5 font-medium"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>

      {/* Mobile Bottom Navigation Dock — dính mép dưới màn hình, padding
          trong nav chịu safe-area (pb-safe) để tránh gesture bar; bản thân
          nav KHÔNG bị nâng lên (bottom:0), nếu không sẽ hở khe thấy content
          chạy phía dưới.
          Redesign 2026-09-01 (feedback "thiếu Đĩa đơn"): 5 mục — 4 đích
          chính + 1 nút "Xem thêm" (⋯) mở LIBRARY SHEET kéo-lên chứa
          Albums / Đĩa đơn / Tải lên (owner) / Owner Console — đúng pattern
          "primary destinations + sheet cho secondary", cùng ngôn ngữ với
          QueueSheet/TrackActionsSheet. */}
      <nav
        aria-label="Điều hướng chính"
        className="glass edge-shadow-t fixed inset-x-0 bottom-0 z-30 pb-safe lg:hidden"
      >
        <div className="grid grid-cols-5">
          {bottomNav.map(({ to, label, icon: Icon, match }) => {
            const isActive = match === "exact" ? location.pathname === "/" : isItemActive(to);
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                preloadDelay={80}
                activeOptions={{ exact: match === "exact" }}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 select-none transition-colors cursor-pointer touch-manipulation active:scale-95",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground active:text-primary",
                )}
              >
                <span className="relative pointer-events-none">
                  <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                  {isActive && (
                    <span className="bg-primary absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[10px] leading-none pointer-events-none",
                    isActive ? "font-semibold" : "font-medium",
                  )}
                >
                  {label}
                </span>
              </Link>
            );
          })}
          {/* Nút "Xem thêm" — mở MoreSheet (Albums/Đĩa đơn/owner tools) */}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Xem thêm mục"
            aria-expanded={moreOpen}
            className={cn(
              "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 select-none transition-colors cursor-pointer touch-manipulation",
              isMoreActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative pointer-events-none">
              <MoreHorizontal className="size-5" strokeWidth={isMoreActive ? 2.4 : 2} />
              {isMoreActive && (
                <span className="bg-primary absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" />
              )}
            </span>
            <span
              className={cn(
                "text-[10px] leading-none pointer-events-none",
                isMoreActive ? "font-semibold" : "font-medium",
              )}
            >
              Xem thêm
            </span>
          </button>
        </div>
      </nav>

      {/* More Sheet — các đích phụ của bottom nav (kéo lên, đóng bằng kéo
          xuống/nút) — extracted into MobileMoreSheet */}
      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} isOwner={isOwner} />

      {/* Main Content Area
          Mobile: pt-14 (top header) + đủ khoảng trống cho bottom dock
          (bottom nav 56px + mini-player ~64px) + safe-area; Desktop giữ
          nguyên padding-sidebar (chỉ đổi bên dưới lg). */}
      {/* PERF 2026-09-01: bỏ motion-wrapper pageVariants. Trước đây MỌI
          route change remount TOÀN BỘ cây trang (key={pathname} trên node
          motion) và replay animation nhập — stagger 76-row library, hero
          images... — chính là cảm giác "lag" khi navigate: mỗi lần chuyển
          tab trả lại chi phí mount + animate từ đầu, trong khi người dùng
          chỉ muốn thấy nội dung ngay. Giờ:
          - div key={pathname} KHÔNG remount con của route (router render
            root của route mới vào main — chi phí như một tab switch bình
            thường, không có hiệu ứng chạy lại toàn trang).
          - Fade nhẹ 140ms bằng CSS THUẦN (.page-fade, chỉ ≥lg): phone cần
            tốc độ → không animation chặn; desktop được 1 tín hiệu chuyển
            trang tinh tế. transform/opacity = GPU, 0 JS mỗi frame. */}
      <main
        className={cn(
          "overflow-x-hidden min-h-screen transition-[padding] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          "pt-[calc(3.5rem+var(--safe-top))] pb-[calc(9.75rem+var(--safe-bottom))] lg:pt-0 lg:pb-32",
          collapsed ? "lg:pl-20" : "lg:pl-64",
        )}
      >
        <div key={location.pathname} className="page-fade w-full">
          {children}
        </div>
      </main>
      <PlayerBar />
      <NowPlaying />
      {/* QoL A5: phím tắt overlay — Shift+/ (hay "?") trên desktop. */}
      <HotkeysOverlay />
      <AnimatePresence>
        {themeOpen && <ThemePicker open={themeOpen} onClose={() => setThemeOpen(false)} triggerOrigin={themeOrigin} />}
      </AnimatePresence>
      {/* F4: Command Palette — Ctrl+K desktop, nút 🔍 mobile header. */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* Mobile Friends Sheet (§4, §23) */}
      <FriendsSheet open={friendsOpen} onClose={() => setFriendsOpen(false)} />
      {/* Social presence & multi-tab adapter (§27, §28) */}
      <SocialPresenceAdapter />
    </div>
  );
}
