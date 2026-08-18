import { createFileRoute, Link } from "@tanstack/react-router";
import { Film, Play, RefreshCw, UploadCloud } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { formatTime, syncLibraryWithS3 } from "../data/library";
import { listContainerVariants, listItemVariants, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { useLibrary } from "../lib/useLibrary";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/videos/")({
  head: () => ({
    meta: [
      { title: "MV — Duckroom" },
      { name: "description", content: "Kho MV và live session lưu ở master gốc trong Duckroom." },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "MV — Duckroom" },
      { property: "og:description", content: "Kho MV và live session lưu ở master gốc." },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: VideosPage,
});

function VideoCard({ v }: { v: any }) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <motion.div variants={listItemVariants} whileHover={{ y: -6 }} transition={springSnappy}>
      <Link to="/videos/$videoId" params={{ videoId: v.id }} className="group block">
        <div className="relative overflow-hidden rounded-xl bg-card/60 aspect-video">
          {!imgLoaded && (
            <div className="absolute inset-0 bg-muted/40 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          )}
          <motion.img
            layoutId={`video-${v.id}`}
            src={v.thumb}
            alt={`Ảnh nền MV ${v.title}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
            width={800}
            height={456}
            className={cn(
              "aspect-video w-full object-cover transition-all duration-500",
              imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]"
            )}
          />
          <div className="bg-background/30 absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <span className="bg-primary text-primary-foreground grid size-14 place-items-center rounded-full shadow-xl">
              <Play className="size-5 translate-x-px" fill="currentColor" />
            </span>
          </div>
          <span className="bg-background/80 backdrop-blur-md absolute right-3 bottom-3 rounded-md px-2 py-1 text-[11px] tabular-nums font-medium">
            {formatTime(v.duration)}
          </span>
        </div>
        <h2 className="font-display mt-3 text-xl">{v.title}</h2>
        <p className="text-muted-foreground text-xs">
          {v.resolution} · {v.codec} · {v.bitrate}
        </p>
      </Link>
    </motion.div>
  );
}

function VideosPage() {
  const { videos } = useLibrary();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncS3 = async () => {
    setIsSyncing(true);
    await syncLibraryWithS3(true);
    setIsSyncing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="mx-auto max-w-6xl px-6 py-12"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-5xl">MV & Video</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Lưu bản master, phát nguyên codec và bitrate gốc.
          </p>
        </div>
        <motion.button
          type="button"
          onClick={handleSyncS3}
          disabled={isSyncing}
          whileTap={tapScale}
          transition={springSnappy}
          className="border-border text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
          title="Kiểm tra Pikamc S3 và dọn dẹp các MV đã bị xóa trên Storage"
        >
          <RefreshCw className={cn("size-3.5", isSyncing && "animate-spin")} />
          <span>{isSyncing ? "Đang quét S3..." : "Đồng bộ Kho S3"}</span>
        </motion.button>
      </div>
      {videos.length > 0 ? (
        <motion.div
          variants={listContainerVariants}
          initial="hidden"
          animate="show"
          className="mt-10 grid gap-8 md:grid-cols-2"
        >
          {videos.map((v) => (
            <VideoCard key={v.id} v={v} />
          ))}
        </motion.div>
      ) : (
        <div className="border-border bg-card/30 mt-10 flex flex-col items-center gap-4 rounded-xl border p-16 text-center">
          <Film className="text-muted-foreground size-12" />
          <h3 className="font-display text-2xl">Chưa có MV nào</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            Duckroom hiện tại chưa có video MV nào. Hãy tải lên các video 4K bản gốc ProRes hoặc H.265 của bạn.
          </p>
          <motion.div whileTap={tapScale} transition={springSnappy} className="mt-2">
            <Link
              to="/upload"
              className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium cursor-pointer"
            >
              <UploadCloud className="size-4" /> Tải lên MV ngay
            </Link>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}