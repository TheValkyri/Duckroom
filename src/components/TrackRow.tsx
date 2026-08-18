import { Pencil, Play, Trash2, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useState } from "react";
import { albumById, formatTime, type Track } from "../data/library";
import { springSnappy, tapScale } from "../lib/motion";
import { usePlayer } from "../lib/player";
import { cn } from "../lib/utils";
import { EditTrackModal } from "./EditTrackModal";

import { useAuth } from "../lib/useAuth";

export const TrackRow = memo(function TrackRow({
  track,
  n,
  onPlay,
  onDelete,
  onUpdate,
  extraActions,
  showAlbum = true,
}: {
  track: Track;
  n: number;
  onPlay: () => void;
  onDelete?: () => void;
  onUpdate?: () => void;
  extraActions?: React.ReactNode;
  showAlbum?: boolean;
}) {
  const { current, isPlaying } = usePlayer();
  const { isLoggedIn } = useAuth();
  const active = current?.id === track.id;
  const album = albumById(track.albumId);
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <>
      <div
        className={cn(
          "group hover:bg-accent/40 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors relative",
          active && "bg-accent/50",
        )}
      >
        <button
          onClick={onPlay}
          className="flex flex-1 items-center gap-4 min-w-0 text-left cursor-pointer"
        >
          <span className="text-muted-foreground grid place-items-center text-sm tabular-nums shrink-0">
            <span className="group-hover:hidden">
              {active && isPlaying ? (
                <Volume2 className="text-primary size-4" />
              ) : (
                n.toString().padStart(2, "0")
              )}
            </span>
            <Play className="hidden size-3.5 group-hover:block" fill="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", active && "text-primary")}>
              {track.title}
            </span>
            <span className="text-muted-foreground block truncate text-xs">{track.artist}</span>
          </span>
          {showAlbum && (
            <span className="text-muted-foreground hidden truncate text-xs md:block w-40">
              {album?.title || "Single Collection"}
            </span>
          )}
          <span className="border-border text-muted-foreground hidden rounded border px-1.5 py-0.5 text-[10px] md:block shrink-0">
            {track.format} {track.bitDepth}/{track.sampleRate}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums shrink-0">
            {formatTime(track.duration)}
          </span>
        </button>

        {/* Edit Track & Artwork Button - Only for logged-in members */}
        {isLoggedIn && (
          <motion.button
            type="button"
            title="Chỉnh sửa thông tin bài hát & Artwork"
            onClick={(e) => {
              e.stopPropagation();
              setShowEditModal(true);
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground/40 hover:text-primary p-1 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
          >
            <Pencil className="size-4" />
          </motion.button>
        )}

        {isLoggedIn && extraActions}

        {isLoggedIn && onDelete && (
          <motion.button
            type="button"
            title="Xóa bài hát khỏi thư viện"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground/40 hover:text-destructive p-1 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
          >
            <Trash2 className="size-4" />
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {showEditModal && (
          <EditTrackModal
            track={track}
            onClose={() => setShowEditModal(false)}
            onUpdated={() => {
              if (onUpdate) onUpdate();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
});