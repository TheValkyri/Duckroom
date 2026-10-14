import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface AmbientLayer {
  id: string;
  cover: string;
  accent: string;
}

export function AmbientCrossfadeBackground({ cover, accent }: { cover: string; accent?: string | undefined }) {
  const currentAccent = accent || "oklch(0.3 0.1 260)";
  const [layers, setLayers] = useState<AmbientLayer[]>([{ id: `init-${cover}`, cover, accent: currentAccent }]);
  const activeRef = useRef({ cover, accent: currentAccent });

  useEffect(() => {
    if (activeRef.current.cover === cover && activeRef.current.accent === currentAccent) {
      return;
    }
    const prevCover = activeRef.current.cover;
    const prevAccent = activeRef.current.accent;
    activeRef.current = { cover, accent: currentAccent };

    const nextId = `layer-${cover}-${Date.now()}`;
    setLayers([
      { id: `prev-${prevCover}`, cover: prevCover, accent: prevAccent },
      { id: nextId, cover, accent: currentAccent },
    ]);

    const timer = setTimeout(() => {
      setLayers([{ id: nextId, cover, accent: currentAccent }]);
    }, 650);

    return () => clearTimeout(timer);
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
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity" }}
            className="absolute inset-0 size-full transform-gpu"
          >
            {/* Dynamic Ambient Breathing Orbs: Dual diffused glowing orbs */}
            <motion.div
              animate={{
                scale: [1, 1.1, 0.96, 1],
                x: [0, 20, -15, 0],
                y: [0, -18, 10, 0],
              }}
              transition={{
                duration: 14,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute -top-[12%] -left-[10%] w-[90vw] h-[90vh] rounded-full opacity-45 pointer-events-none transform-gpu blur-[40px] md:blur-[80px]"
              style={{
                background: `radial-gradient(circle at 40% 40%, ${layer.accent} 0%, transparent 68%)`,
              }}
            />

            <motion.div
              animate={{
                scale: [1, 0.94, 1.08, 1],
                x: [0, -22, 16, 0],
                y: [0, 16, -12, 0],
              }}
              transition={{
                duration: 18,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute -bottom-[15%] -right-[10%] w-[85vw] h-[85vh] rounded-full opacity-35 pointer-events-none transform-gpu blur-[40px] md:blur-[80px]"
              style={{
                background: `radial-gradient(circle at 60% 60%, ${layer.accent} 0%, transparent 65%)`,
              }}
            />

            {/* Soft blurred artwork aura — PERF: blur-3xl desktop only */}
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
