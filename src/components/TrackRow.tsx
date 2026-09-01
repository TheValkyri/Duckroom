import { Ellipsis, Heart, Pencil, Play, Share2, Trash2, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { albumById, formatTime, type Track } from "../data/library";
import { usePlayerIsCurrent, usePlayerIsPlaying } from "../lib/player";
import { cn } from "../lib/utils";
import { EditTrackModal } from "./EditTrackModal";
import { TrackActionsSheet } from "./TrackActionsSheet";
import { useAuth } from "../lib/useAuth";
import { useMemberLibraryContext } from "../lib/member-library-context";
import { useDuckroomRole } from "../lib/useRole";
import { createAndShareLink } from "../lib/share-client";
import { springSnappy, tapScale } from "../lib/motion";
import { useIsPhoneLayout } from "../hooks/use-media-query";
import { useScrollLock } from "../hooks/use-scroll-lock";
import { toast } from "sonner";

/** Wrapper nhỏ để dùng hook trong component điều kiện (không phải TrackRow). */
function LoginPromptLock({ active }: { active: boolean }) {
  useScrollLock(active);
  return null;
}

function LiveAudioWaves() {
  return (
    <div className="flex items-end justify-center gap-[2px] size-4" aria-label="Đang phát">
      <motion.span
        animate={{ height: ["20%", "95%", "35%", "80%", "20%"] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        className="w-[2.5px] bg-primary rounded-full min-h-[3px]"
      />
      <motion.span
        animate={{ height: ["65%", "25%", "100%", "40%", "65%"] }}
        transition={{ duration: 0.65, repeat: Infinity, ease: "easeInOut", delay: 0.12 }}
        className="w-[2.5px] bg-primary rounded-full min-h-[3px]"
      />
      <motion.span
        animate={{ height: ["35%", "90%", "20%", "95%", "35%"] }}
        transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut", delay: 0.24 }}
        className="w-[2.5px] bg-primary rounded-full min-h-[3px]"
      />
    </div>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  n,
  index,
  onPlay,
  onPlayTrack,
  onDelete,
  onDeleteTrack,
  onUpdate,
  extraActions,
  showAlbum = true,
}: {
  track: Track;
  n: number;
  index?: number;
  onPlay?: () => void;
  onPlayTrack?: (track: Track, index: number) => void;
  onDelete?: () => void;
  onDeleteTrack?: (trackId: string) => void;
  onUpdate?: () => void;
  extraActions?: React.ReactNode;
  showAlbum?: boolean;
}) {
  const isCurrent = usePlayerIsCurrent(track.id);
  const isPlaying = usePlayerIsPlaying();
  const { isLoggedIn } = useAuth();
  const { favorites, toggleFavorite } = useMemberLibraryContext();
  const { isOwner } = useDuckroomRole();
  const isPhone = useIsPhoneLayout();
  const isFavorite = favorites?.has ? favorites.has(track.id) : false;
  const active = isCurrent;
  const album = albumById(track.albumId);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const handlePlayClick = useCallback(() => {
    if (onPlay) {
      onPlay();
    } else if (onPlayTrack) {
      onPlayTrack(track, index ?? n - 1);
    }
  }, [onPlay, onPlayTrack, track, index, n]);

  const handleDeleteClick = useCallback(() => {
    if (onDelete) {
      onDelete();
    } else if (onDeleteTrack) {
      onDeleteTrack(track.id);
    }
  }, [onDelete, onDeleteTrack, track.id]);

  const handleShareClick = useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      if (isLoggedIn) {
        await createAndShareLink({ resourceType: "track", resourceId: track.id, title: track.title });
      } else {
        // Guest chia sẻ chính trang hiện tại (§1.3 — share không cần link capability riêng).
        const url = window.location.href;
        if (navigator.share) {
          await navigator.share({ title: `${track.title} — ${track.artist}`, url });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          toast.success("Đã sao chép liên kết!");
        }
      }
    } catch (err) {
      console.warn("Share link error:", err);
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, isLoggedIn, track.id, track.title, track.artist]);

  const hasDelete = Boolean(onDelete || onDeleteTrack);

  return (
    <>
      {/* Perf overhaul 2026-08-25: hàng track dùng CSS thuần (hover shift +
          active scale) thay vì framer-motion. Trước đây mỗi hàng có 4-5 node
          motion → 68 bài = ~300 subscription JS chạy mỗi render của danh sách.
          CSS transform/transition được GPU composite, chi phí ~0 và vẫn mượt. */}
      <div
        className={cn(
          "group hover:bg-accent/40 flex w-full items-center gap-2 sm:gap-3 rounded-lg px-2.5 sm:px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-200 relative border border-transparent hover:border-white/5 hover:translate-x-[2px]",
          active && "bg-accent/50 border-primary/20",
        )}
      >
        {/* Accent bar trái — chỉ hiện ở hàng đang phát (CSS thuần, có lý
            do: vị trí "bài này đang phát" quét được bằng mắt khi cuộn nhanh
            qua danh sách dài; không phải trang trí). */}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_oklch(0.76_0.14_66/0.6)]"
          />
        )}
        <button onClick={handlePlayClick} className="flex flex-1 items-center gap-4 min-w-0 text-left cursor-pointer">
          <span className="text-muted-foreground grid place-items-center text-sm tabular-nums shrink-0 size-5">
            <span className="group-hover:hidden">
              {active && isPlaying ? (
                <LiveAudioWaves />
              ) : active ? (
                <Volume2 className="text-primary size-4" />
              ) : (
                n.toString().padStart(2, "0")
              )}
            </span>
            <Play className="hidden size-3.5 group-hover:block text-primary" fill="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", active && "text-primary font-semibold")}>
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
            {track.format}
            {track.bitDepth > 0 && track.sampleRate > 0 ? ` ${track.bitDepth}/${track.sampleRate}` : ""}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums shrink-0">{formatTime(track.duration)}</span>
        </button>

        {/* Favorite Button (luôn hiển thị — target 40px+) */}
        <motion.button
          type="button"
          title={isLoggedIn ? (isFavorite ? "Bỏ yêu thích" : "Thêm vào yêu thích") : "Đăng nhập để lưu yêu thích"}
          aria-label={isLoggedIn ? (isFavorite ? "Bỏ yêu thích" : "Thêm vào yêu thích") : "Đăng nhập để lưu yêu thích"}
          onClick={(e) => {
            e.stopPropagation();
            if (!isLoggedIn) {
              setShowLoginPrompt(true);
              return;
            }
            void toggleFavorite(track.id).catch((error) => console.error(error));
          }}
          whileTap={tapScale}
          transition={springSnappy}
          className={cn(
            "grid place-items-center rounded-lg transition-colors cursor-pointer shrink-0 size-11",
            isFavorite ? "text-primary" : "text-muted-foreground/40 hover:text-primary",
          )}
        >
          <Heart className="size-4" fill={isFavorite ? "currentColor" : "none"} />
        </motion.button>

        {/* ============ PHONE (<md): nút ⋯ mở TrackActionsSheet ============
            Trên cảm ứng không có hover → các nút share/edit/delete vốn
            opacity-0 group-hover:opacity-100 là KHÔNG THỂ chạm tới. Sheet
            cung cấp toàn bộ hành động với target 44px+. */}
        {isPhone && (
          <motion.button
            type="button"
            title="Thao tác khác"
            aria-label={`Thao tác với bài ${track.title}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowActionsSheet(true);
            }}
            whileTap={tapScale}
            transition={springSnappy}
            className="text-muted-foreground/60 hover:text-foreground grid size-11 place-items-center rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <Ellipsis className="size-5" />
          </motion.button>
        )}

        {/* ============ DESKTOP (>=md): hover-reveal actions (giữ nguyên) ============ */}
        {!isPhone && (
          <>
            {/* Share Button */}
            <motion.button
              type="button"
              title="Chia sẻ bài hát"
              onClick={(e) => {
                e.stopPropagation();
                void handleShareClick();
              }}
              whileTap={tapScale}
              transition={springSnappy}
              className="text-muted-foreground/40 hover:text-primary p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
            >
              <Share2 className="size-4" />
            </motion.button>

            {/* Edit Track & Artwork Button - Only for Owner */}
            {isOwner && (
              <motion.button
                type="button"
                title="Chỉnh sửa thông tin bài hát & Artwork"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEditModal(true);
                }}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground/40 hover:text-primary p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
              >
                <Pencil className="size-4" />
              </motion.button>
            )}

            {isLoggedIn && extraActions}

            {/* Delete Button - Only for Owner */}
            {isOwner && hasDelete && (
              <motion.button
                type="button"
                title="Xóa bài hát khỏi thư viện"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
                whileTap={tapScale}
                transition={springSnappy}
                className="text-muted-foreground/40 hover:text-destructive p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
              >
                <Trash2 className="size-4" />
              </motion.button>
            )}
          </>
        )}
      </div>

      {/* QoL: khoá scroll nền khi auth-gate mở */}
      <LoginPromptLock active={showLoginPrompt} />

      <AnimatePresence>
        {showLoginPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
            onClick={() => setShowLoginPrompt(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="border-border bg-card w-full max-w-sm rounded-3xl border p-7 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="size-12 rounded-2xl bg-primary/10 grid place-items-center mb-4">
                <Heart className="text-primary size-6" fill="currentColor" />
              </div>
              <h2 className="font-display text-2xl font-semibold">Lưu bài hát này?</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Đăng nhập để thêm <span className="text-foreground font-medium">"{track.title}"</span> vào kho yêu thích
                và đồng bộ bài hát giữa các thiết bị của bạn.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <Link
                  to="/login"
                  className="bg-primary text-primary-foreground rounded-full px-6 py-2.5 text-sm font-semibold shadow hover:opacity-90 transition-opacity"
                >
                  Đăng nhập
                </Link>
                <button
                  onClick={() => setShowLoginPrompt(false)}
                  className="text-muted-foreground hover:text-foreground rounded-full px-4 py-2.5 text-sm cursor-pointer"
                >
                  Để sau
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showActionsSheet && (
          <TrackActionsSheet
            open={showActionsSheet}
            onClose={() => setShowActionsSheet(false)}
            track={track}
            onPlay={handlePlayClick}
            onEdit={() => setShowEditModal(true)}
            onDelete={handleDeleteClick}
          />
        )}

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
