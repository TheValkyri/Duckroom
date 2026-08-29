import { useState } from "react";
import { cn } from "../lib/utils";

interface SmoothImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string;
  containerClassName?: string;
}

export function SmoothImage({
  src,
  alt,
  className,
  fallbackSrc = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='456'%3E%3Crect width='800' height='456' fill='%2318181b'/%3E%3C/svg%3E",
  containerClassName,
  ...props
}: SmoothImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const finalSrc = error ? fallbackSrc : src || fallbackSrc;

  return (
    <div className={cn("relative overflow-hidden bg-muted/40", containerClassName)}>
      {/* Subtle glass shimmer placeholder before loaded */}
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
      )}
      <img
        src={finalSrc}
        alt={alt || ""}
        decoding="async"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (!error) {
            setError(true);
            setLoaded(true);
          }
        }}
        className={cn(
          "size-full object-cover transition-all duration-500 ease-out",
          loaded ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-[0.98] blur-[2px]",
          className,
        )}
        {...props}
      />
    </div>
  );
}
