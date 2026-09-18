import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

interface AmbientLayer {
  id: string;
  cover: string;
  accent: string;
}

export function AmbientCrossfadeBackground({ cover, accent }: { cover: string; accent?: string | undefined }) {
  const currentAccent = accent || "oklch(0.3 0.1 260)";
  const [layers, setLayers] = useState<AmbientLayer[]>([{ id: `init-${cover}`, cover, accent: currentAccent }]);

  useEffect(() => {
    setLayers((prev) => {
      const active = prev[prev.length - 1];
      if (active && active.cover === cover && active.accent === currentAccent) {
        return prev;
      }
      return [
        { id: active?.id || "prev", cover: active?.cover || cover, accent: active?.accent || currentAccent },
        { id: `layer-${cover}-${Date.now()}`, cover, accent: currentAccent },
      ];
    });
  }, [cover, currentAccent]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden select-none -z-10 bg-background">
      <AnimatePresence>
        {layers.map((layer) => (
          <motion.div
            key={layer.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity" }}
            className="absolute inset-0 size-full transform-gpu"
          >
            {/* Dynamic radial color glow */}
            <div
              className="absolute inset-0 opacity-45"
              style={{
                background: `radial-gradient(120% 90% at 50% 30%, ${layer.accent} 0%, transparent 68%)`,
              }}
            />
            {/* Soft blurred artwork aura — PERF 2026-09-01: blur-3xl (64px)
                full-screen trên phone là 1 trong những thứ đắt nhất GPU có
                thể vẽ, MUST re-composite khi có bất kỳ layer nào đè lên.
                Phone: chỉ radial accent (đã vẽ ở trên) + opacity artwork
                mờ, không blur. Desktop ≥md giữ blur đậm (đẹp, và GPU
                desktop chịu được). */}
            <img
              src={layer.cover}
              alt=""
              aria-hidden
              decoding="async"
              className="absolute inset-0 size-full scale-125 object-cover opacity-15 transform-gpu blur-none md:blur-3xl"
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {/* Cinematic vignette */}
      <div className="from-background/90 via-transparent to-background/80 absolute inset-0 bg-gradient-to-t pointer-events-none" />
    </div>
  );
}
