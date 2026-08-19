import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Heart, ListMusic, Loader2, Music2, Plus, Trash2, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { TrackRow } from "../components/TrackRow";
import { useAuth } from "../lib/useAuth";
import { useLibrary } from "../lib/useLibrary";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { usePlayer } from "../lib/player";
import { springSnappy, tapScale, tweenBase } from "../lib/motion";
import { cn } from "../lib/utils";
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
    () => tracks.filter((track) => member.favorites.has(track.id)),
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
          Đăng nhập để lưu bài hát yêu thích, tạo playlist cá nhân, xem lịch sử nghe và tiếp tục nghe dở trên mọi thiết bị.
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
                await member.createPlaylist(newPlaylist.trim());
                setNewPlaylist("");
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
            {member.playlists.map((playlist) => (
              <div
                key={playlist.id}
                className="border-border bg-card/50 flex items-center justify-between rounded-2xl border p-4 hover:border-primary/40 transition-colors"
              >
                <Link to="/library" className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{playlist.name}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {playlist.tracks.length} bài · {playlist.description || "Playlist cá nhân"}
                  </p>
                </Link>
                <button
                  onClick={() => void member.deletePlaylist(playlist.id)}
                  className="text-muted-foreground hover:text-destructive rounded-lg p-2 transition-colors cursor-pointer"
                  aria-label={`Xóa ${playlist.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {!member.playlists.length && (
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
            {member.history.map((entry, index) => {
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
          {!member.history.length && (
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
  if (!member.playlists.length) return null;
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
          {member.playlists.map((playlist) => (
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border bg-card/30 mt-10 rounded-2xl border p-14 text-center">
      <Music2 className="text-muted-foreground mx-auto size-10" />
      <h3 className="mt-4 font-display text-2xl">{title}</h3>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-6">{body}</p>
    </div>
  );
}
