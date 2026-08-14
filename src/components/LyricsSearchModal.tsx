import { useEffect, useRef, useState } from "react";
import {
  Check,
  Disc,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mic,
  Music,
  PlusCircle,
  Search,
  Sparkles,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { beautifyLrcString } from "../lib/lyrics-formatter";
import {
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
  const [activeTab, setActiveTab] = useState<"search" | "paste">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LyricSearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<LyricSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [onlySynced, setOnlySynced] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchTime, setSearchTime] = useState(0);
  const leftColRef = useRef<HTMLDivElement>(null);
  const selectedCardRef = useRef<HTMLDivElement>(null);

  // Paste Tab States
  const [pastedText, setPastedText] = useState("");
  const [pastedPacedLrc, setPastedPacedLrc] = useState("");

  // Initialize query on open
  useEffect(() => {
    if (!isOpen) return;
    const q = `${initialArtist} ${initialTitle}`.trim() || initialTitle.trim() || initialArtist.trim();
    setQuery(q);
    setResults([]);
    setSelectedResult(null);
    setHasSearched(false);
    setSearchTime(0);
    setPastedText("");
    setPastedPacedLrc("");
    setActiveTab("search");
    if (q) {
      void handleSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);
    setSelectedResult(null);
    const startTime = Date.now();

    try {
      const parts = q.split(/\s*[-–—]\s*/).map((s) => s.trim()).filter(Boolean);
      let t = q;
      let a = "";
      if (parts.length >= 2) {
        a = parts[0]!;
        t = parts.slice(1).join(" ");
      }

      const list = await searchOnlineLyricsMultiSource(t, a);
      setResults(list);
      setSelectedResult(list[0] || null);
      setSearchTime(Date.now() - startTime);

      if (leftColRef.current) leftColRef.current.scrollTop = 0;
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

  const handleAutoPacePasted = () => {
    if (!pastedText.trim()) return;
    const paced = autoTimePacingLyrics(pastedText, audioDuration);
    const beautified = beautifyLrcString(paced);
    setPastedPacedLrc(beautified);
  };

  const handleApplyPasted = () => {
    const finalContent = pastedPacedLrc || autoTimePacingLyrics(pastedText, audioDuration);
    if (finalContent.trim()) {
      onSelectLyrics(beautifyLrcString(finalContent), {
        title: initialTitle,
        artist: initialArtist,
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  const filteredResults = onlySynced ? results.filter((r) => r.isSynced) : results;
  const syncedCount = results.filter((r) => r.isSynced).length;

  const formatDuration = (sec: number) => {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-5xl h-[85vh] flex flex-col bg-card/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-foreground"
        >
          {/* ─── Header ─── */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/80 bg-muted/40 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="size-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="size-4" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2 flex-wrap">
                  <span>Kho Tìm Kiếm & Chấm Nhịp Lời Bài Hát (LRC)</span>
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                    Đa Nguồn: LRCLIB • Musixmatch • Genius
                  </span>
                </h2>
                <p className="text-[11px] text-muted-foreground truncate">
                  Tự động tra cứu hoặc dán lời từ Genius / YouTube để canh nhịp chuẩn từng giây
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ─── Navigation Tabs ─── */}
          <div className="flex items-center gap-2 px-5 py-2.5 bg-card/90 border-b border-border shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("search")}
              className={cn(
                "px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer",
                activeTab === "search"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <Search className="size-3.5" />
              <span>Tìm kiếm Trực tuyến</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              className={cn(
                "px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer",
                activeTab === "paste"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <FileText className="size-3.5" />
              <span>Dán lời từ Genius / YouTube</span>
            </button>
          </div>

          {activeTab === "search" ? (
            <>
              {/* ─── Search Bar ─── */}
              <div className="px-5 py-3 bg-card border-b border-border shrink-0 space-y-2.5">
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
                      placeholder="Nhập tên bài hát, ví dụ: Obito - nước, đôi khi obito, le drip, mây obito..."
                      className="w-full pl-10 pr-4 py-2.5 bg-muted/50 border border-border focus:border-primary rounded-xl text-xs sm:text-sm outline-none transition-all focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || !query.trim()}
                    className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs sm:text-sm hover:bg-primary/90 transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                  >
                    {isSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    <span className="hidden sm:inline">Tìm kiếm</span>
                  </button>
                </form>

                {/* ─── Filter pills + stats ─── */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOnlySynced(false)}
                      className={cn(
                        "px-3 py-1 rounded-full border transition-all cursor-pointer text-[11px]",
                        !onlySynced
                          ? "bg-primary/20 text-primary border-primary/40 font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Tất cả ({results.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlySynced(true)}
                      className={cn(
                        "px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer text-[11px]",
                        onlySynced
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      LRC Đồng bộ ({syncedCount})
                    </button>
                  </div>

                  {searchTime > 0 && !isSearching && (
                    <span className="text-muted-foreground text-[10px]">
                      {results.length} kết quả • {(searchTime / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {/* ─── Body: Two columns ─── */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden bg-background/40 divide-y md:divide-y-0 md:divide-x divide-border">
                {/* Left Column: Result List — scrollable */}
                <div
                  ref={leftColRef}
                  className="md:col-span-5 overflow-y-auto overscroll-contain p-3 space-y-1.5"
                  style={{ scrollbarGutter: "stable" }}
                >
                  {isSearching ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                      <Loader2 className="size-6 animate-spin text-primary" />
                      <div className="text-center space-y-1">
                        <p className="text-xs font-medium">Đang quét kho dữ liệu đa nguồn...</p>
                        <p className="text-[10px] text-muted-foreground/60">Duckroom Vault • LRCLIB • Musixmatch</p>
                      </div>
                    </div>
                  ) : filteredResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                      <Music className="size-8 text-muted-foreground/50 mb-2" />
                      <p className="text-sm font-medium text-foreground">
                        {hasSearched ? "Không tìm thấy kết quả" : "Nhập từ khóa để bắt đầu"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
                        Bạn có thể chuyển sang tab <strong>"Dán lời từ Genius"</strong> để dán lời và tự động canh nhịp mượt mà trong 1 giây!
                      </p>
                    </div>
                  ) : (
                    filteredResults.map((item) => {
                      const isSelected = selectedResult?.id === item.id;
                      const isCommunity = item.source.includes("Community");
                      return (
                        <div
                          key={`${item.id}-${item.source}`}
                          ref={isSelected ? selectedCardRef : undefined}
                          onClick={() => setSelectedResult(item)}
                          className={cn(
                            "p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1",
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
                              <p className="text-[11px] text-muted-foreground truncate">{item.artistName}</p>
                            </div>
                            {item.isSynced ? (
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[9px] font-bold border shrink-0 uppercase tracking-wide",
                                isCommunity
                                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                  : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              )}>
                                {isCommunity ? "⭐ Verified LRC" : "LRC"}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground border border-border shrink-0 uppercase tracking-wide">
                                Text
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                            {item.albumName && (
                              <span className="flex items-center gap-0.5 truncate max-w-[120px]">
                                <Disc className="size-2.5 shrink-0" />
                                <span className="truncate">{item.albumName}</span>
                              </span>
                            )}
                            {item.duration ? (
                              <span>{formatDuration(item.duration)}</span>
                            ) : null}
                            <span className="flex items-center gap-0.5 ml-auto shrink-0 font-medium text-[9px]">
                              <Globe className="size-2.5" />
                              {item.source}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Right Column: Preview Pane — scrollable */}
                <div className="md:col-span-7 flex flex-col min-h-0 bg-card/30">
                  {selectedResult ? (
                    <>
                      <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-2 shrink-0">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs sm:text-sm font-bold text-foreground truncate">
                            {selectedResult.trackName}
                            <span className="font-normal text-muted-foreground"> — {selectedResult.artistName}</span>
                          </h4>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {selectedResult.isSynced
                              ? "✨ Lời bài hát đã có sẵn mốc thời gian LRC đồng bộ chuẩn"
                              : "⚡ Lời thuần văn bản (sẽ tự động canh nhịp khi áp dụng)"}
                            {selectedResult.source && (
                              <span className="ml-2 opacity-60">• {selectedResult.source}</span>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleApply(selectedResult)}
                          className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 shadow-md flex items-center gap-1.5 shrink-0 transition-transform hover:scale-[1.02] cursor-pointer"
                        >
                          <Check className="size-3.5" />
                          <span>Chọn bài này</span>
                        </button>
                      </div>

                      <div
                        className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-text bg-black/20"
                        style={{ scrollbarGutter: "stable" }}
                      >
                        {selectedResult.syncedLyrics || selectedResult.plainLyrics}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                      <FileText className="size-10 opacity-30 mb-2" />
                      <p className="text-xs">Chọn bài hát bên trái để xem trước nội dung lời.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* ─── TAB 2: Paste Lyrics from Genius / YouTube ─── */
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border bg-background/30">
              {/* Left: Input Textarea */}
              <div className="p-4 sm:p-6 flex flex-col min-h-0 gap-3 overflow-y-auto">
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="size-4 text-primary" />
                    <span>Dán lời bài hát từ Genius / YouTube / Web</span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Sao chép toàn bộ lời bài hát (kể cả không có timestamp) và dán vào bên dưới.
                  </p>
                </div>

                <textarea
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    setPastedPacedLrc("");
                  }}
                  placeholder="Ví dụ dán từ Genius:&#10;[Intro]&#10;(Woah)&#10;&#10;[Chorus]&#10;Anh đã thấy em bên bờ sông, yeah&#10;Đêm khuya đã rơi theo anh vào trong&#10;Baby, em hỏi anh khi nào xong, yah&#10;Mau dang cánh tay ôm em vào lòng..."
                  className="flex-1 min-h-[220px] p-3.5 bg-muted/40 border border-border focus:border-primary rounded-xl font-mono text-xs text-foreground outline-none resize-none leading-relaxed"
                />

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!pastedText.trim()}
                    onClick={handleAutoPacePasted}
                    className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                  >
                    <Zap className="size-3.5" />
                    <span>⚡ Tự động canh nhịp thời lượng ({Math.floor(audioDuration / 60)}:{(audioDuration % 60).toString().padStart(2, "0")})</span>
                  </button>
                  <button
                    type="button"
                    disabled={!pastedText.trim()}
                    onClick={() => {
                      const cleaned = pastedText
                        .replace(/^\[(Intro|Verse|Chorus|Refrain|Bridge|Outro|Hook).*?\]\s*$/gim, "")
                        .trim();
                      setPastedText(cleaned);
                      if (pastedPacedLrc) handleAutoPacePasted();
                    }}
                    className="px-3 py-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                  >
                    <Wand2 className="size-3.5" />
                    <span>Lọc thẻ [Intro]/[Chorus]</span>
                  </button>
                </div>
              </div>

              {/* Right: Real-time Paced Preview */}
              <div className="p-4 sm:p-6 flex flex-col min-h-0 gap-3 bg-black/20 overflow-y-auto">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Sparkles className="size-4 text-emerald-400" />
                      <span>Kết quả File LRC Đồng Bộ</span>
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {pastedPacedLrc ? "✨ Đã canh nhịp mượt mà theo từng câu hát" : "Chờ bạn dán lời và bấm canh nhịp"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!pastedText.trim()}
                    onClick={handleApplyPasted}
                    className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 shadow-md flex items-center gap-1.5 shrink-0 transition-transform hover:scale-[1.02] cursor-pointer disabled:opacity-40"
                  >
                    <Check className="size-3.5" />
                    <span>Áp dụng vào bài hát</span>
                  </button>
                </div>

                <div
                  className="flex-1 min-h-[220px] p-3.5 bg-card/60 border border-border rounded-xl font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-text overflow-y-auto"
                  style={{ scrollbarGutter: "stable" }}
                >
                  {pastedPacedLrc || (pastedText.trim() ? autoTimePacingLyrics(pastedText, audioDuration) : "Lời bài hát sau khi canh nhịp sẽ hiển thị tại đây với mốc thời gian [mm:ss.ms] chuẩn xác.")}
                </div>
              </div>
            </div>
          )}

          {/* ─── Footer ─── */}
          <div className="px-5 py-3 bg-muted/30 border-t border-border flex items-center justify-between text-[11px] shrink-0">
            <span className="text-muted-foreground">
              Mẹo: Lời bài hát từ <strong>Genius</strong> có thể sao chép và dán trực tiếp vào tab <strong>"Dán lời từ Genius"</strong> để tự động chia nhịp!
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
