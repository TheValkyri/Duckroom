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

  useEffect(() => {
    return subscribeIngestionStore(setIngestionState);
  }, []);

  const activeIngestion = ingestionState.items.find(
    (i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing",
  );

  return (
    <div className="bg-background min-h-screen" suppressHydrationWarning>
      {/* Floating Global Upload Notification Banner */}
      <AnimatePresence>
        {activeIngestion && location.pathname !== "/upload" && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-card/95 border border-primary/40 text-foreground px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-sm"
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

      {/* Mobile Top Navigation */}
      <nav className="glass border-border fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b px-4 py-2.5 lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <ModernDuckLogo className="size-7" />
          <span className="font-display text-xl">
            <span className="text-primary">Duck</span>room
          </span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {visibleNav.map(({ to, label }) => {
            const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                preload="intent"
                activeOptions={{ exact: to === "/" }}
                className={cn(
                  "relative rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
                  isActive ? "text-foreground font-medium bg-accent" : "text-muted-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
          {isOwner && (
            <Link
              to="/admin"
              className={cn(
                "relative rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
                location.pathname === "/admin"
                  ? "text-emerald-400 font-medium bg-emerald-500/10"
                  : "text-muted-foreground",
              )}
            >
              Admin
            </Link>
          )}
          {isLoggedIn ? (
            <button
              onClick={() => signOut()}
              title="Đăng xuất"
              className="text-muted-foreground hover:text-destructive px-2 py-1 rounded-full text-xs cursor-pointer flex items-center gap-1"
            >
              <LogOut className="size-3.5" />
            </button>
          ) : (
            <Link
              to="/login"
              className="bg-primary/20 text-primary rounded-full px-3 py-1 text-xs whitespace-nowrap font-medium"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <main
        className={cn(
          "pt-14 pb-32 lg:pt-0 overflow-x-hidden min-h-screen transition-[padding] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "lg:pl-20" : "lg:pl-64",
        )}
      >
        <motion.div
          key={location.pathname}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          className="w-full"
        >
          {children}
        </motion.div>
      </main>
      <PlayerBar />
      <NowPlaying />
    </div>
  );
}
