import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Command,
  Disc3,
  Film,
  Heart,
  ListMusic,
  Music2,
  Pause,
  Play,
  Search,
  Shuffle,
} from "lucide-react";
import { albumById, formatTime, type Track } from "../data/library";
import { useLibrary } from "../lib/useLibrary";
import { usePlayerIsCurrent, usePlayer, usePlayerIsPlaying } from "../lib/player";
import { viFold } from "../lib/vi-search";
import { cn } from "../lib/utils";

/**
 * COMMAND PALETTE (F4 2026-09-04).
 *
 * Desktop: Ctrl+K / Cmd+K mở. Mobile: KHÔNG có phím — AppShell header có
 * nút 🔍 riêng (44px) mở cùng modal này (feedback: "trên điện thoại làm
 * gì Ctrl K được").
 *
 * Thiết kế theo quy ước motion của app: vào bằng spring smooth (không
 * bounce lòe loẹt), danh sách KHÔNG stagger (kết quả tìm phải tức thì),
 * item active là nền — không flying pill.
 *
 * Search dùng viFold (F1) — gõ không dấu vẫn ra.
 */

type CommandItem =
  { kind: "track"; track: Track } | { kind: "action"; id: string; label: string; run: () => void; icon: typeof Play };

const QUICK_ACTIONS = (player: ReturnType<typeof usePlayer>): CommandItem[] => [
  {
    kind: "action",
    id: "toggle",
    label: player.isPlaying ? "Tạm dừng phát" : "Phát nhạc",
    icon: player.isPlaying ? Pause : Play,
    run: () => player.toggle(),
  },
  {
    kind: "action",
    id: "next",
    label: "Bài kế tiếp",
    icon: ArrowRight,
    run: () => player.next(true),
  },
  {
    kind: "action",
    id: "shuffle",
    label: "Trộn bài (rải nghệ sĩ)",
    icon: Shuffle,
    run: () => player.toggleShuffle(),
  },
  {
    kind: "action",
    id: "stats",
    label: "Xem thống kê nghe nhạc",
    icon: BarChart3,
    run: () => {},
  },
  {
    kind: "action",
    id: "my-library",
    label: "Kho của tôi (yêu thích, playlist)",
    icon: Heart,
    run: () => {},
  },
  {
    kind: "action",
    id: "albums",
    label: "Duyệt Albums",
    icon: Disc3,
    run: () => {},
  },
  {
    kind: "action",
    id: "videos",
    label: "Duyệt MV",
    icon: Film,
    run: () => {},
  },
];

const ROUTE_OF_ACTION: Record<string, string> = {
  stats: "/stats",
  "my-library": "/my-library",
  albums: "/albums",
  videos: "/videos",
  library: "/library",
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { tracks } = useLibrary();
  const player = usePlayer();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset mỗi lần mở — tìm mới là phiên mới.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    // Autofocus sau khi mount animation frame đầu (tránh iOS scroll-jump
    // khi focus input trong fixed overlay).
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // Đóng bằng Esc — xử lý ở input keydown để không đụng hotkeys toàn cục.
  const items = useMemo<CommandItem[]>(() => {
    const folded = viFold(q);
    const quick = QUICK_ACTIONS(player).filter((a) => {
      if (a.kind !== "action") return true;
      return !folded || viFold(a.label).includes(folded);
    });
    if (!folded) {
      const recents: CommandItem[] = tracks.slice(0, 5).map((t) => ({ kind: "track", track: t }));
      return [...quick.slice(0, 3), ...recents];
    }
    const matchedTracks = tracks
      .filter((t) => viFold(t.title).includes(folded) || viFold(t.artist).includes(folded))
      .slice(0, 8)
      .map((t): CommandItem => ({ kind: "track", track: t }));
    return [...quick.slice(0, 3), ...matchedTracks];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tracks, player.isPlaying, player]);

  useEffect(() => setSel(0), [q]);

  const runItem = (item: CommandItem): void => {
    if (item.kind === "track") {
      const idxInLibrary = tracks.findIndex((t) => t.id === item.track.id);
      player.playQueue(tracks, idxInLibrary >= 0 ? idxInLibrary : 0);
    } else {
      const route = ROUTE_OF_ACTION[item.id];
      if (route) void navigate({ to: route });
      else item.run();
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[sel];
      if (item) runItem(item);
    }
  };

  // Scroll item active vào view khi di chuyển bằng phím.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Bảng lệnh Duckroom"
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="bg-card border-border edge-shadow-b w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
              <Search className="text-muted-foreground size-5 shrink-0" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm bài hát, thao tác… (gõ không dấu cũng ra)"
                aria-label="Tìm trong Duckroom"
                autoComplete="off"
                spellCheck={false}
                className="placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <kbd className="border-border text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:block">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto px-2 pb-2">
              {items.length === 0 && (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">Không tìm thấy gì cho "{q}".</p>
              )}
              {items.map((item, i) => (
                <PaletteRow
                  key={item.kind === "track" ? item.track.id : item.kind === "action" ? item.id : String(i)}
                  item={item}
                  idx={i}
                  selected={i === sel}
                  onHover={() => setSel(i)}
                  onRun={() => runItem(item)}
                />
              ))}
            </div>

            <div className="border-border/60 text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-[11px]">
              <span className="flex items-center gap-1.5">
                <Command className="size-3" /> Ctrl K
              </span>
              <span>↑↓ di chuyển</span>
              <span>Enter chạy</span>
              <span className="ml-auto hidden sm:block">Tìm không dấu được — "dam cuoi" → Đám Cưới</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaletteRow({
  item,
  idx,
  selected,
  onHover,
  onRun,
}: {
  item: CommandItem;
  idx: number;
  selected: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  if (item.kind === "action") {
    const Icon = item.icon;
    return (
      <button
        data-idx={idx}
        onClick={onRun}
        onMouseEnter={onHover}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors cursor-pointer",
          selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
        )}
      >
        <Icon className={cn("size-4 shrink-0", selected && "text-primary")} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  }
  return <TrackResultRow track={item.track} idx={idx} selected={selected} onHover={onHover} onRun={onRun} />;
}

/** Row kết quả track — hiện nút phát (bài đang phát thì pause), không cần
 *  subscribe cả PlayerContext: chỉ 2 selector boolean (perf convention). */
function TrackResultRow({
  track,
  idx,
  selected,
  onHover,
  onRun,
}: {
  track: Track;
  idx: number;
  selected: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  const isCurrent = usePlayerIsCurrent(track.id);
  const isPlaying = usePlayerIsPlaying();
  const album = albumById(track.albumId);
  return (
    <button
      data-idx={idx}
      onClick={onRun}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/60",
          isCurrent && "ring-primary ring-1",
        )}
      >
        {isCurrent ? (
          isPlaying ? (
            <Pause className="text-primary size-3.5" fill="currentColor" />
          ) : (
            <Play className="text-primary size-3.5 translate-x-px" fill="currentColor" />
          )
        ) : (
          <Music2 className="text-muted-foreground size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", isCurrent && "text-primary")}>{track.title}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {track.artist}
          {album ? ` · ${album.title}` : ""}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatTime(track.duration)}</span>
    </button>
  );
}
