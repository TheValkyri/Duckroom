import { Link, useLocation } from "@tanstack/react-router";
import {
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
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  UploadCloud,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { pageVariants, springSnappy, tapScale } from "../lib/motion";
import { getIngestionStoreState, subscribeIngestionStore, type IngestionStoreState } from "../lib/upload-store";
import { useAuth } from "../lib/useAuth";
import { useDuckroomRole } from "../lib/useRole";
import { cn } from "../lib/utils";
import { useScrollLock } from "../hooks/use-scroll-lock";
import { NowPlaying } from "./player/NowPlaying";
import { PlayerBar } from "./player/PlayerBar";

// Perf fix 2026-08-25: thu/mở sidebar dùng CSS transition width thuần thay vì
// framer-motion. Animation JS (animate={{width}}) re-render + set style mỗi
// frame và tranh main thread với route change → giật. CSS transition không tốn
// thêm một render nào; main padding bên dưới đã dùng CÙNG duration + easing
// nên 2 bên vẫn khớp khung hình.
const SIDEBAR_WIDTH_EXPANDED = 256;
const SIDEBAR_WIDTH_COLLAPSED = 80;

const nav = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/library", label: "Thư viện", icon: ListMusic },
  { to: "/my-library", label: "Kho của tôi", icon: Heart },
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

export function ModernDuckLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      {/* Duck Beak */}
      <path d="M26 18C29 18 34 19.5 35 22C33.5 24.5 28 24 26 23.5V18Z" fill="url(#duck-beak-grad)" />
      {/* Duck Head & Neck */}
      <path
        d="M12 28C12 20 16 12 23 12C26.5 12 28.5 14.5 28.5 18C28.5 23 23 25 21 28C19.5 30 16 32 12 28Z"
        fill="currentColor"
        className="text-foreground"
      />
      {/* DJ Headphone Band */}
      <path d="M13 8C18 5 27 5 31 10" stroke="var(--primary)" strokeWidth="3.5" strokeLinecap="round" />
      {/* DJ Ear Cup */}
      <rect x="9" y="13" width="6" height="10" rx="3" fill="var(--primary)" />
      {/* Duck Eye */}
      <circle cx="21" cy="16" r="2" fill="var(--background)" />
      {/* Gradients */}
      <defs>
        <linearGradient id="duck-beak-grad" x1="26" y1="18" x2="35" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.75 0.22 55)" />
          <stop offset="1" stopColor="oklch(0.65 0.2 40)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isLoggedIn, signOut } = useAuth();
  const { isOwner } = useDuckroomRole();
  const visibleNav = nav.filter((item) => item.to !== "/upload" || isOwner);
  const [ingestionState, setIngestionState] = useState<IngestionStoreState>(getIngestionStoreState());
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // QoL: khoá scroll nền khi More sheet mở.
  useScrollLock(moreOpen);

  useEffect(() => {
    return subscribeIngestionStore(setIngestionState);
  }, []);

  const activeIngestion = ingestionState.items.find(
    (i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing",
  );

  // Tab "Xem thêm" active khi đang ở 1 trong các đích phụ của More sheet.
  const isMoreActive =
    location.pathname.startsWith("/albums") ||
    location.pathname.startsWith("/singles") ||
    location.pathname === "/upload" ||
    location.pathname === "/admin";

  return (
    <div className="bg-background min-h-screen" suppressHydrationWarning>
      {/* Floating Global Upload Notification Banner */}
      <AnimatePresence>
        {activeIngestion && location.pathname !== "/upload" && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-card/95 border border-primary/40 text-foreground px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-sm mt-[var(--safe-top)]"
          >
            <Loader2 className="size-5 animate-spin text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs font-semibold mb-1">
                <span className="truncate">{activeIngestion.metadata.title || activeIngestion.file.name}</span>
                <span className="text-primary tabular-nums">{activeIngestion.progressPercent}%</span>
              </div>
              <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300 rounded-full"
                  style={{ width: `${activeIngestion.progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{activeIngestion.progressText}</p>
            </div>
            <Link
              to="/upload"
              className="text-xs bg-primary/20 text-primary hover:bg-primary/30 px-2.5 py-1 rounded-full font-medium transition-colors shrink-0"
            >
              Xem
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Animated Collapsible Sidebar */}
      <aside
        style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
        className="border-border bg-sidebar/95 backdrop-blur-xl fixed inset-y-0 left-0 z-30 hidden flex-col border-r px-3 py-6 lg:flex overflow-hidden select-none transition-[width] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
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
          {visibleNav.map(({ to, label, icon: Icon }) => {
            const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                activeOptions={{ exact: to === "/" }}
                title={collapsed ? label : undefined}
                className={cn(
                  // Perf fix 2026-08-25: bỏ layoutId flying-pill (bắt buộc đo
                  // layout + animate chéo cây mỗi route change = khựng). Active
                  // state giờ là CSS thuần — vẫn mượt, chi phí gần bằng 0.
                  "flex items-center gap-3.5 rounded-xl px-3 py-3 text-sm font-medium transition-colors duration-200 relative group cursor-pointer",
                  isActive
                    ? "bg-accent/80 border border-white/10 shadow-sm text-foreground font-semibold"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0 z-10 transition-transform duration-200 group-hover:scale-110",
                    isActive ? "text-primary font-bold" : "text-primary/70",
                  )}
                />
                {!collapsed && <span className="whitespace-nowrap truncate z-10">{label}</span>}
                {to === "/upload" && Boolean(activeIngestion) && (
                  <span className="ml-auto size-2 rounded-full bg-primary animate-pulse shrink-0 z-10" />
                )}
              </Link>
            );
          })}

          {isOwner && (
            <Link
              to="/admin"
              title={collapsed ? "Owner Console" : undefined}
              className={cn(
                // CSS active state thuần — đồng bộ với các nav item khác, không
                // đo layout (layoutId) mỗi route change.
                "flex items-center gap-3.5 rounded-xl px-3 py-3 text-sm font-medium transition-colors duration-200 relative group cursor-pointer mt-1",
                location.pathname === "/admin"
                  ? "bg-accent/80 border border-white/10 shadow-sm text-foreground font-semibold"
                  : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              <ShieldCheck
                className={cn(
                  "size-5 shrink-0 z-10 transition-transform group-hover:scale-110",
                  location.pathname === "/admin" ? "text-emerald-400 font-bold" : "text-emerald-400/70",
                )}
              />
              {!collapsed && <span className="whitespace-nowrap truncate z-10">Owner Console</span>}
            </Link>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          {isLoggedIn ? (
            <div className="flex flex-col gap-1">
              {!collapsed ? (
                <div className="px-3 py-2.5 rounded-xl bg-card/60 border border-white/5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="size-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs text-foreground font-medium truncate block">
                        {user?.email || "Thành viên"}
                      </span>
                      {isOwner && (
                        <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold">
                          Owner
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => signOut()}
                    title="Đăng xuất"
                    className="text-muted-foreground hover:text-destructive p-1 rounded-lg hover:bg-accent transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => signOut()}
                  title={`Đăng xuất (${user?.email || ""})`}
                  className="text-muted-foreground hover:text-destructive flex items-center justify-center p-3 rounded-xl hover:bg-accent/60 transition-colors cursor-pointer"
                >
                  <LogOut className="size-5" />
                </button>
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

      {/* Mobile Top Header (compact — nav lives in the bottom dock) */}
      <nav
        aria-label="Thanh trên"
        className="glass border-border pt-safe fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b px-4 lg:hidden"
      >
        <Link to="/" className="flex items-center gap-2" aria-label="Duckroom — Trang chủ">
          <ModernDuckLogo className="size-7" />
          <span className="font-display text-xl">
            <span className="text-primary">Duck</span>room
          </span>
        </Link>
        <div className="flex items-center gap-1">
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
            <button
              onClick={() => signOut()}
              aria-label={`Đăng xuất (${user?.email || "tài khoản"})`}
              title="Đăng xuất"
              className="text-muted-foreground hover:text-destructive grid size-11 place-items-center rounded-full transition-colors hover:bg-accent/50 cursor-pointer"
            >
              <LogOut className="size-5" />
            </button>
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
        className="glass border-border fixed inset-x-0 bottom-0 z-30 border-t pb-safe lg:hidden"
      >
        <div className="grid grid-cols-5">
          {bottomNav.map(({ to, label, icon: Icon, match }) => {
            const isActive = match === "exact" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                activeOptions={{ exact: match === "exact" }}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 select-none transition-colors cursor-pointer",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                  {isActive && (
                    <span className="bg-primary absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" />
                  )}
                </span>
                <span className={cn("text-[10px] leading-none", isActive ? "font-semibold" : "font-medium")}>
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
              "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 select-none transition-colors cursor-pointer",
              isMoreActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">
              <MoreHorizontal className="size-5" strokeWidth={isMoreActive ? 2.4 : 2} />
              {isMoreActive && (
                <span className="bg-primary absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" />
              )}
            </span>
            <span className={cn("text-[10px] leading-none", isMoreActive ? "font-semibold" : "font-medium")}>
              Xem thêm
            </span>
          </button>
        </div>
      </nav>

      {/* More Sheet — các đích phụ của bottom nav (kéo lên, đóng bằng kéo
          xuống/nút) — same pattern QueueSheet. */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || (info.velocity.y > 600 && info.offset.y > 24)) setMoreOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Xem thêm mục điều hướng"
            className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[28px] border-t border-white/10 bg-card/95 backdrop-blur-md pb-safe lg:hidden"
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing" aria-hidden>
              <div className="h-1.5 w-10 rounded-full bg-white/25" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1.5 pb-2">
              <h2 className="font-display text-lg font-semibold">Khám phá</h2>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Đóng bảng xem thêm"
                className="text-muted-foreground hover:text-foreground hover:bg-white/10 grid size-11 place-items-center rounded-full transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {[
                { to: "/albums", label: "Albums", icon: Disc3, desc: "Bộ sưu tập đĩa" },
                { to: "/singles", label: "Đĩa đơn", icon: Disc, desc: "Single & EP" },
                ...(isOwner
                  ? [
                      { to: "/upload", label: "Tải lên", icon: UploadCloud, desc: "Trung tâm tiếp nhận" },
                      { to: "/admin", label: "Owner Console", icon: ShieldCheck, desc: "Quản trị hệ thống" },
                    ]
                  : []),
              ].map(({ to, label, icon: Icon, desc }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className="border-border bg-background/50 flex min-h-20 flex-col items-start justify-center gap-1 rounded-2xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
                >
                  <Icon className="text-primary size-5" />
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-muted-foreground text-xs">{desc}</span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] bg-black/50 lg:hidden"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
        )}
      </AnimatePresence>

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
    </div>
  );
}
