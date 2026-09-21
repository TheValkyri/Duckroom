import { describe, expect, it, vi, beforeEach } from "vitest";
import * as libraryData from "../data/library";
import * as albumMutations from "../lib/domain-mutations/album-mutations";
import * as s3Module from "../lib/s3";
import { sanitizeStorageKeySegment } from "../lib/s3-key";

describe("Album Artwork Resilience & Key Sanitization Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("sanitizeStorageKeySegment for Album & Track artwork", () => {
    it("sanitizes complex unicode titles with accents, parentheses, and spaces", () => {
      const input = "3 (tuyển tập nhạc Ngọt mới trẻ sôi động 2019)";
      const sanitized = sanitizeStorageKeySegment(input);
      expect(sanitized).toBe("3-tuyen-tap-nhac-ngot-moi-tre-soi-dong-2019");
      expect(sanitized).not.toContain(" ");
      expect(sanitized).not.toContain("(");
      expect(sanitized).not.toContain(")");
      expect(sanitized).not.toMatch(/[^\x00-\x7F]/); // Strictly ASCII
    });

    it("sanitizes special characters and slashes", () => {
      const input = "Album / Special * Name ?? 2026";
      const sanitized = sanitizeStorageKeySegment(input);
      expect(sanitized).toBe("album-special-name-2026");
    });
  });

  describe("createAlbum cover handling (client memory safety)", () => {
    it("never stores raw relative S3 storage key into album.cover", async () => {
      vi.spyOn(albumMutations, "createAlbumDomainServer").mockResolvedValue({
        id: "album-safe-1",
        title: "Album Safe",
        artist: "Artist Safe",
        year: 2026,
        cover_storage_key: "artwork/album-12345-test.jpg",
        accent: "oklch(0.6 0.1 200)",
        note: "",
        display_priority: 999,
        version: 1,
        status: "active",
        updated_at: new Date().toISOString(),
      } as any);

      vi.spyOn(s3Module, "fetchAlbumArtworkUrl").mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("https://s3.pikamc.vn/signed-art.jpg"), 20)),
      );

      const album = await libraryData.createAlbum({
        title: "Album Safe",
        artist: "Artist Safe",
        year: 2026,
        cover: "artwork/album-12345-test.jpg",
        previewUrl: "data:image/jpeg;base64,mockpreview",
      });

      // Must be preview URL initially, never the relative storage key "artwork/..."
      expect(album.cover).toBe("data:image/jpeg;base64,mockpreview");
      expect(album.cover).not.toBe("artwork/album-12345-test.jpg");

      // Wait for delayed fetchAlbumArtworkUrl promise
      await new Promise((r) => setTimeout(r, 40));

      // After background resolution, updates to signed presigned URL
      expect(album.cover).toBe("https://s3.pikamc.vn/signed-art.jpg");
    });

    it("uses server-provided cover_url immediately when returned", async () => {
      vi.spyOn(albumMutations, "createAlbumDomainServer").mockResolvedValue({
        id: "album-safe-2",
        title: "Album Safe 2",
        artist: "Artist Safe",
        year: 2026,
        cover_storage_key: "artwork/album-67890-test.jpg",
        cover_url: "https://s3.pikamc.vn/presigned-immediate.jpg",
        accent: "oklch(0.6 0.1 200)",
        note: "",
        display_priority: 999,
        version: 1,
        status: "active",
        updated_at: new Date().toISOString(),
      } as any);

      const album = await libraryData.createAlbum({
        title: "Album Safe 2",
        artist: "Artist Safe",
        year: 2026,
        cover: "artwork/album-67890-test.jpg",
      });

      expect(album.cover).toBe("https://s3.pikamc.vn/presigned-immediate.jpg");
    });
  });

  describe("updateAlbum cover handling", () => {
    it("updates album cover using previewUrl and resolves signed URL", async () => {
      libraryData.albums.length = 0;
      const initialAlbum: libraryData.Album = {
        id: "album-up-1",
        title: "Initial Album",
        artist: "Artist",
        year: 2025,
        cover: "https://s3.pikamc.vn/old-cover.jpg",
        accent: "",
        note: "",
        display_priority: 999,
        version: 1,
      };
      libraryData.albums.push(initialAlbum);

      vi.spyOn(albumMutations, "updateAlbumDomainServer").mockResolvedValue({
        id: "album-up-1",
        title: "Updated Album",
        artist: "Artist",
        year: 2025,
        cover_storage_key: "artwork/new-art.jpg",
        accent: "",
        note: "",
        display_priority: 999,
        version: 2,
        status: "active",
        updated_at: new Date().toISOString(),
      } as any);

      vi.spyOn(s3Module, "fetchAlbumArtworkUrl").mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("https://s3.pikamc.vn/new-signed.jpg"), 20)),
      );

      const updated = await libraryData.updateAlbum("album-up-1", {
        expectedVersion: 1,
        title: "Updated Album",
        cover: "artwork/new-art.jpg",
        previewUrl: "blob:http://localhost/new-preview-blob",
      });

      expect(updated.cover).toBe("blob:http://localhost/new-preview-blob");

      await new Promise((r) => setTimeout(r, 40));

      expect(updated.cover).toBe("https://s3.pikamc.vn/new-signed.jpg");
    });
  });
});
