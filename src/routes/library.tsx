import { createFileRoute, Link } from "@tanstack/react-router";
import { Music2, RefreshCw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import {
  clearSearchHistory,
  pushSearchHistory,
  readSearchHistory,
  removeSearchHistoryItem,
} from "../lib/search-history";
import {
  clearAllTracks,
  deleteTrack,
  sortTracksDeterministically,
  syncLibraryWithS3,
  type Track,
} from "../data/library";
import { springPill, springSnappy, tapScale } from "../lib/motion";
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
  // QoL A7: lịch sử tìm kiếm (5 từ gần nhất, localStorage per scope).
  const [history, setHistory] = useState<string[]>(() => readSearchHistory("library"));
  const [showHistory, setShowHistory] = useState(false);
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
    const filtered = tracks.filter((t) => {
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
    });

    return sortTracksDeterministically(filtered, albums);
  }, [tracks, filter, q, albums]);

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
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6 pb-6 border-b border-border/60">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Thư viện
          </h1>
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
        <div className="mt-6 flex flex-col gap-4 sm:mt-8 md:flex-row md:items-center">
          <div className="relative w-full md:w-72 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowHistory(e.target.value === "");
              }}
              onFocus={() => setShowHistory(true)}
              onBlur={() => {
                // Đợi click vào item kịp xử lý trước khi đóng.
                window.setTimeout(() => setShowHistory(false), 180);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) {
                  setHistory(pushSearchHistory("library", q));
                  setShowHistory(false);
                }
              }}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Tìm bài hát, nghệ sĩ…"
              aria-label="Tìm bài hát, nghệ sĩ"
              className="w-full bg-card/70 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl pl-9.5 pr-10 py-2.5 text-sm outline-none transition-all"
            />
            {/* QoL A7: Lịch sử tìm kiếm — hiện khi input rỗng + focus.
                Chọn mục = điền + search + đóng; nút ✕ xóa từng mục. */}
            {showHistory && history.length > 0 && !q && (
              <div
                role="listbox"
                aria-label="Tìm kiếm gần đây"
                className="bg-card border-border absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border p-1.5 shadow-2xl"
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5">
                  <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    Tìm kiếm gần đây
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistory(clearSearchHistory("library"))}
                    className="text-muted-foreground hover:text-destructive text-[10px] font-medium transition-colors cursor-pointer"
                  >
                    Xóa hết
                  </button>
                </div>
                {history.map((term) => (
                  <div key={term} className="group/h flex items-center rounded-xl transition-colors hover:bg-accent/50">
                    <button
                      type="button"
                      onClick={() => {
                        setQ(term);
                        setShowHistory(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm cursor-pointer"
                    >
                      <Search className="text-muted-foreground/70 size-3.5 shrink-0" />
                      <span className="truncate">{term}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistory(removeSearchHistoryItem("library", term))}
                      aria-label={`Xóa khỏi lịch sử: ${term}`}
                      className="text-muted-foreground/40 hover:text-destructive mr-1 grid size-9 shrink-0 place-items-center rounded-lg opacity-0 transition-all group-hover/h:opacity-100 cursor-pointer"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground grid size-9 place-items-center cursor-pointer"
              >
                <X className="size-4" />
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

      {/* PERF 2026-09-01 (round 2): bỏ NỐT motion.div wrapper trên từng row.
          Về đo thực tế (CDP PerformanceObserver): mỗi keystroke filter tạo
          44 exit-animation + 32 entrance node qua AnimatePresence = 1-3
          long task mỗi phím. TrackRow đã là component mượt (CSS transition
          thuần); danh sách cần phản hồi TỨC THÌ khi gõ — không cần hàng
          "mọc lên" animation khi kết quả đang thay đổi dưới ngón tay người
          dùng. Chuyển động có lý do: khi SEARCH, thay đổi nội dung chính
          là tín hiệu; animation thêm chỉ là nhiễu + trễ.
          - Giữ nguyên: empty-state / no-result (không phải danh sách).
          - Đã xác minh: 76 rows hiển thị hoàn toàn khi load trang (lần
            đầu) vẫn có page-fade của container. */}
      <div className="mt-6 space-y-1">
        {list.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            n={i + 1}
            index={i}
            onPlayTrack={handlePlayTrack}
            onDeleteTrack={handleDelete}
          />
        ))}
        {tracks.length === 0 ? (
          <div className="border-border bg-card/30 mt-10 flex flex-col items-center gap-4 rounded-xl border p-8 text-center sm:p-16">
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
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-muted-foreground text-sm">Không tìm thấy bài nào.</p>
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-primary text-xs font-medium hover:underline cursor-pointer"
              >
                Xóa bộ lọc "{q}"
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
