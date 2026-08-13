import { createFileRoute, Link } from "@tanstack/react-router";
import { Film, Play, RefreshCw, UploadCloud } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { formatTime, syncLibraryWithS3 } from "../data/library";
import { useLibrary } from "../lib/useLibrary";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/videos/")({
  head: () => ({
    meta: [
      { title: "MV & Video — Duckroom Lossless" },
      { name: "description", content: "Kho MV và live session lưu ở master gốc trong Duckroom." },
      { property: "og:title", content: "MV & Video — Duckroom Lossless" },
      { property: "og:description", content: "Kho MV và live session lưu ở master gốc." },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const { videos } = useLibrary();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncS3 = async () => {
    setIsSyncing(true);
    await syncLibraryWithS3(true);
    setIsSyncing(false);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-5xl">MV & Video</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Lưu bản master, phát nguyên codec và bitrate gốc.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSyncS3}
          disabled={isSyncing}
          className="border-border text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
          title="Kiểm tra Pikamc S3 và dọn dẹp các MV đã bị xóa trên Storage"
        >
          <RefreshCw className={cn("size-3.5", isSyncing && "animate-spin")} />
          <span>{isSyncing ? "Đang quét S3..." : "Đồng bộ Kho S3"}</span>
        </button>
      </div>
      {videos.length > 0 ? (
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {videos.map((v) => (
            <motion.div key={v.id} whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
              <Link to="/videos/$videoId" params={{ videoId: v.id }} className="group block">
                <div className="relative overflow-hidden rounded-lg">
                  <motion.img
                    layoutId={`video-${v.id}`}
                    src={v.thumb}
                    alt={`Ảnh nền MV ${v.title}`}
                    loading="lazy"
                    width={800}
                    height={456}
                    className="aspect-video w-full object-cover"
                  />
                  <div className="bg-background/30 absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="bg-primary text-primary-foreground grid size-14 place-items-center rounded-full">
                      <Play className="size-5 translate-x-px" fill="currentColor" />
                    </span>
                  </div>
                  <span className="bg-background/80 absolute right-3 bottom-3 rounded px-2 py-1 text-[11px] tabular-nums">
                    {formatTime(v.duration)}
                  </span>
                </div>
                <h2 className="font-display mt-3 text-xl">{v.title}</h2>
                <p className="text-muted-foreground text-xs">
                  {v.resolution} · {v.codec} · {v.bitrate}
                </p>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="border-border bg-card/30 mt-10 flex flex-col items-center gap-4 rounded-xl border p-16 text-center">
          <Film className="text-muted-foreground size-12" />
          <h3 className="font-display text-2xl">Chưa có MV nào</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            Duckroom hiện tại chưa có video MV nào. Hãy tải lên các video 4K bản gốc ProRes hoặc H.265 của bạn.
          </p>
          <Link
            to="/upload"
            className="bg-primary text-primary-foreground mt-2 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition-transform hover:scale-105"
          >
            <UploadCloud className="size-4" /> Tải lên MV ngay
          </Link>
        </div>
      )}
    </div>
  );
}