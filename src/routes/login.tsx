import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Loader2, Lock, Mail } from "lucide-react";
import { useState, useEffect } from "react";
import { ModernDuckLogo } from "../components/AppShell";
import { supabase } from "../lib/supabase-client";
import { useAuth } from "../lib/useAuth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Duckroom Lossless" },
      { name: "description", content: "Đăng nhập tài khoản thành viên Duckroom để quản lý kho nhạc." },
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
      void navigate({ to: "/upload" });
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
            : error.message || "Đăng nhập thất bại. Vui lòng kiểm tra lại tài khoản."
        );
        setIsSubmitting(false);
        return;
      }

      if (data.session) {
        void navigate({ to: "/upload" });
      }
    } catch (err) {
      setErrorMsg("Không thể kết nối đến dịch vụ xác thực.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16 flex flex-col items-center justify-center min-h-[75vh]">
      <div className="w-full bg-card/60 border border-border rounded-2xl p-8 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col items-center mb-6 text-center">
          <ModernDuckLogo className="size-12 mb-3 text-primary" />
          <h1 className="font-display text-2xl tracking-tight">
            Đăng nhập <span className="text-primary">Duck</span>room
          </h1>
          <p className="text-muted-foreground text-xs mt-1.5 leading-relaxed">
            Kho nhạc Lossless cá nhân. Đăng nhập để tải lên, chỉnh sửa và quản lý thư viện.
          </p>
        </div>

        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3.5 rounded-xl mb-5 flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

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
                className="w-full bg-background/80 border border-border rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
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
                className="w-full bg-background/80 border border-border rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground font-semibold rounded-xl py-3 text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer mt-6 shadow-md"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Đang kiểm tra...</span>
              </>
            ) : (
              <span>Đăng nhập</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
