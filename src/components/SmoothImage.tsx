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
  fallbackSrc = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80",
  containerClassName,
  ...props
}: SmoothImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const finalSrc = error ? fallbackSrc : (src || fallbackSrc);

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
          className
        )}
        {...props}
      />
    </div>
  );
}
