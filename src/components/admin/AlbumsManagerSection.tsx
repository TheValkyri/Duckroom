import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Disc,
  Disc3,
  ExternalLink,
  Layers,
  Loader2,
  Music,
  Search,
} from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatTime } from "../../data/library";
import {
  updateAlbumDisplayPriorityServer,
  type OwnerAlbumItem,
  type OwnerTrackItem,
} from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

interface AlbumsManagerSectionProps {
  albums: OwnerAlbumItem[];
  singles: OwnerTrackItem[];
  tracks: OwnerTrackItem[];
  onRefresh: () => Promise<void>;
}

export function AlbumsManagerSection({ albums, singles, tracks, onRefresh }: AlbumsManagerSectionProps) {
  const [activeTab, setActiveTab] = useState<"albums" | "singles">("albums");
  const [search, setSearch] = useState("");
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [editingPriorityId, setEditingPriorityId] = useState<string | null>(null);
  const [priorityValue, setPriorityValue] = useState<number>(0);
  const [isSavingPriority, setIsSavingPriority] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const filteredAlbums = albums.filter(
    (a) =>
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.artist.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredSingles = singles.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase()),
  );

  const handleStartEditPriority = (album: OwnerAlbumItem) => {
    setEditingPriorityId(album.id);
    setPriorityValue(album.display_priority ?? 999);
  };

  const handleSavePriority = async (albumId: string) => {
    setIsSavingPriority(true);
    setActionMsg(null);
    try {
      await updateAlbumDisplayPriorityServer({
        data: {
          albumId,
          displayPriority: Number(priorityValue),
        },
      });
      setActionMsg("✅ Đã cập nhật thứ tự hiển thị album!");
      setEditingPriorityId(null);
      await onRefresh();
    } catch (err: any) {
      alert(err?.message || "Không thể cập nhật độ ưu tiên album.");
    } finally {
      setIsSavingPriority(false);
    }
  };

  return (
    <SectionCard
      title="Quản lý Album & Đĩa đơn (Catalog Inventory)"
      description="Xem danh sách chi tiết các album chính thức, bài hát bên trong từng album, thứ tự hiển thị và kho đĩa đơn phát hành."
      icon={Disc3}
      action={
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("albums")}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "albums"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Disc3 className="size-3.5" /> Albums ({albums.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("singles")}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "singles"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Disc className="size-3.5" /> Đĩa đơn ({singles.length})
          </button>
        </div>
      }
    >
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={activeTab === "albums" ? "Tìm album theo tên hoặc nghệ sĩ..." : "Tìm đĩa đơn theo tên..."}
            className="w-full pl-9 pr-4 py-2 text-xs bg-background/60 border border-border rounded-xl outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        {actionMsg && <span className="text-xs text-emerald-400 font-medium">{actionMsg}</span>}
      </div>

      {activeTab === "albums" ? (
        <div className="mt-4 space-y-3">
          {filteredAlbums.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-xs">Không tìm thấy album nào phù hợp.</p>
          ) : (
            filteredAlbums.map((album) => {
              const albumTracks = tracks.filter((t) => t.albumId === album.id);
              const isExpanded = expandedAlbumId === album.id;
              const isEditing = editingPriorityId === album.id;

              return (
                <div
                  key={album.id}
                  className="rounded-2xl border border-border bg-card/50 overflow-hidden transition-colors hover:border-border/80"
                >
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="size-14 rounded-xl overflow-hidden bg-muted/40 shrink-0 border border-white/5 relative">
                        {album.cover ? (
                          <img src={album.cover} alt={album.title} className="size-full object-cover" />
                        ) : (
                          <div className="size-full grid place-items-center text-muted-foreground">
                            <Disc3 className="size-6" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm truncate text-foreground">{album.title}</h3>
                          <span className="text-[11px] text-muted-foreground font-mono">({album.year})</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{album.artist}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/80">
                          <span className="flex items-center gap-1 font-mono">
                            <Music className="size-3 text-primary" /> {album.trackCount} bài hát
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="size-3 text-primary" /> {formatTime(album.totalDurationSeconds)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                      {/* Priority tag/edit */}
                      <div className="flex items-center gap-1.5 text-xs bg-background/50 px-2.5 py-1 rounded-xl border border-border">
                        <ArrowUpDown className="size-3 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground font-medium">Ưu tiên:</span>
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={priorityValue}
                              onChange={(e) => setPriorityValue(parseInt(e.target.value, 10) || 0)}
                              className="w-12 px-1.5 py-0.5 text-xs bg-background border border-primary/50 rounded text-center outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              disabled={isSavingPriority}
                              onClick={() => void handleSavePriority(album.id)}
                              className="p-1 rounded bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
                              title="Lưu thứ tự"
                            >
                              {isSavingPriority ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEditPriority(album)}
                            className="font-mono font-semibold text-primary hover:underline cursor-pointer"
                            title="Ấn để thay đổi thứ tự ưu tiên"
                          >
                            #{album.display_priority}
                          </button>
                        )}
                      </div>

                      <Link
                        to="/albums/$albumId"
                        params={{ albumId: album.id }}
                        className="p-2 rounded-xl border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Xem trang Album"
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>

                      <button
                        type="button"
                        onClick={() => setExpandedAlbumId(isExpanded ? null : album.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl border border-border bg-card/60 hover:bg-accent text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                          isExpanded && "bg-accent text-foreground",
                        )}
                      >
                        <span>Tracks</span>
                        {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable Track List */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-border/60 bg-black/20 p-3 sm:p-4"
                      >
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Danh sách bài hát trong album ({albumTracks.length})
                        </p>
                        <div className="space-y-1 divide-y divide-white/5 font-mono text-xs">
                          {albumTracks.map((t) => (
                            <div
                              key={t.id}
                              className="py-2 px-3 flex items-center justify-between rounded-lg hover:bg-white/5 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-5 text-muted-foreground font-semibold text-right">
                                  {t.trackNo > 0 ? t.trackNo : "—"}
                                </span>
                                <span className="font-sans font-medium text-foreground truncate">{t.title}</span>
                                {t.format && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/10 text-primary uppercase border border-primary/20">
                                    {t.format}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-muted-foreground shrink-0">
                                {t.sizeMB > 0 && <span>{t.sizeMB} MB</span>}
                                <span>{formatTime(t.duration)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Singles Table / List */
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {filteredSingles.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-xs">Không tìm thấy đĩa đơn nào phù hợp.</p>
          ) : (
            <div className="divide-y divide-border/60 bg-card/40">
              {filteredSingles.map((single, idx) => (
                <div
                  key={single.id}
                  className="p-3.5 flex items-center justify-between gap-4 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 text-xs text-muted-foreground font-mono text-right font-medium">
                      {idx + 1}
                    </span>
                    <div className="size-11 rounded-lg overflow-hidden bg-muted/40 shrink-0 border border-white/5">
                      {single.cover ? (
                        <img src={single.cover} alt={single.title} className="size-full object-cover" />
                      ) : (
                        <div className="size-full grid place-items-center text-muted-foreground">
                          <Disc className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{single.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{single.artist}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground font-mono">
                    {single.format && (
                      <span className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-[10px] text-primary uppercase font-bold">
                        {single.format}
                      </span>
                    )}
                    {single.bitDepth > 0 && single.sampleRate > 0 && (
                      <span className="hidden sm:inline text-[11px]">
                        {single.bitDepth}-bit / {Math.round(single.sampleRate / 1000)}kHz
                      </span>
                    )}
                    {single.sizeMB > 0 && <span className="hidden md:inline">{single.sizeMB} MB</span>}
                    <span className="font-semibold text-foreground">{formatTime(single.duration)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
