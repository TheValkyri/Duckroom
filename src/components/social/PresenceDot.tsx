import { Headphones, Pause } from "lucide-react";
import type { SocialPresenceStatus } from "../../lib/social/social-types";
import { cn } from "../../lib/utils";

export interface PresenceDotProps {
  status: SocialPresenceStatus;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showText?: boolean;
  showIcon?: boolean;
}

const sizeClasses = {
  xs: "size-2",
  sm: "size-2.5",
  md: "size-3",
  lg: "size-3.5",
};

const statusLabels: Record<SocialPresenceStatus, string> = {
  listening: "Đang nghe",
  paused: "Đang tạm dừng",
  online: "Đang online",
  offline: "Offline",
};

export function PresenceDot({ status, size = "sm", className, showText = false, showIcon = false }: PresenceDotProps) {
  const dotSize = sizeClasses[size];

  const renderDot = () => {
    switch (status) {
      case "listening":
        return (
          <span className="relative flex items-center justify-center">
            <span
              className={cn(
                "absolute inline-flex rounded-full bg-emerald-400 opacity-75 animate-ping motion-reduce:animate-none",
                dotSize,
              )}
            />
            <span
              className={cn(
                "relative inline-flex rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
                dotSize,
              )}
            />
          </span>
        );
      case "paused":
        return (
          <span
            className={cn("inline-flex rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]", dotSize)}
          />
        );
      case "online":
        return (
          <span className={cn("inline-flex rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.5)]", dotSize)} />
        );
      case "offline":
      default:
        return <span className={cn("inline-flex rounded-full bg-zinc-600/70 border border-white/10", dotSize)} />;
    }
  };

  const renderIcon = () => {
    if (!showIcon) return null;
    if (status === "listening") {
      return <Headphones className="size-3.5 text-emerald-400 animate-pulse motion-reduce:animate-none shrink-0" />;
    }
    if (status === "paused") {
      return <Pause className="size-3.5 text-amber-400 shrink-0" />;
    }
    return null;
  };

  const getTextColor = () => {
    switch (status) {
      case "listening":
        return "text-emerald-400";
      case "paused":
        return "text-amber-400";
      case "online":
        return "text-sky-400";
      case "offline":
      default:
        return "text-muted-foreground";
    }
  };

  if (!showText && !showIcon) {
    return (
      <span
        title={statusLabels[status]}
        aria-label={statusLabels[status]}
        className={cn("inline-flex items-center justify-center shrink-0", className)}
      >
        {renderDot()}
      </span>
    );
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", getTextColor(), className)}
      title={statusLabels[status]}
    >
      {renderDot()}
      {renderIcon()}
      {showText && <span>{statusLabels[status]}</span>}
    </div>
  );
}
