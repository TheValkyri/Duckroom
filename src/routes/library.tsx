import { createFileRoute, Link } from "@tanstack/react-router";
import { Music2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import { deleteTrack, saveStoredLibrary, syncLibraryWithS3 } from "../data/library";
import { springPill, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { usePlayer } from "../lib/player";
import { useLibrary } from "../lib/useLibrary";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Thư viện — Duckroom" },
      {
        name: "description",
        content: "Toàn bộ bản thu FLAC/WAV 24-bit trong kho lưu trữ Duckroom.",
      },
      { property: "og:site_name", content: "Duckroom" },
      { property: "og:title", content: "Thư viện — Duckroom" },
      {
        property: "og:description",
        content: "Toàn bộ bản thu FLAC/WAV 24-bit trong kho lưu trữ Duckroom.",
      },
      { property: "og:image", content: "https://duckroom.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://duckroom.vercel.app/og-image.jpg" },
    ],
  }),
  component: LibraryPage,
});

import { useAuth } from "../lib/useAuth";

function LibraryPage() {
  const { playQueue } = usePlayer();
  const { tracks, albums } = useLibrary();
  const { isLoggedIn } = useAuth();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncS3 = async () => {
    if (!isLoggedIn) return;
    setIsSyncing(true);
    await syncLibraryWithS3(true);
    setIsSyncing(false);
  };

  const handleClearAll = () => {
    if (!isLoggedIn) return;
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách bài hát không?")) {
      tracks.length = 0;
      saveStoredLibrary(true);
    }
  };

  const handleDelete = (id: string) => {
    if (!isLoggedIn) return;
    void deleteTrack(id);
  };

  const hasSingles = tracks.some((t) => !t.albumId || t.albumId === "singles" || t.albumId === "single-collection");
  const filteredAlbums = albums.filter((a) => a.id !== "singles" && a.id !== "single-collection");

  const list = tracks
    .filter((t) => {
      const isSingle = !t.albumId || t.albumId === "singles" || t.albumId === "single-collection";
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "singles"
          ? isSingle
          : t.albumId === filter;

      const matchesSearch =
        t.title.toLowerCase().includes(q.toLowerCase()) ||
        t.artist.toLowerCase().includes(q.toLowerCase());

      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => {
      const timeA = parseInt(a.id.split("-")[0] || "0", 10) || a.trackNo;
      const timeB = parseInt(b.id.split("-")[0] || "0", 10) || b.trackNo;
      return timeA - timeB;
    });

  const filterTabs = [
    { id: "all", title: "Tất cả" },
    ...(hasSingles ? [{ id: "singles", title: "🎵 Đĩa đơn" }] : []),
    ...filteredAlbums,
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="mx-auto max-w-6xl px-6 py-12"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-5xl">Thư viện</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {tracks.length} bản thu · tổng {(tracks.reduce((a, t) => a + t.sizeMB, 0) / 1024).toFixed(1)}{" "}
            GB · không nén lại
          </p>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              onClick={handleSyncS3}
              disabled={isSyncing}
              whileTap={tapScale}
              transition={springSnappy}
              className="border-border text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
              title="Kiểm tra Pikamc S3 và dọn dẹp các bài hát đã bị xóa trên Storage"
            >
              <RefreshCw className={cn("size-3.5", isSyncing && "animate-spin")} />
              <span>{isSyncing ? "Đang quét S3..." : "Đồng bộ Kho S3"}</span>
            </motion.button>
            {tracks.length > 0 && (
              <motion.button
                type="button"
                onClick={handleClearAll}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground hover:text-destructive border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa sạch bài cũ</span>
              </motion.button>
            )}
          </div>
        )}
      </div>

      {tracks.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm bài hát, nghệ sĩ…"
            className="border-border bg-card focus:ring-ring w-64 rounded-md border px-3 py-2 text-sm outline-none focus:ring-1"
          />
          {filterTabs.map((a) => (
            <button
              key={a.id}
              onClick={() => setFilter(a.id)}
              className={cn(
                "relative border-border rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer",
                filter === a.id ? "text-primary-foreground font-medium border-transparent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {filter === a.id && (
                <motion.span
                  layoutId="library-filter-pill"
                  transition={springPill}
                  className="absolute inset-0 rounded-full bg-primary -z-10"
                />
              )}
              {a.title}
            </button>
          ))}
        </div>
      )}

      {/* AnimatePresence theo key={t.id}: hàng đã hiển thị sẵn không bị "chạy
          lại" animation khi gõ tìm kiếm/đổi filter — chỉ hàng THỰC SỰ mới
          xuất hiện (khớp filter mới) mới animate vào, hàng bị lọc ra sẽ fade
          out. Nếu dùng stagger container thông thường, mỗi lần gõ phím tìm
          kiếm cả danh sách sẽ "nháy" lại toàn bộ — phản tác dụng, gây rối mắt. */}
      <div className="mt-6 space-y-1">
        <AnimatePresence initial={false}>
          {list.map((t, i) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { ...tweenBase, delay: Math.min(i, 14) * 0.02 } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <TrackRow
                track={t}
                n={i + 1}
                onPlay={() => playQueue(list, i)}
                onDelete={() => handleDelete(t.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {tracks.length === 0 ? (
          <div className="border-border bg-card/30 mt-10 flex flex-col items-center gap-4 rounded-xl border p-16 text-center">
            <Music2 className="text-muted-foreground size-12" />
            <h3 className="font-display text-2xl">Thư viện trống</h3>
            <p className="text-muted-foreground max-w-md text-sm">
              Chưa có bài hát nào trong Duckroom. Bạn có thể tải lên các file nhạc FLAC, WAV bản gốc của bạn.
            </p>
            <Link
              to="/upload"
              className="bg-primary text-primary-foreground mt-2 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition-transform hover:scale-105"
            >
              <UploadCloud className="size-4" /> Tải lên nhạc ngay
            </Link>
          </div>
        ) : !list.length ? (
          <p className="text-muted-foreground py-16 text-center text-sm">Không tìm thấy bài nào.</p>
        ) : null}
      </div>
    </motion.div>
  );
}