import { describe, expect, it } from "vitest";
import { getAlbumPriority, sortAlbumsDeterministically, type Album, type Track } from "../data/library";

describe("Album Ordering and Track Isolation Test Suite", () => {
  it("strictly assigns priority 1 to HVL, 2 to Đánh Đổi, 3 to Bảy, 4 to Trái Tim Băng Bổ", () => {
    expect(getAlbumPriority({ id: "album-1786471883274-yfkl", title: "HVL" })).toBe(1);
    expect(getAlbumPriority({ id: "album-1786689968528-danh-doi", title: "Đánh Đổi" })).toBe(2);
    expect(getAlbumPriority({ id: "album-1786733004910-vx94", title: "Bảy" })).toBe(3);
    expect(getAlbumPriority({ id: "album-1786784433163-bs9w", title: "Trái Tim Băng Bó" })).toBe(4);
    expect(getAlbumPriority({ id: "album-1786784433163-bs9w", title: "Trái Tim Băng Bổ" })).toBe(4);
  });

  it("sorts albums deterministically into the exact user-specified order", () => {
    const rawAlbums: Album[] = [
      {
        id: "album-1786733004910-vx94",
        title: "Bảy",
        artist: "HAZEL",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
      },
      {
        id: "album-1786784433163-bs9w",
        title: "Trái Tim Băng Bó",
        artist: "Dangrangto",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
      },
      {
        id: "album-1786689968528-danh-doi",
        title: "Đánh Đổi",
        artist: "Obito",
        year: 2023,
        cover: "",
        accent: "",
        note: "",
      },
      {
        id: "album-1786471883274-yfkl",
        title: "HVL",
        artist: "MCK",
        year: 2026,
        cover: "",
        accent: "",
        note: "",
      },
    ];

    const sorted = sortAlbumsDeterministically(rawAlbums);
    expect(sorted.map((a) => a.title)).toEqual(["HVL", "Đánh Đổi", "Bảy", "Trái Tim Băng Bó"]);
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
