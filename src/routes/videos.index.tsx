import { createFileRoute, Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { motion } from "motion/react";
import { springSnappy, tapScale } from "../lib/motion";
import { VideosSkeleton } from "../components/LibrarySkeleton";
import { getPublicLibrarySummaryServer } from "../lib/ssr-loaders";

export const Route = createFileRoute("/videos/")({
  staleTime: 60_000,
  gcTime: 1000 * 60 * 30,
  pendingComponent: VideosSkeleton,
  loader: async () => {
    try {
      const summary = await getPublicLibrarySummaryServer();
      return { summary };
    } catch (err) {
      console.warn("[Duckroom Route] Failed to load library summary for videos:", err);
      return { summary: undefined };
    }
  },
  head: () => ({
    meta: [
      { title: "MV — Duckroom" },
      { name: "description", content: "Duckroom hiện tập trung hoàn toàn vào âm thanh Lossless & Hi-Res Audio." },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "MV — Duckroom" },
      { property: "og:description", content: "Duckroom hiện tập trung hoàn toàn vào âm thanh Lossless & Hi-Res Audio." },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20 text-center">
      <div className="border-border bg-card/40 mx-auto flex flex-col items-center gap-4 rounded-3xl border p-12 sm:p-16 shadow-lg backdrop-blur-sm">
        <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
          <Film className="size-8" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          Tính năng MV đã ngừng hoạt động
        </h1>
        <p className="text-muted-foreground max-w-lg text-sm sm:text-base leading-relaxed">
          Duckroom hiện đã chuyển sang cấu trúc hoàn toàn tập trung vào âm thanh Lossless & Hi-Res Audio chất lượng cao. Các tính năng video đã được gỡ bỏ khỏi hệ thống.
        </p>
        <motion.div whileTap={tapScale} transition={springSnappy} className="mt-4">
          <Link
            to="/library"
            className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity cursor-pointer"
          >
            Khám phá Thư viện nhạc Lossless
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
