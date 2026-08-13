import { createFileRoute, Link } from "@tanstack/react-router";
import { Disc3, Music2, Play, Shuffle, UploadCloud } from "lucide-react";
import { AlbumCard } from "../components/AlbumCard";
import { TrackRow } from "../components/TrackRow";
import { Visualizer } from "../components/Visualizer";
import { useEffect, useState } from "react";
import { useLibrary } from "../lib/useLibrary";
import { albumTracks } from "../data/library";
import { usePlayer } from "../lib/player";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Duckroom — Kho nhạc lossless riêng" },
      {
        name: "description",
        content:
          "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc: trộn bài, lặp lại, lời bài hát theo thời gian thực.",
      },
      { property: "og:title", content: "Duckroom — Kho nhạc lossless riêng" },
      {
        property: "og:description",
        content: "Nghe và lưu trữ bản thu FLAC 24-bit cùng MV bản gốc, không nén lại.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { playQueue, isPlaying } = usePlayer();
  const { tracks, albums, videos } = useLibrary();

  const hero = albums[0];
  const heroTracks = hero ? albumTracks(hero.id) : [];
  const recent = tracks.slice(0, 5);

  if (!hero || albums.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-20">
        <section className="grain border-border relative overflow-hidden rounded-2xl border bg-card/60 p-10 md:p-16">
          <div className="max-w-2xl">
            <span className="text-xs tracking-[0.35em] uppercase font-semibold">
              <span className="text-primary">Duck</span>
              <span className="text-foreground">room</span>
            </span>
            <h1 className="font-display mt-4 text-5xl md:text-6xl leading-[1.05]">
              Kho nhạc của bạn đã sẵn sàng
            </h1>
            <p className="text-muted-foreground mt-4 text-sm md:text-base leading-relaxed">
              Duckroom đã được dọn sạch tất cả dữ liệu mẫu. Hãy đưa các bản thu FLAC 24-bit, WAV hoặc MV bản gốc của bạn vào kho lưu trữ cá nhân ngay bây giờ.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/upload"
                className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03]"
              >
                <UploadCloud className="size-4" /> Tải lên nhạc & MV gốc
              </Link>
              <Link
                to="/library"
                className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors"
              >
                <Music2 className="size-4" /> Xem thư viện
              </Link>
            </div>
          </div>
        </section>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: "Hi-Res FLAC & WAV",
              desc: "Giữ nguyên 24-bit / 96kHz – 192kHz không qua bất kỳ bước transcode nén lại nào.",
              icon: Disc3,
            },
            {
              title: "MV 4K Bản Gốc",
              desc: "Xem MV chất lượng gốc ProRes & H.265 với bitrate cao nhất.",
              icon: Play,
            },
            {
              title: "Lời Bài Hát Đồng Bộ",
              desc: "Tự động cuộn lời bài hát chính xác theo thời gian thực.",
              icon: Music2,
            },
          ].map((item, i) => (
            <div key={i} className="border-border bg-card/40 rounded-xl border p-6">
              <item.icon className="text-primary size-6 mb-3" />
              <h3 className="font-display text-xl mb-1">{item.title}</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="grain relative overflow-hidden">
        <img
          src={hero.cover}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover opacity-25 blur-2xl"
        />
        <div className="from-background absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-24 md:flex-row md:items-end">
          <img
            src={hero.cover}
            alt={`Bìa album ${hero.title}`}
            width={512}
            height={512}
            className="aspect-square w-60 rounded-xl object-cover shadow-[0_40px_100px_-30px_oklch(0_0_0/0.9)] md:w-80"
          />
          <div className="flex-1">
            <p className="text-primary text-xs tracking-[0.35em] uppercase">Mới nhất</p>
            <h1 className="font-display mt-3 text-6xl leading-[0.95] md:text-7xl">{hero.title}</h1>
            <p className="text-muted-foreground mt-4 max-w-md text-sm">{hero.note}</p>
            <Visualizer playing={isPlaying} bars={36} height={40} className="mt-6 max-w-sm" />
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => playQueue(heroTracks, 0, false)}
                className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.03] cursor-pointer"
              >
                <Play className="size-4" fill="currentColor" /> Phát album
              </button>
              <button
                onClick={() => playQueue(activeTracks, 0, true)}
                className="border-border hover:bg-accent flex items-center gap-2 rounded-full border px-6 py-3 text-sm transition-colors cursor-pointer"
              >
                <Shuffle className="size-4" /> Trộn toàn bộ kho
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <SectionHead title="Albums" to="/albums" />
        <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-3">
          {activeAlbums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14">
        <SectionHead title="Nghe gần đây" to="/library" />
        <div className="mt-6">
          {recent.map((t, i) => (
            <TrackRow key={t.id} track={t} n={i + 1} onPlay={() => playQueue(recent, i)} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <SectionHead title="MV" to="/videos" />
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          {activeVideos.map((v) => (
            <Link key={v.id} to="/videos/$videoId" params={{ videoId: v.id }} className="group">
              <img
                src={v.thumb}
                alt={`Ảnh nền MV ${v.title}`}
                loading="lazy"
                width={800}
                height={456}
                className="aspect-video w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              />
              <h3 className="font-display mt-3 text-xl">{v.title}</h3>
              <p className="text-muted-foreground text-xs">
                {v.resolution} · {v.codec}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHead({ title, to }: { title: string; to: "/albums" | "/library" | "/videos" }) {
  return (
    <div className="border-border flex items-baseline justify-between border-b pb-3">
      <h2 className="font-display text-3xl">{title}</h2>
      <Link to={to} className="text-muted-foreground hover:text-primary text-xs">
        Xem tất cả
      </Link>
    </div>
  );
}
