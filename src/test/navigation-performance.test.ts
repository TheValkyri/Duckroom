import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ssrLoaders from "../lib/ssr-loaders";
import * as supabaseModule from "../lib/supabase";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Navigation Performance & Routing Stability (Senior Lead Auditing)", () => {
  describe("1. Router Caching & Anti-Freeze Defaults (src/router.tsx)", () => {
    const routerSource = read("router.tsx");

    it("enables intent preloading with balanced delay (80ms) to eliminate cursor sweep storms", () => {
      expect(routerSource).toContain('defaultPreload: "intent"');
      expect(routerSource).toContain("defaultPreloadDelay: 80");
    });

    it("configures positive defaultStaleTime (60s) to prevent blocking loaders on navigation", () => {
      expect(routerSource).toContain("defaultStaleTime: 60_000");
    });

    it("configures defaultPendingMs (200ms) grace period to prevent immediate UI freezing", () => {
      expect(routerSource).toContain("defaultPendingMs: 200");
    });

    it("configures defaultGcTime (30m) for client-side memory retention", () => {
      expect(routerSource).toContain("defaultGcTime: 1000 * 60 * 30");
    });
  });

  describe("2. Route Loader Stale-While-Revalidate Caching (src/routes/*.tsx)", () => {
    it("/ (home) route defines staleTime and gcTime", () => {
      const src = read("routes/index.tsx");
      expect(src).toContain("staleTime: 60_000");
      expect(src).toContain("gcTime: 1000 * 60 * 30");
    });

    it("/albums/ route defines staleTime and gcTime", () => {
      const src = read("routes/albums.index.tsx");
      expect(src).toContain("staleTime: 60_000");
      expect(src).toContain("gcTime: 1000 * 60 * 30");
    });

    it("/singles route defines staleTime and gcTime", () => {
      const src = read("routes/singles.tsx");
      expect(src).toContain("staleTime: 60_000");
      expect(src).toContain("gcTime: 1000 * 60 * 30");
    });

    it("/videos/ route defines staleTime and gcTime", () => {
      const src = read("routes/videos.index.tsx");
      expect(src).toContain("staleTime: 60_000");
      expect(src).toContain("gcTime: 1000 * 60 * 30");
    });

    it("routes define dedicated pendingComponent to prevent white-out freeze during long fetches", () => {
      expect(read("routes/index.tsx")).toContain("pendingComponent: HomeSkeleton");
      expect(read("routes/albums.index.tsx")).toContain("pendingComponent: AlbumsSkeleton");
      expect(read("routes/singles.tsx")).toContain("pendingComponent: AlbumsSkeleton");
      expect(read("routes/videos.index.tsx")).toContain("pendingComponent: VideosSkeleton");
      expect(read("routes/albums.$albumId.tsx")).toContain("pendingComponent: AlbumsSkeleton");
    });
  });

  describe("3. AppShell Hitbox Stability & Anti-Flicker (src/components/AppShell.tsx)", () => {
    const shellSource = read("components/AppShell.tsx");

    it("memoizes visibleNav with useMemo([isOwner]) to prevent item remounting", () => {
      expect(shellSource).toMatch(/visibleNav\s*=\s*useMemo\(\s*\(\)\s*=>\s*nav\.filter/);
    });

    it("fixes sidebar nav item height (h-11 = 44px) to prevent layout shifts between states", () => {
      expect(shellSource).toContain("px-3 h-11 text-sm font-medium");
    });

    it("isolates pointer-events on icon and label to ensure anchor is the sole click target", () => {
      expect(shellSource).toContain("pointer-events-none transition-transform duration-150 group-hover:scale-110");
      expect(shellSource).toContain("whitespace-nowrap truncate z-10 pointer-events-none");
    });

    it("enforces explicit preloadDelay={80} on desktop sidebar links", () => {
      expect(shellSource).toContain("preloadDelay={80}");
    });

    it("uses robust isItemActive route prefix matching on both desktop nav and bottomNav", () => {
      expect(shellSource).toContain("const isItemActive = (to: string) => {");
      expect(shellSource).toContain("location.pathname === to || location.pathname.startsWith(`${to}/`)");
      expect(shellSource).toContain(
        'const isActive = match === "exact" ? location.pathname === "/" : isItemActive(to);',
      );
    });

    it("renders NavigationProgressBar at the shell root for instant visual feedback", () => {
      expect(shellSource).toContain("<NavigationProgressBar />");
    });

    it("applies tactile active press scaling (active:scale-[0.98]) to prevent perceived click deadness", () => {
      expect(shellSource).toContain("active:scale-[0.98]");
    });
  });

  describe("4. Mobile More Sheet Gesture Decoupling (src/components/shell/MobileMoreSheet.tsx)", () => {
    const sheetSource = read("components/shell/MobileMoreSheet.tsx");

    it("uses useDragControls and dragListener={false} so tapping cards never triggers drag", () => {
      expect(sheetSource).toContain("useDragControls()");
      expect(sheetSource).toContain("dragListener={false}");
      expect(sheetSource).toContain("dragControls={dragControls}");
    });

    it("attaches drag handler exclusively to the dedicated drag handle bar", () => {
      expect(sheetSource).toContain("onPointerDown={(e) => dragControls.start(e)}");
    });

    it("applies touch-manipulation and pointer-events-none on child text/icon", () => {
      expect(sheetSource).toContain("touch-manipulation");
      expect(sheetSource).toContain("pointer-events-none");
    });
  });

  describe("5. SSR Library Summary In-Memory Caching (src/lib/ssr-loaders.ts)", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.restoreAllMocks();
      ssrLoaders.clearSsrArtworkCache();
      ssrLoaders.clearSsrLibrarySummaryCache();
      process.env = {
        ...originalEnv,
        S3_ACCESS_KEY_ID: "test-access-key",
        S3_SECRET_ACCESS_KEY: "test-secret-key",
        S3_ENDPOINT: "https://s3.test.local",
        S3_REGION: "us-east-1",
        S3_BUCKET_NAME: "test-bucket",
      };
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.restoreAllMocks();
    });

    it("reuses in-memory cached summary across multiple concurrent or repeated calls", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "albums") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "album-cached-1",
                          title: "Cached Album",
                          artist: "Artist",
                          year: 2026,
                          cover_storage_key: "artworks/cover1.jpg",
                          accent: "oklch(0.7 0.1 50)",
                          note: "",
                          visibility: "public",
                          version: 1,
                          updated_at: new Date().toISOString(),
                          status: "active",
                          display_priority: 1,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "track-cached-1",
                          title: "Track 1",
                          artist: "Artist",
                          album_id: "album-cached-1",
                          track_no: 1,
                          duration_seconds: 200,
                          format: "FLAC",
                          bit_depth: 24,
                          sample_rate: 96000,
                          size_mb: 50,
                          storage_key: "audio/track1.flac",
                          cover_storage_key: "artworks/cover1.jpg",
                          year: 2026,
                          lyrics: [],
                          lyrics_source: null,
                          visibility: "public",
                          version: 1,
                          updated_at: new Date().toISOString(),
                          status: "active",
                          track_files: [],
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "videos") {
            return {
              select: () => ({
                eq: () => ({
                  neq: () => ({
                    order: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      const getAdminSpy = vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Call 1: Database hit
      const first = await ssrLoaders.getPublicLibrarySummaryInternal();
      expect(first.totalAlbums).toBe(1);
      const callCountAfterFirst = getAdminSpy.mock.calls.length;
      expect(callCountAfterFirst).toBeGreaterThan(0);

      // Call 2: In-memory cache hit (0 additional database queries)
      const second = await ssrLoaders.getPublicLibrarySummaryInternal();
      expect(second).toBe(first);
      expect(getAdminSpy.mock.calls.length).toBe(callCountAfterFirst);

      // Call 3 after clear cache: Queries database again
      ssrLoaders.clearSsrLibrarySummaryCache();
      const third = await ssrLoaders.getPublicLibrarySummaryInternal();
      expect(third).not.toBe(first);
      expect(getAdminSpy.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });
  });

  describe("6. Instant Feedback Top Navigation Progress Bar & Skeletons", () => {
    it("NavigationProgressBar component observes router status ('pending') and renders accessible progressbar", () => {
      const barSource = read("components/shell/NavigationProgressBar.tsx");
      expect(barSource).toContain("useRouterState");
      expect(barSource).toContain('state.status === "pending"');
      expect(barSource).toContain('role="progressbar"');
      expect(barSource).toContain("animate-nav-progress");
    });

    it("styles.css defines smooth @keyframes navProgress and .animate-nav-progress", () => {
      const css = read("styles.css");
      expect(css).toContain("@keyframes navProgress");
      expect(css).toContain(".animate-nav-progress");
    });

    it("LibrarySkeleton.tsx exports VideosSkeleton with responsive layout geometry", () => {
      const skel = read("components/LibrarySkeleton.tsx");
      expect(skel).toContain("export function VideosSkeleton()");
      expect(skel).toContain("aspect-video");
    });
  });
});
