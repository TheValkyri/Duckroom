import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Loader2, Lock, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, useEffect } from "react";
import { ModernDuckLogo } from "../components/AppShell";
import { springSmooth, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { supabase } from "../lib/supabase-client";
import { useAuth } from "../lib/useAuth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Duckroom" },
      { name: "description", content: "Đăng nhập tài khoản Duckroom để quản lý kho nhạc cá nhân." },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Đăng nhập — Duckroom" },
      { property: "og:description", content: "Đăng nhập tài khoản Duckroom để quản lý kho nhạc cá nhân." },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isAuthLoading && isLoggedIn) {
      void navigate({ to: "/my-library" });
    }
  }, [isAuthLoading, isLoggedIn, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg("Vui lòng nhập đầy đủ Email và Mật khẩu.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(
          error.message === "Invalid login credentials"
            ? "Email hoặc mật khẩu không chính xác."
            : error.message || "Đăng nhập thất bại. Vui lòng kiểm tra lại tài khoản.",
        );
        setIsSubmitting(false);
        return;
      }

      if (data.session) {
        void navigate({ to: "/my-library" });
      }
    } catch {
      setErrorMsg("Không thể kết nối đến dịch vụ xác thực.");
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const redirectOrigin = typeof window !== "undefined" ? window.location.origin : "";
      await supabase.auth.signInWithOAuth({
        provider: "google",
        ...(redirectOrigin ? { options: { redirectTo: `${redirectOrigin}/my-library` } } : {}),
      });
    } catch (err) {
      console.warn("Google login failed", err);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16 flex flex-col items-center justify-center min-h-[75vh]">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSmooth}
        className="w-full bg-card/60 border border-border rounded-3xl p-8 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex flex-col items-center mb-6 text-center">
          <ModernDuckLogo className="size-12 mb-3 text-primary" />
          <h1 className="font-display text-2xl tracking-tight">
            Đăng nhập <span className="text-primary">Duck</span>room
          </h1>
          <p className="text-muted-foreground text-xs mt-1.5 leading-relaxed">
            Kho nhạc Lossless cá nhân. Đăng nhập để lưu yêu thích, tạo playlist và đồng bộ giữa các thiết bị.
          </p>
        </div>

        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 20 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={tweenBase}
              className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3.5 rounded-xl flex items-start gap-2.5 leading-relaxed overflow-hidden"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-muted-foreground text-xs uppercase tracking-wider block mb-1.5 font-medium">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                disabled={isSubmitting}
                autoComplete="email"
                inputMode="email"
                enterKeyHint="next"
                aria-label="Email"
                className="w-full bg-background/80 border border-border rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 transition-shadow"
              />
            </div>
          </div>

          <div>
            <label className="text-muted-foreground text-xs uppercase tracking-wider block mb-1.5 font-medium">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isSubmitting}
                autoComplete="current-password"
                enterKeyHint="go"
                aria-label="Mật khẩu"
                className="w-full bg-background/80 border border-border rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 transition-shadow"
              />
            </div>
          </div>

          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileTap={tapScale}
            transition={springSnappy}
            className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-3 text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer mt-6 shadow-md"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Đang kiểm tra...</span>
              </>
            ) : (
              <span>Đăng nhập</span>
            )}
          </motion.button>
        </form>

        <div className="relative my-6 text-center">
          <div className="border-t border-border absolute inset-x-0 top-1/2 -translate-y-1/2" />
          <span className="bg-card px-3 text-[11px] uppercase tracking-wider text-muted-foreground relative font-medium">
            Hoặc
          </span>
        </div>

        <motion.button
          type="button"
          onClick={handleGoogleLogin}
          whileTap={tapScale}
          transition={springSnappy}
          className="w-full border border-border bg-background/60 hover:bg-accent text-foreground font-medium rounded-xl py-2.5 text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <svg className="size-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Tiếp tục với Google</span>
        </motion.button>
      </motion.div>
    </div>
  );
}
