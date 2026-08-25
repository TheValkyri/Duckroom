import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { usePlayer } from "../lib/player";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";
import type { MemberPlaylist } from "../lib/useMemberLibrary";
import type { Track } from "../data/library";

export const Route = createFileRoute("/my-library")({
  head: () => ({
    meta: [
      { title: "Kho của tôi — Duckroom" },
      { name: "description", content: "Yêu thích, playlist, lịch sử nghe và tiến độ phát của bạn trên Duckroom." },
    ],
  }),
  component: MyLibraryPage,
});

type TabItem = {
  id: "favorites" | "playlists" | "history";
  label: string;
  Icon: LucideIcon;
};

const tabItems: TabItem[] = [
  { id: "favorites", label: "Yêu thích", Icon: Heart },
  { id: "playlists", label: "Playlists", Icon: ListMusic },
  { id: "history", label: "Lịch sử", Icon: Music2 },
];

function MyLibraryPage() {
  const navigate = useNavigate();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { tracks } = useLibrary();
  const { playQueue } = usePlayer();
  const member = useMemberLibraryContext();
  const [tab, setTab] = useState<"favorites" | "playlists" | "history">("favorites");
  const [newPlaylist, setNewPlaylist] = useState("");

  const favoriteTracks = useMemo(
    () => tracks.filter((track) => (member.favorites?.has ? member.favorites.has(track.id) : false)),
    [tracks, member.favorites],
  );

  if (!authLoading && !isLoggedIn) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <div className="size-16 rounded-full bg-primary/10 grid place-items-center mb-6">
          <Heart className="text-primary size-8" />
        </div>
        <h1 className="font-display text-4xl tracking-tight">Đây là kho riêng của bạn</h1>
        <p className="text-muted-foreground mt-3 max-w-lg text-sm leading-6">
          Đăng nhập để lưu bài hát yêu thích, tạo playlist cá nhân, xem lịch sử nghe và tiếp tục nghe dở trên mọi thiết
          bị.
        </p>
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          onClick={() => navigate({ to: "/login" })}
          className="bg-primary text-primary-foreground mt-7 rounded-full px-7 py-3 text-sm font-semibold shadow-lg hover:opacity-90 cursor-pointer"
        >
          Đăng nhập ngay
        </motion.button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tweenBase}
      className="mx-auto max-w-6xl px-6 py-12"
    >
      <div>
        <p className="text-primary text-xs font-semibold uppercase tracking-[0.22em]">Personal library</p>
        <h1 className="font-display mt-2 text-4xl md:text-5xl">Kho của tôi</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Những gì bạn lưu, nghe và sắp xếp riêng trong không gian Duckroom.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-b border-border pb-3">
        {tabItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors cursor-pointer",
              tab === id
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {member.isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" /> Đang tải thư viện cá nhân…
        </div>
      ) : member.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-8 rounded-xl border p-5 text-sm">
          {member.error}
        </div>
      ) : tab === "favorites" ? (
        <section className="mt-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Yêu thích</h2>
              <p className="text-muted-foreground mt-1 text-sm">{favoriteTracks.length} bài hát đã lưu</p>
            </div>
            {favoriteTracks.length > 0 && (
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => playQueue(favoriteTracks, 0)}
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow cursor-pointer"
              >
                Phát tất cả
              </motion.button>
            )}
          </div>
          {favoriteTracks.length ? (
            <div className="mt-5 space-y-1">
              {favoriteTracks.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  n={i + 1}
                  index={i}
                  onPlayTrack={(_t, idx) => playQueue(favoriteTracks, idx)}
                  extraActions={<PlaylistPicker track={track} />}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Chưa có bài yêu thích"
              body="Nhấn biểu tượng trái tim ở bất kỳ bài nào trong thư viện để lưu vào đây."
            />
          )}
        </section>
      ) : tab === "playlists" ? (
        <section className="mt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Playlists của bạn</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Tạo các không gian nghe riêng theo tâm trạng, dịp lễ hoặc nghệ sĩ.
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newPlaylist.trim()) return;
                try {
                  await member.createPlaylist(newPlaylist.trim());
                  setNewPlaylist("");
                } catch (err) {
                  console.error("[Duckroom MyLibrary] Create playlist failed:", err);
                  alert(
                    `Không tạo được playlist: ${err instanceof Error ? err.message : "lỗi không xác định"}. Vui lòng thử lại.`,
                  );
                }
              }}
            >
              <input
                value={newPlaylist}
                onChange={(e) => setNewPlaylist(e.target.value)}
                placeholder="Tên playlist mới…"
                className="bg-card border-border w-56 rounded-full border px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                type="submit"
                className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold cursor-pointer shadow"
              >
                <Plus className="size-4" /> Tạo
              </motion.button>
            </form>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {(member.playlists || []).map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} allTracks={tracks} />
            ))}
          </div>
          {!(member.playlists || []).length && (
            <EmptyState
              title="Tạo playlist đầu tiên"
              body="Một playlist không chỉ là danh sách bài hát — nó là cách bạn định hình không gian âm nhạc của riêng mình."
            />
          )}
        </section>
      ) : (
        <section className="mt-7">
          <h2 className="text-xl font-semibold">Lịch sử nghe</h2>
          <p className="text-muted-foreground mt-1 text-sm">50 lượt nghe gần nhất của bạn.</p>
          <div className="mt-5 space-y-1">
            {(member.history || []).map((entry, index) => {
              const track = tracks.find((item) => item.id === entry.track_id);
              return track ? (
                <TrackRow
                  key={`${entry.id}-${entry.track_id}`}
                  track={track}
                  n={index + 1}
                  index={index}
                  onPlayTrack={() => playQueue([track], 0)}
                />
              ) : null;
            })}
          </div>
          {!(member.history || []).length && (
            <EmptyState
              title="Chưa có lịch sử nghe"
              body="Những bài bạn thưởng thức sau khi đăng nhập sẽ tự động xuất hiện ở đây."
            />
          )}
        </section>
      )}
    </motion.div>
  );
}

function PlaylistPicker({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const member = useMemberLibraryContext();
  if (!(member.playlists || []).length) return null;
  return (
    <div className="relative">
      <button
        type="button"
        title="Thêm vào playlist"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="text-muted-foreground/60 hover:text-primary rounded p-1 text-[11px] font-medium transition-colors cursor-pointer"
      >
        + playlist
      </button>
      {open && (
        <div
          className="border-border bg-popover absolute right-0 top-8 z-30 min-w-48 rounded-xl border p-1.5 shadow-xl backdrop-blur-md"
          onClick={(event) => event.stopPropagation()}
        >
          {(member.playlists || []).map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => {
                void member.addToPlaylist(playlist.id, track.id);
                setOpen(false);
              }}
              className="hover:bg-accent flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer"
            >
              {playlist.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Playlist card với expand/collapse + inline rename + §12.2 reorder (↑/↓).
 * Reorder dùng optimistic update có rollback ở useMemberLibrary.reorderPlaylist;
 * server re-validate membership nên danh sách stale sẽ fail an toàn.
 */
function PlaylistCard({ playlist, allTracks }: { playlist: MemberPlaylist; allTracks: Track[] }) {
  const member = useMemberLibraryContext();
  const { playQueue } = usePlayer();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const resolvedTracks = useMemo(
    () =>
      (playlist.tracks ?? [])
        .map((entry) => allTracks.find((t) => t.id === entry.track_id))
        .filter((t): t is Track => Boolean(t)),
    [playlist.tracks, allTracks],
  );

  const moveTrack = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= resolvedTracks.length || busyIndex !== null) return;
    const ids = resolvedTracks.map((t) => t.id);
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    setBusyIndex(index);
    setReorderError(null);
    try {
      await member.reorderPlaylist(playlist.id, next);
    } catch (err) {
      console.error("[Duckroom MyLibrary] Reorder failed:", err);
      setReorderError(err instanceof Error ? err.message : "Không sắp xếp được playlist.");
    } finally {
      setBusyIndex(null);
    }
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await member.renamePlaylist(playlist.id, name);
    } catch (err) {
      console.error("[Duckroom MyLibrary] Rename playlist failed:", err);
      alert(`Không đổi được tên playlist: ${err instanceof Error ? err.message : "lỗi không xác định."}`);
    } finally {
      setRenaming(false);
      setRenameValue("");
    }
  };

  return (
    <div className="border-border bg-card/50 rounded-2xl border p-4 transition-colors md:col-span-2 hover:border-primary/40">
      <div className="flex items-center gap-2">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRename();
            }}
          >
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setRenaming(false);
                  setRenameValue("");
                }
              }}
              maxLength={100}
              className="bg-card border-border w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              className="text-primary shrink-0 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-accent/50"
            >
              Lưu
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="min-w-0 flex-1 text-left cursor-pointer"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <p className="truncate font-semibold">{playlist.name}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {playlist.tracks?.length || 0} bài · {playlist.description || "Playlist cá nhân"}
              </p>
            </button>
            {resolvedTracks.length > 0 && (
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => playQueue(resolvedTracks, 0)}
                className="text-primary hover:bg-primary/10 shrink-0 rounded-lg p-2 transition-colors"
                aria-label={`Phát ${playlist.name}`}
                title="Phát playlist"
              >
                <Play className="size-4" />
              </motion.button>
            )}
            <button
              onClick={() => {
                setRenaming(true);
                setRenameValue(playlist.name);
              }}
              className="text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors cursor-pointer"
              aria-label={`Đổi tên ${playlist.name}`}
              title="Đổi tên playlist"
            >
              <Pencil className="size-4" />
            </button>
            <button
              onClick={() => {
                member.deletePlaylist(playlist.id).catch((err) => {
                  console.error("[Duckroom MyLibrary] Delete playlist failed:", err);
                  alert(
                    `Không xóa được playlist "${playlist.name}": ${err instanceof Error ? err.message : "lỗi không xác định."}`,
                  );
                });
              }}
              className="text-muted-foreground hover:text-destructive rounded-lg p-2 transition-colors cursor-pointer"
              aria-label={`Xóa ${playlist.name}`}
            >
              <Trash2 className="size-4" />
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors cursor-pointer"
              aria-label={expanded ? "Thu gọn" : "Mở rộng"}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="border-border mt-3 border-t pt-3">
          {reorderError && (
            <p className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" /> {reorderError}
            </p>
          )}
          {resolvedTracks.length === 0 ? (
            <p className="text-muted-foreground py-3 text-xs">
              Chưa có bài hát. Dùng nút “+ playlist” ở bất kỳ bài nào.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {resolvedTracks.map((track, index) => (
                <li key={track.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/30">
                  <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", busyIndex === index && "opacity-50")}>
                    <span className="block truncate font-medium">{track.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">{track.artist}</span>
                  </span>
                  <button
                    type="button"
                    disabled={index === 0 || busyIndex !== null}
                    onClick={() => void moveTrack(index, -1)}
                    className="text-muted-foreground/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-20 rounded p-1 opacity-0 transition-all group-hover:opacity-100 cursor-pointer"
                    aria-label={`Di chuyển ${track.title} lên trên`}
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={index === resolvedTracks.length - 1 || busyIndex !== null}
                    onClick={() => void moveTrack(index, 1)}
                    className="text-muted-foreground/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-20 rounded p-1 opacity-0 transition-all group-hover:opacity-100 cursor-pointer"
                    aria-label={`Di chuyển ${track.title} xuống dưới`}
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border bg-card/30 mt-10 rounded-2xl border p-14 text-center">
      <Music2 className="text-muted-foreground mx-auto size-10" />
      <h3 className="mt-4 font-display text-2xl">{title}</h3>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-6">{body}</p>
    </div>
  );
}
