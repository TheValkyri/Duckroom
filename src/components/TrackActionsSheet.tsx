import { Heart, Pencil, Play, Plus, Share2, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { albumById, formatTime, type Track } from "../data/library";
import { MobileSheet } from "./MobileSheet";
import { springSnappy, tapScale } from "../lib/motion";
import { usePlayer } from "../lib/player";
import { useAuth } from "../lib/useAuth";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { useDuckroomRole } from "../lib/useRole";
import { createAndShareLink } from "../lib/share-client";
import { cn } from "../lib/utils";
import { useState } from "react";

/**
 * TrackActionsSheet — bảng hành động track cho phone (MOBILE_UI_ARCHITECTURE
 * §4). Trên thiết bị cảm ứng KHÔNG có hover, nên các nút Share/Edit/Delete
 * ẩn sau group-hover của TrackRow là hoàn toàn không thể chạm tới.
 * Sheet này gom: phát / yêu thích / thêm vào playlist / chia sẻ /
 * sửa (Owner) / xóa (Owner, có bước xác nhận trong sheet — không alert()).
 *
 * Toàn bộ handler được truyền từ TrackRow để tái dùng đúng logic已有的
 * (optimistic favorite + rollback, share-client, edit modal trigger) —
 * sheet không tự viết lại nghiệp vụ nào.
 */
export function TrackActionsSheet({
  open,
  onClose,
  track,
  onPlay,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  track: Track;
  onPlay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { isLoggedIn } = useAuth();
  const { favorites, toggleFavorite } = useMemberLibraryContext();
  const { isOwner } = useDuckroomRole();
  const { playQueue } = usePlayer();
  const isFavorite = favorites?.has ? favorites.has(track.id) : false;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const member = useMemberLibraryContext();
  const album = albumById(track.albumId);

  const handleShare = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    try {
      if (isLoggedIn) {
        await createAndShareLink({ resourceType: "track", resourceId: track.id, title: track.title });
      } else {
        const url = window.location.href;
        if (navigator.share) {
          await navigator.share({ title: `${track.title} — ${track.artist}`, url });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
        }
      }
      onClose();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Không chia sẻ được. Vui lòng thử lại.");
    } finally {
      setShareBusy(false);
    }
  };

  const rowBase =
    "flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left text-sm font-medium transition-colors cursor-pointer min-h-[52px]";

  return (
    <MobileSheet open={open} onClose={onClose} title="Thao tác bài hát" maxHeightVh={80}>
      {/* Track header inside sheet */}
      <div className="mx-2 mb-2 flex items-center gap-3 rounded-2xl bg-card/60 p-3">
        <span className="border-border grid size-11 shrink-0 place-items-center rounded-lg bg-card/60 border">
          <Play className="text-primary size-4" fill="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{track.title}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {track.artist}
            {album ? ` · ${album.title}` : ""}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatTime(track.duration)}</span>
      </div>

      <div className="pb-2">
        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          onClick={() => {
            onPlay();
            onClose();
          }}
          className={cn(rowBase, "text-foreground hover:bg-accent/50")}
        >
          <Play className="text-primary size-5 shrink-0" fill="currentColor" /> Phát bài hát
        </motion.button>

        {isLoggedIn ? (
          <>
            <motion.button
              whileTap={tapScale}
              transition={springSnappy}
              onClick={() => {
                void toggleFavorite(track.id).catch((error) => console.error(error));
              }}
              className={cn(
                rowBase,
                isFavorite ? "text-primary hover:bg-primary/10" : "text-foreground hover:bg-accent/50",
              )}
              aria-label={isFavorite ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
            >
              <Heart className="size-5 shrink-0" fill={isFavorite ? "currentColor" : "none"} />
              {isFavorite ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
            </motion.button>

            {(member.playlists || []).length > 0 && (
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => setPlaylistsOpen((v) => !v)}
                className={cn(rowBase, "text-foreground hover:bg-accent/50")}
                aria-expanded={playlistsOpen}
              >
                <Plus className="text-primary size-5 shrink-0" />
                Thêm vào playlist
              </motion.button>
            )}
            {playlistsOpen && (
              <div className="mx-4 mt-1 mb-2 rounded-xl border border-border bg-card/70 p-1.5">
                {(member.playlists || []).map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() => {
                      void member.addToPlaylist(playlist.id, track.id);
                      setPlaylistsOpen(false);
                      onClose();
                    }}
                    className="hover:bg-accent flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs transition-colors cursor-pointer"
                  >
                    {playlist.name}
                    <span className="text-muted-foreground ml-auto shrink-0">{playlist.tracks?.length || 0} bài</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <Link
            to="/login"
            onClick={onClose}
            className={cn(rowBase, "text-primary hover:bg-primary/10")}
            aria-label="Đăng nhập để lưu yêu thích"
          >
            <Heart className="size-5 shrink-0" />
            Đăng nhập để lưu yêu thích
          </Link>
        )}

        <motion.button
          whileTap={tapScale}
          transition={springSnappy}
          onClick={() => void handleShare()}
          disabled={shareBusy}
          className={cn(rowBase, "text-foreground hover:bg-accent/50 disabled:opacity-50")}
        >
          <Share2 className="text-primary size-5 shrink-0" />
          {shareBusy ? "Đang tạo liên kết…" : "Chia sẻ bài hát"}
        </motion.button>
        {shareError && <p className="text-destructive px-4 pb-2 text-xs">{shareError}</p>}

        {isOwner && (
          <>
            <div className="bg-border mx-4 my-1.5 h-px" />
            <motion.button
              whileTap={tapScale}
              transition={springSnappy}
              onClick={() => {
                onClose();
                onEdit();
              }}
              className={cn(rowBase, "text-foreground hover:bg-accent/50")}
            >
              <Pencil className="text-primary size-5 shrink-0" /> Sửa thông tin & Artwork
            </motion.button>
            {onDelete && (
              <motion.button
                whileTap={tapScale}
                transition={springSnappy}
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  onClose();
                  onDelete();
                }}
                className={cn(
                  rowBase,
                  confirmingDelete
                    ? "bg-destructive/15 text-destructive border border-destructive/40 font-semibold"
                    : "text-destructive/90 hover:bg-destructive/10",
                )}
                aria-label={confirmingDelete ? "Xác nhận xóa bài hát" : "Xóa bài hát khỏi thư viện"}
              >
                <Trash2 className="size-5 shrink-0" />
                {confirmingDelete ? "Chạm lần nữa để xóa vĩnh viễn" : "Xóa bài hát"}
              </motion.button>
            )}
          </>
        )}
      </div>
    </MobileSheet>
  );
}
