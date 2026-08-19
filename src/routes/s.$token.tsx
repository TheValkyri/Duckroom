import { createFileRoute } from "@tanstack/react-router";
import { Play, Share2 } from "lucide-react";
import { motion } from "motion/react";
import { resolveShareLinkServer } from "../lib/sharing";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { formatTime } from "../data/library";

export const Route = createFileRoute("/s/$token")({
  loader: ({ params }: { params: { token: string } }) => resolveShareLinkServer({ data: { token: params.token } }),
  head: ({ loaderData }: { loaderData?: any }) => {
    if (!loaderData) return { meta: [{ title: "Duckroom — Shared" }] };
    const resource = (loaderData.resource as Record<string, unknown>) || {};
    const title = String(resource["title"] ?? resource["name"] ?? "Duckroom");
    const artist = String(resource["artist"] ?? "Duckroom");
    const artwork = (loaderData.artworkUrl as string) || "https://duckroom.vercel.app/og-image.jpg";
    const description = `${title} — ${artist} · Duckroom`;
    return {
      meta: [
        { title: `${title} — ${artist} · Duckroom` },
        { name: "description", content: description },
        { property: "og:type", content: "music.song" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: artwork },
        { property: "og:url", content: (loaderData.canonicalUrl as string) || "" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: artwork },
      ],
    };
  },
  component: SharedResourcePage,
});

function SharedResourcePage() {
  const data = Route.useLoaderData() as any;
  if (!data) return null;
  const resource = (data.resource as Record<string, unknown>) || {};
  const isTrack = data.resource_type === "track";
  const isVideo = data.resource_type === "video";
  const title = String(resource["title"] ?? resource["name"] ?? "Duckroom");
  const artist = String(resource["artist"] ?? "Duckroom");
  const duration = Number(resource["duration_seconds"] ?? 0);

  return (
    <motion.main
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="min-h-screen bg-background px-6 py-10"
    >
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-border bg-card/60 shadow-2xl lg:grid-cols-[minmax(300px,0.9fr)_1.1fr] backdrop-blur-xl">
          <div className="aspect-square bg-accent/20 lg:aspect-auto">
            {data.artworkUrl ? (
              <img src={data.artworkUrl} alt="" className="h-full w-full object-cover" decoding="async" />
            ) : (
              <div className="grid h-full place-items-center">
                <Share2 className="text-primary size-12" />
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center p-8 md:p-12">
            <p className="text-primary text-xs font-semibold uppercase tracking-[0.2em]">Shared from Duckroom</p>
            <h1 className="font-display mt-4 text-4xl md:text-5xl leading-tight">{title}</h1>
            <p className="text-muted-foreground mt-3 text-lg">{artist}</p>
            {duration > 0 && <p className="text-muted-foreground mt-2 text-xs">{formatTime(duration)}</p>}
            {isTrack && data.mediaUrl && (
              <audio className="mt-8 w-full" controls preload="metadata" src={data.mediaUrl} />
            )}
            {isVideo && data.mediaUrl && (
              <video
                className="mt-8 aspect-video w-full rounded-2xl bg-black shadow-lg"
                controls
                preload="metadata"
                src={data.mediaUrl}
                poster={data.artworkUrl ?? undefined}
              />
            )}
            {!isTrack && !isVideo && (
              <p className="text-muted-foreground mt-8 text-sm">
                Playlist được chia sẻ. Mở Duckroom để xem và phát toàn bộ nội dung.
              </p>
            )}
            <div className="mt-8 flex gap-3">
              <a
                href="/"
                className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity"
              >
                <Play className="size-4" /> Mở Duckroom
              </a>
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.share) {
                    navigator.share({ title: `${title} — ${artist}`, url: window.location.href });
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    alert("Đã sao chép link chia sẻ vào clipboard!");
                  }
                }}
                className="border-border rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-accent transition-colors cursor-pointer"
              >
                Chia sẻ
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </motion.main>
  );
}
