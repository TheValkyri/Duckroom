import { Link, useLocation } from "@tanstack/react-router";
import {
  CheckCircle2,
  Disc3,
  Film,
  Home,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UploadCloud,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { getUploadState, subscribeUploadState, updateUploadState, type UploadState } from "../lib/upload-store";
import { useAuth } from "../lib/useAuth";
import { NowPlaying } from "./player/NowPlaying";
import { PlayerBar } from "./player/PlayerBar";

const nav = [
  { to: "/", label: "Trang chủ", icon: Home },
  { to: "/library", label: "Thư viện", icon: ListMusic },
  { to: "/albums", label: "Albums", icon: Disc3 },
  { to: "/videos", label: "MV", icon: Film },
  { to: "/upload", label: "Tải lên", icon: UploadCloud },
] as const;

export function ModernDuckLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className}>
      {/* Duck Beak */}
      <path
        d="M26 18C29 18 34 19.5 35 22C33.5 24.5 28 24 26 23.5V18Z"
        fill="url(#duck-beak-grad)"
      />
      {/* Duck Head & Neck */}
      <path
        d="M12 28C12 20 16 12 23 12C26.5 12 28.5 14.5 28.5 18C28.5 23 23 25 21 28C19.5 30 16 32 12 28Z"
        fill="currentColor"
        className="text-foreground"
      />
      {/* DJ Headphone Band */}
      <path
        d="M13 8C18 5 27 5 31 10"
        stroke="var(--primary)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* DJ Ear Cup */}
      <rect
        x="9"
        y="13"
        width="6"
        height="10"
        rx="3"
        fill="var(--primary)"
      />
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
  const [uploadState, setUploadState] = useState<UploadState>(getUploadState());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    return subscribeUploadState(setUploadState);
  }, []);

  return (
    <div className="bg-background min-h-screen">
      {/* Floating Global Upload Notification Banner */}
      <AnimatePresence>
        {(uploadState.isUploading || (uploadState.successMessage && location.pathname !== "/upload")) && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-card/95 border border-primary/40 text-foreground px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-sm"
          >
            {uploadState.isUploading ? (
              <>
                <Loader2 className="size-5 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs font-semibold mb-1">
                    <span className="truncate">{uploadState.fileName || "Tệp tin"}</span>
                    <span className="text-primary tabular-nums">{uploadState.percent}%</span>
                  </div>
                  <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300 rounded-full"
                      style={{ width: `${uploadState.percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">{uploadState.progressText}</p>
                </div>
                <Link
                  to="/upload"
                  className="text-xs bg-primary/20 text-primary hover:bg-primary/30 px-2.5 py-1 rounded-full font-medium transition-colors shrink-0"
                >
                  Xem
                </Link>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-emerald-300 truncate">{uploadState.successMessage}</p>
                </div>
                <button
                  onClick={() => updateUploadState({ successMessage: "" })}
                  className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Animated Collapsible Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 80 : 256 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="border-border bg-sidebar/95 backdrop-blur-xl fixed inset-y-0 left-0 z-30 hidden flex-col border-r px-3 py-6 lg:flex overflow-hidden select-none"
      >
        <div className="flex items-center justify-between px-2 mb-8">
          <Link to="/" className="flex items-center gap-3 overflow-hidden">
            <ModernDuckLogo className="size-8 shrink-0" />
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-display text-2xl tracking-tight whitespace-nowrap"
              >
                <span className="text-primary">Duck</span>
                <span className="text-foreground">room</span>
              </motion.span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Mở rộng Sidebar" : "Thu gọn Sidebar"}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent/60 transition-colors cursor-pointer shrink-0"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>

        <nav className="flex flex-col gap-1.5">
          {nav.map(({ to, label, icon: Icon }) => {
            return (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                title={collapsed ? label : undefined}
                className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex items-center gap-3.5 rounded-xl px-3 py-3 text-sm font-medium transition-all relative group"
                activeProps={{ className: "text-foreground font-semibold bg-accent/80 shadow-sm" }}
              >
                <Icon className="size-5 shrink-0 group-hover:scale-110 transition-transform text-primary/80 group-hover:text-primary" />
                {!collapsed && <span className="whitespace-nowrap truncate">{label}</span>}
                {to === "/upload" && uploadState.isUploading && (
                  <span className="ml-auto size-2 rounded-full bg-primary animate-pulse shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          {isLoggedIn ? (
            <div className="flex flex-col gap-1">
              {!collapsed ? (
                <div className="px-3 py-2.5 rounded-xl bg-card/60 border border-white/5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="size-4 text-primary shrink-0" />
                    <span className="text-xs text-foreground font-medium truncate">
                      {user?.email || "Thành viên"}
                    </span>
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
      </motion.aside>

      {/* Mobile Top Navigation */}
      <nav className="glass border-border fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b px-4 py-2.5 lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <ModernDuckLogo className="size-7" />
          <span className="font-display text-xl">
            <span className="text-primary">Duck</span>room
          </span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {nav.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="text-muted-foreground rounded-full px-3 py-1 text-xs whitespace-nowrap"
              activeProps={{ className: "bg-accent text-foreground font-medium" }}
            >
              {label}
            </Link>
          ))}
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
      <motion.main
        animate={{ paddingLeft: collapsed ? 80 : 256 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="pt-14 pb-32 lg:pt-0 overflow-x-hidden"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </motion.main>
      <PlayerBar />
      <NowPlaying />
    </div>
  );
}