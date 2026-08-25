import { createFileRoute, Link } from "@tanstack/react-router";
import { Music2, RefreshCw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import { clearAllTracks, deleteTrack, syncLibraryWithS3, type Track } from "../data/library";
import { springPill, springSnappy, tapScale, tweenBase } from "../lib/motion";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { usePlayer } from "../lib/player";
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
    try {
      await syncLibraryWithS3(true);
    } catch (err) {
      console.warn("[Duckroom Library] Sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearAll = async () => {
    if (!isLoggedIn) return;
    if (
      confirm(
        "Xóa sạch danh sách bài hát và album trong BỘ NHỚ TRÌNH DUYỆT (cache)?\n\nDữ liệu trên PostgreSQL và Pikamc S3 KHÔNG bị xóa. Tải lại trang sẽ đồng bộ lại từ canonical DB.",
      )
    ) {
      clearAllTracks();
    }
  };

  const handleDelete = useCallback(
    async (id: string) => {
      if (!isLoggedIn) return;
      if (confirm("Xóa bài hát này khỏi thư viện?")) {
        await deleteTrack(id);
      }
    },
    [isLoggedIn],
  );

  const hasSingles = useMemo(() => {
    return tracks.some(
      (t) => !t.albumId || t.albumId === "singles" || t.albumId === "single-collection" || t.albumId === "single",
    );
  }, [tracks]);

  const filteredAlbums = useMemo(() => {
    return albums
      .filter((a) => a.id !== "singles" && a.id !== "single-collection")
      .map((a) => ({ id: a.id, title: a.title }));
  }, [albums]);

  const list = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return tracks
      .filter((t) => {
        let matchesFilter = true;
        if (filter === "singles") {
          matchesFilter =
            !t.albumId || t.albumId === "singles" || t.albumId === "single-collection" || t.albumId === "single";
        } else if (filter !== "all") {
          matchesFilter = t.albumId === filter;
        }

        const matchesSearch =
          !qLower || t.title.toLowerCase().includes(qLower) || t.artist.toLowerCase().includes(qLower);

        return matchesFilter && matchesSearch;
      })
      .sort((a, b) => {
        const timeA = parseInt(a.id.split("-")[0] || "0", 10) || a.trackNo;
        const timeB = parseInt(b.id.split("-")[0] || "0", 10) || b.trackNo;
        return timeA - timeB;
      });
  }, [tracks, filter, q]);

  const totalSizeGB = useMemo(() => {
    return (tracks.reduce((a, t) => a + (t.sizeMB || 0), 0) / 1024).toFixed(1);
  }, [tracks]);

  const filterTabs = useMemo(
    () => [
      { id: "all", title: "Tất cả" },
      ...(hasSingles ? [{ id: "singles", title: "🎵 Đĩa đơn" }] : []),
      ...filteredAlbums,
    ],
    [hasSingles, filteredAlbums],
  );

  const handlePlayTrack = useCallback(
    (_: Track, trackIdx: number) => {
      playQueue(list, trackIdx);
    },
    [playQueue, list],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/60">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Thư viện</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {tracks.length} bản thu · tổng {totalSizeGB} GB · chất lượng gốc không nén lại
          </p>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              type="button"
              onClick={handleSyncS3}
              disabled={isSyncing}
              whileTap={tapScale}
              transition={springSnappy}
              className="border-border text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer bg-card/40"
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
                className="text-muted-foreground hover:text-destructive border-border flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors cursor-pointer bg-card/40"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa sạch bài cũ</span>
              </motion.button>
            )}
          </div>
        )}
      </div>

      {tracks.length > 0 && (
        <div className="mt-8 flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative w-full md:w-72 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm bài hát, nghệ sĩ…"
              className="w-full bg-card/70 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl pl-9.5 pr-8 py-2 text-sm outline-none transition-all"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
            {filterTabs.map((a) => {
              const isSelected = filter === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setFilter(a.id)}
                  className={cn(
                    "relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer select-none overflow-hidden",
                    isSelected
                      ? "text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground border border-border/80 hover:bg-accent/40",
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="library-filter-pill"
                      transition={springPill}
                      className="absolute inset-0 rounded-full bg-primary"
                    />
                  )}
                  <span className="relative z-10">{a.title}</span>
                </button>
              );
            })}
          </div>
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
              <TrackRow track={t} n={i + 1} index={i} onPlayTrack={handlePlayTrack} onDeleteTrack={handleDelete} />
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
    </div>
  );
}
