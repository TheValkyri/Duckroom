import { Link } from "@tanstack/react-router";
import { Pencil, Play, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useState } from "react";
import { albumTracks, type Album } from "../data/library";
import { springSnappy, tapScale } from "../lib/motion";
import { usePlayer } from "../lib/player";
import { useAuth } from "../lib/useAuth";
import { cn } from "../lib/utils";
import { EditAlbumModal } from "./EditAlbumModal";

export const AlbumCard = memo(function AlbumCard({
  album,
  onEdit,
  onDelete,
  onPlay,
}: {
  album: Album;
  onEdit?: () => void;
  onDelete?: () => void;
  onPlay?: () => void;
}) {
  const { playQueue } = usePlayer();
  const { isLoggedIn } = useAuth();
  const [showLocalEdit, setShowLocalEdit] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onEdit) {
      onEdit();
    } else {
      setShowLocalEdit(true);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) {
      onDelete();
    }
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onPlay) {
      onPlay();
    } else {
      playQueue(albumTracks(album.id), 0);
    }
  };

  return (
    <>
      <motion.div whileHover={{ y: -6 }} transition={springSnappy} className="relative group">
        {/* Member Action Buttons on Card Top-Right */}
        {isLoggedIn && (
          <div
            className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ pointerEvents: "auto" }}
          >
            <motion.button
              type="button"
              onClick={handleEditClick}
              whileTap={tapScale}
              transition={springSnappy}
              title="Chỉnh sửa Album"
              className="size-8 rounded-full bg-black/80 hover:bg-primary text-white hover:text-black border border-white/20 flex items-center justify-center transition-colors cursor-pointer shadow-lg backdrop-blur-sm"
            >
              <Pencil className="size-3.5" />
            </motion.button>
            {onDelete && (
              <motion.button
                type="button"
                onClick={handleDeleteClick}
                whileTap={tapScale}
                transition={springSnappy}
                title="Xóa album này"
                className="size-8 rounded-full bg-black/80 hover:bg-destructive text-white border border-white/20 flex items-center justify-center transition-colors cursor-pointer shadow-lg backdrop-blur-sm"
              >
                <Trash2 className="size-3.5" />
              </motion.button>
            )}
          </div>
        )}

        <Link to="/albums/$albumId" params={{ albumId: album.id }} className="block">
          <div className="card-lift relative overflow-hidden rounded-xl bg-card/60">
            {!imgLoaded && <div className="skeleton-bone absolute inset-0" />}
            {/* WP5 2026-09-04: bỏ layoutId={cover-...} — layoutId bắt framer
             * đo layout của MỌI ảnh cùng id mỗi frame + hold ProjectionNode
             * cho shared-element transition không tồn tại (không có trang
             * đích nào khớp id này) → 4 album grid = chi phí đo vu vơ trên
             * phone khi scroll. Quy ước perf 2026-08-25 (AppShell nav) đã
             * loại layoutId; grid là chỗ còn sót. Ảnh giữ transition CSS
             * thuần (transform/opacity) như cũ. */}
            <motion.img
              src={
                album.cover ||
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E"
              }
              alt={`Bìa album ${album.title}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={(e) => {
                const target = e.currentTarget;
                const fallback =
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%2318181b'/%3E%3C/svg%3E";
                if (target.src !== fallback) {
                  target.src = fallback;
                }
                setImgLoaded(true);
              }}
              width={512}
              height={512}
              className={cn(
                "aspect-square w-full object-cover transition-all duration-500 group-hover:scale-105",
                imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
              )}
            />
            <div className="from-background/90 absolute inset-0 bg-gradient-to-t to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <motion.button
              onClick={handlePlayClick}
              whileTap={tapScale}
              aria-label={`Phát ${album.title}`}
              className="bg-primary text-primary-foreground absolute right-3 bottom-3 grid size-11 translate-y-3 place-items-center rounded-full opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 cursor-pointer"
            >
              <Play className="size-4 translate-x-px" fill="currentColor" />
            </motion.button>
          </div>
          <div className="mt-3 flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg leading-tight truncate">{album.title}</h3>
              <p className="text-muted-foreground text-xs truncate mt-0.5">
                {album.artist ? `${album.artist} · ` : ""}
                {album.year} · {albumTracks(album.id).length} bài
              </p>
            </div>
            {isLoggedIn && (
              <motion.button
                type="button"
                onClick={handleEditClick}
                whileTap={tapScale}
                transition={springSnappy}
                title="Sửa album"
                className="text-muted-foreground hover:text-primary p-1 rounded-md transition-colors cursor-pointer shrink-0 mt-0.5"
              >
                <Pencil className="size-3.5" />
              </motion.button>
            )}
          </div>
        </Link>
      </motion.div>

      <AnimatePresence>
        {showLocalEdit && (
          <EditAlbumModal
            album={album}
            onClose={() => setShowLocalEdit(false)}
            onUpdated={() => setShowLocalEdit(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
});
