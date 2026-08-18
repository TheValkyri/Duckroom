import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { motion } from "motion/react";
import { memo } from "react";
import { albumTracks, type Album } from "../data/library";
import { springSnappy, tapScale } from "../lib/motion";
import { usePlayer } from "../lib/player";

export const AlbumCard = memo(function AlbumCard({ album }: { album: Album }) {
  const { playQueue } = usePlayer();

  return (
    <motion.div whileHover={{ y: -6 }} transition={springSnappy}>
      <Link
        to="/albums/$albumId"
        params={{ albumId: album.id }}
        className="group block"
      >
        <div className="relative overflow-hidden rounded-lg">
          <motion.img
            layoutId={`cover-${album.id}`}
            src={album.cover || "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80"}
            alt={`Bìa album ${album.title}`}
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              const fallback = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80";
              if (target.src !== fallback) {
                target.src = fallback;
              }
            }}
            width={512}
            height={512}
            className="aspect-square w-full object-cover"
          />
          <div className="from-background/90 absolute inset-0 bg-gradient-to-t to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <motion.button
            onClick={(e) => {
              e.preventDefault();
              playQueue(albumTracks(album.id), 0);
            }}
            whileTap={tapScale}
            aria-label={`Phát ${album.title}`}
            className="bg-primary text-primary-foreground absolute right-3 bottom-3 grid size-11 translate-y-3 place-items-center rounded-full opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
          >
            <Play className="size-4 translate-x-px" fill="currentColor" />
          </motion.button>
        </div>
        <h3 className="font-display mt-3 text-lg leading-tight">{album.title}</h3>
        <p className="text-muted-foreground text-xs">
          {album.year} · {albumTracks(album.id).length} bài
        </p>
      </Link>
    </motion.div>
  );
});