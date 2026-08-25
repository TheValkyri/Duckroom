import { describe, expect, it, vi } from "vitest";
import {
  analyzeImageBuffer,
  detectImageMimeFromMagicBytes,
  inferMimeFromStorageKey,
} from "../services/media-analysis/image-analyzer";
import { executeManifestMigration } from "../lib/manifest-migration.server";
import * as supabaseModule from "../lib/supabase";

describe("Blocker D â€” Artwork Asset Metadata & MIME Non-Fabrication", () => {
  describe("1. Binary Magic Bytes MIME Detection", () => {
    it("detects genuine JPEG magic bytes (FF D8 FF)", () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      expect(detectImageMimeFromMagicBytes(jpegBytes)).toBe("image/jpeg");
    });

    it("detects genuine PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(detectImageMimeFromMagicBytes(pngBytes)).toBe("image/png");
    });

    it("detects genuine WebP magic bytes (RIFF....WEBP)", () => {
      const webpBytes = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x20,
        0x00,
        0x00,
        0x00, // size
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      expect(detectImageMimeFromMagicBytes(webpBytes)).toBe("image/webp");
    });

    it("detects genuine AVIF magic bytes (....ftypavif)", () => {
      const avifBytes = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x1c,
        0x66,
        0x74,
        0x79,
        0x70, // ftyp
        0x61,
        0x76,
        0x69,
        0x66, // avif
      ]);
      expect(detectImageMimeFromMagicBytes(avifBytes)).toBe("image/avif");
    });

    it("detects genuine SVG text header", () => {
      const svgStr = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'></svg>";
      const svgBytes = new TextEncoder().encode(svgStr);
      expect(detectImageMimeFromMagicBytes(svgBytes)).toBe("image/svg+xml");
    });

    it("strictly rejects spoofed extensions (e.g. plain text or random binary named .jpg)", async () => {
      const fakeJpeg = new TextEncoder().encode("This is not a JPEG, just plain text");
      expect(detectImageMimeFromMagicBytes(fakeJpeg)).toBeNull();

      await expect(analyzeImageBuffer(fakeJpeg)).rejects.toThrow(/unsupported image binary magic bytes/);
    });

    it("returns null for unknown format or corrupt bytes", () => {
      const randomGarbage = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      expect(detectImageMimeFromMagicBytes(randomGarbage)).toBeNull();
    });
  });

  describe("2. Storage Key Extension Fallback Inference", () => {
    it("correctly maps supported extensions without defaulting everything to JPEG", () => {
      expect(inferMimeFromStorageKey("artwork/cover.png")).toBe("image/png");
      expect(inferMimeFromStorageKey("artwork/cover.webp")).toBe("image/webp");
      expect(inferMimeFromStorageKey("artwork/cover.avif")).toBe("image/avif");
      expect(inferMimeFromStorageKey("artwork/cover.gif")).toBe("image/gif");
      expect(inferMimeFromStorageKey("artwork/cover.svg")).toBe("image/svg+xml");
      expect(inferMimeFromStorageKey("artwork/cover.jpg")).toBe("image/jpeg");
      expect(inferMimeFromStorageKey("artwork/cover.jpeg")).toBe("image/jpeg");
      expect(inferMimeFromStorageKey("artwork/unknown.bin")).toBeNull();
      expect(inferMimeFromStorageKey("artwork/rawfile")).toBeNull();
    });
  });

  describe("3. Manifest Migration Artwork Asset Creation", () => {
    it("creates artwork_assets with appropriate MIME mapping without blind JPEG assumptions", async () => {
      let insertedArtworkAssets: any[] = [];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "migration_markers") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          if (table === "artwork_assets") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[]) => {
                insertedArtworkAssets = rows;
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "albums") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "album-art-1", cover_storage_key: "artwork/album-art-1/cover.png" }],
                error: null,
              }),
            };
          }
          if (table === "videos") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "video-art-1", storage_key: "video/video-art-1/master.mp4" }],
                error: null,
              }),
            };
          }
          if (table === "artists") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "artist-1", normalized_name: "test artist" }],
                error: null,
              }),
            };
          }
          if (table === "audit_logs") {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const manifestData = {
        libraryVersion: "2026.08.26",
        albums: [
          {
            id: "album-art-1",
            title: "Album Art Test",
            artist: "Test Artist",
            year: 2024,
            cover: "artwork/album-art-1/cover.png", // PNG cover
          },
        ],
        tracks: [],
        videos: [
          {
            id: "video-art-1",
            title: "Video Art Test",
            artist: "Test Artist",
            year: 2024,
            thumb: "artwork/video-art-1/thumb.webp", // WebP thumb
            duration: 120,
            src: "video/video-art-1/master.mp4",
          },
        ],
      };

      const res = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(res.success).toBe(true);

      expect(insertedArtworkAssets).toHaveLength(2);
      const pngAsset = insertedArtworkAssets.find((a) => a.master_storage_key.endsWith(".png"));
      const webpAsset = insertedArtworkAssets.find((a) => a.master_storage_key.endsWith(".webp"));

      expect(pngAsset).toBeDefined();
      expect(pngAsset.mime_type).toBe("image/png"); // NOT image/jpeg!

      expect(webpAsset).toBeDefined();
      expect(webpAsset.mime_type).toBe("image/webp"); // NOT image/jpeg!
    });
  });
});
