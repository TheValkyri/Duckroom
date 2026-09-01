import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { PlayerProvider } from "../lib/player";
import { MemberLibraryProvider } from "../lib/member-library-context";
import { RoleProvider } from "../lib/role-context";
import { AppShell } from "../components/AppShell";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Không tìm thấy trang</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Trở về trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Không thể tải trang</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Đã xảy ra lỗi trên hệ thống. Bạn có thể thử tải lại trang hoặc quay về trang chủ.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Thử lại
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Trở về trang chủ
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Duckroom" },
      {
        name: "description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Duckroom — Kho nhạc lossless riêng" },
      {
        property: "og:description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://duckroom.vercel.app" },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { property: "og:image:secure_url", content: "https://duckroom.vercel.app/og-image.jpg" },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "675" },
      { property: "og:image:alt", content: "Duckroom — Kho nhạc Lossless & MV bản gốc cá nhân" },
      { name: "thumbnail", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Duckroom — Kho nhạc lossless riêng" },
      {
        name: "twitter:description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "theme-color", content: "#09090b" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..700&family=Sora:wght@300..700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/og-image.jpg" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

import { syncLibraryWithS3 } from "../data/library";

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    void syncLibraryWithS3(true).catch(() => {});

    let lastActiveTime = Date.now();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const elapsed = Date.now() - lastActiveTime;
        // If tab was inactive for > 15 minutes, quietly re-sync library in background
        if (elapsed > 15 * 60 * 1000) {
          void syncLibraryWithS3(true).catch(() => {});
        }
        lastActiveTime = Date.now();
      } else {
        lastActiveTime = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        {/* reducedMotion="user": tự động tôn trọng cài đặt "Giảm chuyển động"
            của hệ điều hành cho MỌI animation Framer Motion trong app. */}
        <MotionConfig reducedMotion="user">
          <RoleProvider>
            <MemberLibraryProvider>
              <PlayerProvider>
                <AppShell>
                  {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
                  <Outlet />
                </AppShell>
              </PlayerProvider>
            </MemberLibraryProvider>
          </RoleProvider>
        </MotionConfig>
      </QueryClientProvider>
    </RootDocument>
  );
}
