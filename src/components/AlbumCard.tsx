import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { motion } from "motion/react";
import { albumTracks, type Album } from "../data/library";
import { usePlayer } from "../lib/player";

export function AlbumCard({ album }: { album: Album }) {
  const { playQueue } = usePlayer();

  return (
    <motion.div whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
      <Link
        to="/albums/$albumId"
        params={{ albumId: album.id }}
        className="group block"
      >
        <div className="relative overflow-hidden rounded-lg">
          <motion.img
            layoutId={`cover-${album.id}`}
            src={album.cover}
            alt={`Bìa album ${album.title}`}
            loading="lazy"
            width={512}
            height={512}
            className="aspect-square w-full object-cover"
          />
          <div className="from-background/90 absolute inset-0 bg-gradient-to-t to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <button
            onClick={(e) => {
              e.preventDefault();
              playQueue(albumTracks(album.id), 0);
            }}
            aria-label={`Phát ${album.title}`}
            className="bg-primary text-primary-foreground absolute right-3 bottom-3 grid size-11 translate-y-3 place-items-center rounded-full opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
          >
            <Play className="size-4 translate-x-px" fill="currentColor" />
          </button>
        </div>
        <h3 className="font-display mt-3 text-lg leading-tight">{album.title}</h3>
        <p className="text-muted-foreground text-xs">
          {album.year} · {albumTracks(album.id).length} bài
        </p>
      </Link>
    </motion.div>
  );
}