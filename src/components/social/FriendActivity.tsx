import { Disc3, Lock, Music2 } from "lucide-react";
import { useFriendPresence, useFriendProgress } from "../../lib/social/social-store";
import { PresenceDot } from "./PresenceDot";
import { cn } from "../../lib/utils";

export interface FriendActivityProps {
  userId: string;
  className?: string;
  compact?: boolean;
}

function FriendProgressBar({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const { percent, formattedCurrent, formattedDuration } = useFriendProgress(userId);

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5 w-full pt-1">
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-primary/90 transition-all duration-300 rounded-full"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[9px] text-muted-foreground font-mono">
          <span>{formattedCurrent}</span>
          <span>{formattedDuration}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full pt-1.5">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-primary/90 transition-all duration-300 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
        <span>{formattedCurrent}</span>
        <span>{formattedDuration}</span>
      </div>
    </div>
  );
}

export function FriendActivity({ userId, className, compact = false }: FriendActivityProps) {
  const presence = useFriendPresence(userId);
  const status = presence?.status || "offline";
  const activity = presence?.activity;
  const isListening = status === "listening" || status === "paused";

  if (!presence || status === "offline") {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <PresenceDot status="offline" size="sm" showText />
      </div>
    );
  }

  if (status === "online" || !activity) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-sky-400 font-medium", className)}>
        <PresenceDot status="online" size="sm" showText />
      </div>
    );
  }

  // Private media fallback (§16)
  if (presence.isPrivateMedia) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5 text-xs text-muted-foreground border border-white/5",
          className,
        )}
      >
        <div className="grid size-8 place-items-center rounded-lg bg-white/10 text-muted-foreground shrink-0">
          <Lock className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <PresenceDot status={status} size="xs" showText className="mb-0.5" />
          <p className="truncate font-medium text-foreground text-xs">Đang nghe một nội dung riêng tư</p>
        </div>
      </div>
    );
  }

  const title = presence.trackTitle || "Đang phát nhạc";
  const artist = presence.artistName || "Nghệ sĩ";
  const album = presence.albumTitle;
  const cover = presence.coverUrl;

  if (compact) {
    return (
      <div className={cn("flex flex-col gap-1 text-xs", className)}>
        <div className="flex items-center gap-1.5">
          <PresenceDot status={status} size="xs" showText />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {cover ? (
            <img src={cover} alt={title} className="size-7 rounded-md object-cover shrink-0" />
          ) : (
            <div className="grid size-7 place-items-center rounded-md bg-white/10 text-primary shrink-0">
              <Disc3 className="size-4 animate-spin-slow motion-reduce:animate-none" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground text-xs leading-snug">{title}</p>
            <p className="truncate text-[11px] text-muted-foreground">{artist}</p>
          </div>
        </div>
        <FriendProgressBar userId={userId} compact />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl bg-card/60 border border-white/10 p-3 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <PresenceDot status={status} size="sm" showText showIcon />
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-white/5 border border-white/10 shadow-sm">
          {cover ? (
            <img src={cover} alt={title} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-primary/80">
              <Music2 className="size-6" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={artist}>
            {artist}
            {album ? ` · ${album}` : ""}
          </p>
        </div>
      </div>

      <FriendProgressBar userId={userId} />
    </div>
  );
}
