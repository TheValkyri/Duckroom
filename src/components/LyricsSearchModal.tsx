import React, { useEffect, useState } from "react";
import {
  Check,
  Clock,
  Disc,
  FileText,
  Loader2,
  Mic,
  Music,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { beautifyLrcString } from "../lib/lyrics-formatter";
import {
  cleanSongQuery,
  removeVietnameseDiacritics,
  searchOnlineLyricsMultiSource,
  type LyricSearchResult,
} from "../lib/lyrics-search";
import { autoTimePacingLyrics } from "../lib/metadata";
import { cn } from "../lib/utils";

interface LyricsSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTitle: string;
  initialArtist: string;
  audioDuration?: number;
  onSelectLyrics: (lyrics: string, trackInfo?: { title?: string; artist?: string }) => void;
}

export function LyricsSearchModal({
  isOpen,
  onClose,
  initialTitle,
  initialArtist,
  audioDuration = 180,
  onSelectLyrics,
}: LyricsSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LyricSearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<LyricSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [onlySynced, setOnlySynced] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Initialize query on open
  useEffect(() => {
    if (!isOpen) return;
    const q = `${initialArtist} ${initialTitle}`.trim() || initialTitle.trim() || initialArtist.trim();
    setQuery(q);
    if (q) {
      void handleSearch(q);
    } else {
      setResults([]);
      setSelectedResult(null);
      setHasSearched(false);
    }
  }, [isOpen, initialTitle, initialArtist]);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);
    try {
      const parts = q.split(/[-–]/).map((s) => s.trim());
      let t = q;
      let a = "";
      if (parts.length >= 2) {
        a = parts[0]!;
        t = parts.slice(1).join(" ");
      }

      const list = await searchOnlineLyricsMultiSource(t, a);
      setResults(list);
      setSelectedResult(list[0] || null);
    } catch (err) {
      console.error("Lyrics search error:", err);
      setResults([]);
      setSelectedResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleApply = (item: LyricSearchResult) => {
    let finalLrc = "";
    if (item.syncedLyrics) {
      finalLrc = beautifyLrcString(item.syncedLyrics);
    } else if (item.plainLyrics) {
      finalLrc = beautifyLrcString(autoTimePacingLyrics(item.plainLyrics, audioDuration));
    }

    if (finalLrc) {
      onSelectLyrics(finalLrc, {
        title: item.trackName,
        artist: item.artistName,
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  const filteredResults = onlySynced ? results.filter((r) => r.isSynced) : results;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-5xl max-h-[90vh] flex flex-col bg-card/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-foreground"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/40">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold">
                <Sparkles className="size-4" />
              </div>
              <div>
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                  <span>Kho Tìm Kiếm Lời Bài Hát & LRC Đồng Bộ</span>
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Đa Nguồn Online
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  Tìm kiếm hàng triệu bài hát có sẵn mốc thời gian LRC chuẩn từng giây từ thư viện quốc tế.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Search Bar & Filter Options */}
          <div className="p-4 sm:px-6 bg-card border-b border-border space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSearch(query);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nhập tên bài hát, nghệ sĩ hoặc từ khóa (ví dụ: đôi khi obito, le drip, elegie mck)..."
                  className="w-full pl-10 pr-4 py-2.5 bg-muted/50 border border-border focus:border-primary rounded-xl text-xs sm:text-sm outline-none transition-all focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs sm:text-sm hover:bg-primary/90 transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {isSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                <span>Tìm kiếm</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOnlySynced(false)}
                  className={cn(
                    "px-3 py-1 rounded-full border transition-all cursor-pointer",
                    !onlySynced
                      ? "bg-primary/20 text-primary border-primary/40 font-medium"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  Tất cả kết quả ({results.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOnlySynced(true)}
                  className={cn(
                    "px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer",
                    onlySynced
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-medium"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Chỉ lấy bài có LRC đồng bộ ({results.filter((r) => r.isSynced).length})</span>
                </button>
              </div>

              {results.length > 0 && (
                <span className="text-muted-foreground text-[11px]">
                  Bấm vào bài hát để xem trước lời bên phải
                </span>
              )}
            </div>
          </div>

          {/* Body: Two columns layout */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-[350px] max-h-[55vh] overflow-hidden bg-background/40 divide-y md:divide-y-0 md:divide-x divide-border">
            {/* Left Column: Result List */}
            <div className="md:col-span-5 overflow-y-auto p-4 space-y-2">
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-xs">Đang quét kho lời bài hát & định dạng LRC...</p>
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                  <Music className="size-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {hasSearched ? "Không tìm thấy kết quả phù hợp" : "Nhập từ khóa để bắt đầu tìm"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Mẹo: Bạn có thể thử gõ tên không dấu (ví dụ: <code className="text-primary">doi khi</code>,{" "}
                    <code className="text-primary">le drip</code>) hoặc chỉ nhập tên nghệ sĩ.
                  </p>
                </div>
              ) : (
                filteredResults.map((item) => {
                  const isSelected = selectedResult?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedResult(item)}
                      className={cn(
                        "p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5",
                        isSelected
                          ? "bg-primary/15 border-primary/50 shadow-sm ring-1 ring-primary/30"
                          : "bg-card/70 border-white/5 hover:border-white/20 hover:bg-card"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className={cn("text-xs sm:text-sm font-semibold truncate", isSelected ? "text-primary" : "text-foreground")}>
                            {item.trackName}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate">{item.artistName}</p>
                        </div>
                        {item.isSynced ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                            🟢 LRC Đồng bộ
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border shrink-0">
                            Text thường
                          </span>
                        )}
                      </div>

                      {item.albumName && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                          <Disc className="size-3 shrink-0" />
                          <span className="truncate">{item.albumName}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Column: Preview Pane */}
            <div className="md:col-span-7 flex flex-col min-h-0 bg-card/30">
              {selectedResult ? (
                <>
                  <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-foreground truncate">
                        Xem trước: {selectedResult.trackName} - {selectedResult.artistName}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedResult.isSynced
                          ? "✨ Lời bài hát đã có sẵn mốc thời gian từng giây (LRC chuẩn)"
                          : "⚡ Lời dạng văn bản thuần (sẽ tự động canh nhịp thời lượng khi áp dụng)"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApply(selectedResult)}
                      className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 shadow-md flex items-center gap-1.5 shrink-0 transition-transform hover:scale-102 cursor-pointer"
                    >
                      <Check className="size-3.5" />
                      <span>Chọn bài này</span>
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 sm:p-5 font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-text bg-black/20">
                    {selectedResult.syncedLyrics || selectedResult.plainLyrics}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <FileText className="size-10 opacity-30 mb-2" />
                  <p className="text-xs">Chọn một bài hát ở cột bên trái để xem trước lời bài hát tại đây.</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-muted/30 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground text-[11px]">
              Nếu bài hát mới hoặc chưa có trên mạng, bạn có thể bấm <strong>"Chấm nhịp theo giọng hát"</strong> để tự gán trong 1 phút.
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
