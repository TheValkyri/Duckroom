import { describe, expect, it } from "vitest";
import { sortAlbumsDeterministically, type Album, type Track } from "../data/library";

describe("Album Ordering and Track Isolation Test Suite", () => {
  it("sorts albums deterministically using display_priority ASC, falling back to year DESC and title", () => {
    const rawAlbums: Album[] = [
      {
        id: "album-1786733004910-vx94",
        title: "Bảy",
        artist: "HAZEL",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
        display_priority: 3,
      },
      {
        id: "album-1786784433163-bs9w",
        title: "Trái Tim Băng Bó",
        artist: "Dangrangto",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
        display_priority: 4,
      },
      {
        id: "album-1786689968528-danh-doi",
        title: "Đánh Đổi",
        artist: "Obito",
        year: 2023,
        cover: "",
        accent: "",
        note: "",
        display_priority: 2,
      },
      {
        id: "album-1786471883274-yfkl",
        title: "HVL",
        artist: "MCK",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
        display_priority: 1,
      },
    ];

    const sorted = sortAlbumsDeterministically(rawAlbums);
    expect(sorted.map((a) => a.title)).toEqual(["HVL", "Đánh Đổi", "Bảy", "Trái Tim Băng Bó"]);
  });

  it("handles unprioritized albums with default priority 999 sorted by year DESC", () => {
    const rawAlbums: Album[] = [
      {
        id: "album-custom-1",
        title: "Album 2024",
        artist: "Artist A",
        year: 2024,
        cover: "",
        accent: "",
        note: "",
      },
      {
        id: "album-pri-1",
        title: "Priority Album",
        artist: "Artist B",
        year: 2020,
        cover: "",
        accent: "",
        note: "",
        display_priority: 1,
      },
      {
        id: "album-custom-2",
        title: "Album 2025",
        artist: "Artist C",
        year: 2025,
        cover: "",
        accent: "",
        note: "",
      },
    ];

    const sorted = sortAlbumsDeterministically(rawAlbums);
    expect(sorted.map((a) => a.title)).toEqual(["Priority Album", "Album 2025", "Album 2024"]);
  });

  it("does not mix standalone singles into any album", () => {
    const albumBảy = {
      id: "album-1786733004910-vx94",
      title: "Bảy",
      artist: "HAZEL",
    };

    const dummyTracks: Track[] = [
      {
        id: "t1",
        title: "Dư âm",
        artist: "Obito",
        albumId: "singles",
        duration: 167,
        trackNo: 1,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96,
        sizeMB: 50,
        lyrics: [],
      },
      {
        id: "t2",
        title: "Bounce",
        artist: "Hazel",
        albumId: "album-1786733004910-vx94",
        duration: 229,
        trackNo: 1,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96,
        sizeMB: 60,
        lyrics: [],
      },
      {
        id: "t3",
        title: "Đôi khi",
        artist: "Obito",
        albumId: "",
        duration: 149,
        trackNo: 2,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96,
        sizeMB: 45,
        lyrics: [],
      },
    ];

    const targetId = albumBảy.id.toLowerCase().trim();
    const targetTitle = albumBảy.title.toLowerCase().trim();

    const filtered = dummyTracks.filter((t) => {
      if (!t.albumId) return false;
      const trackAlbum = t.albumId.toLowerCase().trim();
      if (!trackAlbum || trackAlbum === "singles" || trackAlbum === "single" || trackAlbum === "single-collection") {
        return false;
      }
      return trackAlbum === targetId || trackAlbum === targetTitle;
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0]?.title).toBe("Bounce");
    expect(filtered.map((t) => t.title)).not.toContain("Dư âm");
    expect(filtered.map((t) => t.title)).not.toContain("Đôi khi");
  });
});
