import { createFileRoute, Link, notFound, isNotFound } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { getVideoByIdSsrServer } from "../lib/ssr-loaders";

export const Route = createFileRoute("/videos/$videoId")({
  staleTime: 60_000,
  gcTime: 1000 * 60 * 30,
  loader: async ({ params }) => {
    try {
      const video = await getVideoByIdSsrServer({ data: { videoId: params.videoId } });
      if (!video) {
        throw notFound();
      }
      return { video, videoId: params.videoId };
    } catch (err: any) {
      if (isNotFound(err) || err?.isNotFound || err?.status === 404 || err?.message?.includes("notFound")) {
        throw err;
      }
      console.warn("[Duckroom Route] Failed to load video SSR data:", err);
      return { video: undefined, videoId: params.videoId };
    }
  },
  head: ({ loaderData }) => {
    const v = loaderData?.video;
    const t = v?.title ?? "Video";
    const artist = v?.artist ? ` — ${v.artist}` : "";
    const thumb = v?.thumb || "https://duckroom.vercel.app/og-image.jpg";
    const desc = "Duckroom hiện tập trung hoàn toàn vào trải nghiệm Lossless Audio.";
    return {
      meta: [
        { title: `${t}${artist} — Duckroom` },
        { name: "description", content: desc },
        { property: "og:site_name", content: "Duckroom" },
        { property: "og:type", content: "video.other" },
        { property: "og:title", content: `${t} — Duckroom` },
        { property: "og:description", content: desc },
        { property: "og:image", content: thumb },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: `${t} — Duckroom` },
        { name: "twitter:description", content: desc },
        { name: "twitter:image", content: thumb },
      ],
    };
  },
  component: VideoPage,
});

function VideoPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20 text-center">
      <div className="border-border bg-card/40 mx-auto flex flex-col items-center gap-4 rounded-3xl border p-12 sm:p-16 shadow-lg backdrop-blur-sm">
        <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
          <Film className="size-8" />
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Video không còn khả dụng
        </h1>
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          Duckroom hiện tập trung hoàn toàn vào trải nghiệm phát nhạc Lossless & Hi-Res Audio. Tính năng phát video đã được ngừng hoạt động.
        </p>
        <Link
          to="/library"
          className="bg-primary text-primary-foreground mt-4 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity cursor-pointer"
        >
          Khám phá Thư viện nhạc Lossless
        </Link>
      </div>
    </div>
  );
}
