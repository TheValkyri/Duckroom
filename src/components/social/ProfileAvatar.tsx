import { useMemo } from "react";
import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { cn } from "../../lib/utils";

export interface ProfileAvatarProps {
  src?: string | null | undefined;
  name?: string | null | undefined;
  handle?: string | null | undefined;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | undefined;
  className?: string | undefined;
  fallbackClassName?: string | undefined;
  alt?: string | undefined;
}

const sizeClasses = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-lg",
  xl: "size-24 text-2xl font-bold",
};

export function ProfileAvatar({
  src,
  name,
  handle,
  size = "md",
  className,
  fallbackClassName,
  alt,
}: ProfileAvatarProps) {
  const initials = useMemo(() => {
    const raw = (name || handle || "").trim();
    if (!raw) return "";
    const clean = raw.replace(/^@/, "").trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }, [name, handle]);

  return (
    <Avatar
      className={cn(
        "relative shrink-0 border border-white/10 bg-card/60 shadow-sm transition-transform duration-200",
        sizeClasses[size],
        className,
      )}
    >
      {src && (
        <AvatarImage
          src={src}
          alt={alt || name || handle || "Avatar"}
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarFallback
        className={cn(
          "flex size-full items-center justify-center bg-gradient-to-br from-primary/25 to-primary/10 font-semibold text-primary select-none",
          fallbackClassName,
        )}
      >
        {initials || <User className="size-1/2 opacity-70" />}
      </AvatarFallback>
    </Avatar>
  );
}
