import { FileMusic, Filter, Mic2, Music, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTime } from "../../data/library";
import type { OwnerTrackItem } from "../../lib/owner-data";
import { cn } from "../../lib/utils";
import { SectionCard } from "./SectionCard";

interface TracksManagerSectionProps {
  tracks: OwnerTrackItem[];
}

export function TracksManagerSection({ tracks }: TracksManagerSectionProps) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "album" | "single" | "lyrics">("all");
  const [selectedFormat, setSelectedFormat] = useState<string>("all");

  const formats = useMemo(() => {
    const set = new Set<string>();
    tracks.forEach((t) => {
      if (t.format) set.add(t.format.toUpperCase());
    });
    return Array.from(set).sort();
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    return tracks.filter((t) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.albumTitle && t.albumTitle.toLowerCase().includes(q)) ||
        (t.storage_key && t.storage_key.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (filterType === "album" && (!t.albumId || t.albumId === "singles" || t.albumId === "single")) {
        return false;
      }
      if (filterType === "single" && t.albumId && t.albumId !== "singles" && t.albumId !== "single") {
        return false;
      }
      if (filterType === "lyrics" && !t.hasLyrics) {
        return false;
      }

      if (selectedFormat !== "all" && t.format?.toUpperCase() !== selectedFormat) {
        return false;
      }

      return true;
    });
  }, [tracks, search, filterType, selectedFormat]);

  return (
    <SectionCard
      title="Kho toàn bộ bài hát (Track Master Inventory)"
      description="Quản lý chi tiết toàn bộ file audio master trong Duckroom: định dạng lossless, bit depth, tần số mẫu, dung lượng và trạng thái lời bài hát."
      icon={Music}
      action={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono font-medium">
            Hiển thị <strong>{filteredTracks.length}</strong> / {tracks.length} tracks
          </span>
        </div>
      }
    >
      {/* Search and Filters Bar */}
      <div className="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên bài hát, nghệ sĩ, album hoặc file storage key..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-background/60 border border-border rounded-xl outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Pills */}
          <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-xl border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "all" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => setFilterType("album")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "album" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Thuộc Album
            </button>
            <button
              type="button"
              onClick={() => setFilterType("single")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "single" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Đĩa đơn
            </button>
            <button
              type="button"
              onClick={() => setFilterType("lyrics")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1",
                filterType === "lyrics" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Mic2 className="size-3" /> Có lời
            </button>
          </div>

          {/* Format dropdown if multiple */}
          {formats.length > 1 && (
            <select
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
              className="text-xs bg-background/60 border border-border rounded-xl px-2.5 py-1.5 text-muted-foreground hover:text-foreground outline-none cursor-pointer"
            >
              <option value="all">Định dạng (Tất cả)</option>
              {formats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tracks Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        {filteredTracks.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center text-xs">Không có bài hát nào khớp với bộ lọc.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-3">Bài hát & Nghệ sĩ</th>
                  <th className="py-3 px-3">Album / Phát hành</th>
                  <th className="py-3 px-3">Chất lượng</th>
                  <th className="py-3 px-3">Dung lượng</th>
                  <th className="py-3 px-3">Thời lượng</th>
                  <th className="py-3 px-3 text-center">Lời bài hát</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 bg-card/40">
                {filteredTracks.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-accent/30 transition-colors">
                    <td className="py-3 px-3 text-center font-mono text-muted-foreground font-medium">
                      {t.trackNo > 0 ? t.trackNo : idx + 1}
                    </td>
                    <td className="py-3 px-3 min-w-[200px]">
                      <p className="font-semibold text-foreground truncate">{t.title}</p>
                      <p className="text-muted-foreground text-[11px] truncate">{t.artist}</p>
                    </td>
                    <td className="py-3 px-3 min-w-[150px] text-muted-foreground">
                      {t.albumTitle ? (
                        <span className="truncate block font-medium">{t.albumTitle}</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground/60">Đĩa đơn độc lập</span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-bold uppercase text-[10px]">
                          {t.format || "AUDIO"}
                        </span>
                        {t.bitDepth > 0 && t.sampleRate > 0 && (
                          <span className="text-muted-foreground">
                            {t.bitDepth}b/{Math.round(t.sampleRate / 1000)}k
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-muted-foreground">
                      {t.sizeMB > 0 ? `${t.sizeMB} MB` : "—"}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono font-medium text-foreground">
                      {formatTime(t.duration)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {t.hasLyrics ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-medium">
                          <Mic2 className="size-3" /> Đã có lời
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
