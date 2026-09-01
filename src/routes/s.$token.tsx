import { createFileRoute } from "@tanstack/react-router";
import { Play, Share2 } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { resolveShareLinkServer } from "../lib/sharing";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { formatTime } from "../data/library";

export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }: { params: { token: string } }) => {
    // Server-function RPC errors (expired/revoked/unknown token) arrive as
    // generic errors over the wire. Catch here and render a friendly page
    // instead of leaking a 500 to the visitor.
    try {
      return await resolveShareLinkServer({ data: { token: params.token } });
    } catch {
      return { __sharedError: true as const };
    }
  },
  head: ({ loaderData }: { loaderData?: any }) => {
    if (!loaderData || loaderData.__sharedError) return { meta: [{ title: "Duckroom — Shared" }] };
    const resource = (loaderData.resource as Record<string, unknown>) || {};
    const isPlaylist = loaderData.resource_type === "playlist";
    const title = String(resource["title"] ?? resource["name"] ?? "Duckroom");
    const artist = String(resource["artist"] ?? "Duckroom");
    const artwork = (loaderData.artworkUrl as string) || "https://duckroom.vercel.app/og-image.jpg";
    const description = `${title} — ${artist} · Duckroom`;
    return {
      meta: [
        { title: `${title} — ${artist} · Duckroom` },
        { name: "description", content: description },
        {
          property: "og:type",
          content: isPlaylist ? "music.playlist" : loaderData.resource_type === "video" ? "video.other" : "music.song",
        },
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

  if (data.__sharedError) {
    return (
      <main className="bg-background flex min-h-svh flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
        <Share2 className="text-muted-foreground mb-6 size-12" />
        <h1 className="font-display text-3xl md:text-4xl">Liên kết không còn hiệu lực</h1>
        <p className="text-muted-foreground mt-4 max-w-md text-sm">
          Liên kết chia sẻ này không tồn tại, đã bị thu hồi hoặc đã hết hạn. Hãy yêu cầu người gửi một liên kết mới.
        </p>
        <a
          href="/"
          className="bg-primary text-primary-foreground mt-8 rounded-full px-6 py-2.5 text-sm font-semibold shadow transition-opacity hover:opacity-90"
        >
          Mở Duckroom
        </a>
      </main>
    );
  }

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
      className="min-h-svh bg-background px-4 py-10 sm:px-6"
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
          <div className="flex flex-col justify-center p-6 sm:p-8 md:p-12">
            <p className="text-primary text-xs font-semibold uppercase tracking-[0.2em]">Shared from Duckroom</p>
            <h1 className="font-display mt-4 text-3xl leading-tight sm:text-4xl md:text-5xl">{title}</h1>
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
            {!isTrack &&
              !isVideo &&
              (() => {
                const tracks = Array.isArray(resource["playlist_tracks"])
                  ? (resource["playlist_tracks"] as Record<string, unknown>[])
                  : [];
                return (
                  <div className="mt-6">
                    <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">
                      Playlist · {tracks.length} bài hát
                    </p>
                    {tracks.length > 0 ? (
                      <ol className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-2 text-sm">
                        {tracks.map((t, i) => (
                          <li
                            key={String(t["id"] ?? i)}
                            className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/30 transition-colors"
                          >
                            <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              <span className="block truncate font-medium">{String(t["title"] ?? "")}</span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {String(t["artist"] ?? "")}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-muted-foreground mt-3 text-sm">Mở Duckroom để xem và phát toàn bộ nội dung.</p>
                    )}
                  </div>
                );
              })()}
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
                    toast.success("Đã sao chép liên kết!");
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
