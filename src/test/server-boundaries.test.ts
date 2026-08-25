import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import * as s3Functions from "../lib/s3-functions";
import * as supabaseModule from "../lib/supabase";
import { validateVisualAssetKey } from "../lib/auth-guard";

describe("Server Security Boundaries & Failure Safety", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_ENDPOINT: "https://s3.test.local",
      S3_REGION: "us-east-1",
      S3_BUCKET_NAME: "test-bucket",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("S3 Visual Asset vs Master Binary Boundary", () => {
    it("allows valid visual image keys to pass visual asset validation", () => {
      expect(() => validateVisualAssetKey("artworks/cover-123.jpg")).not.toThrow();
      expect(() => validateVisualAssetKey("covers/album-art.webp")).not.toThrow();
      expect(() => validateVisualAssetKey("thumbnails/thumb.png")).not.toThrow();
    });

    it("strictly rejects master audio and video keys from visual asset signing", () => {
      expect(() => validateVisualAssetKey("audio/song-123/master.flac")).toThrow(
        /not in an authorized visual asset namespace/i,
      );
      expect(() => validateVisualAssetKey("singles/song-123.wav")).toThrow(
        /not in an authorized visual asset namespace/i,
      );
      expect(() => validateVisualAssetKey("videos/mv-123.mp4")).toThrow(/not in an authorized visual asset namespace/i);
      expect(() => validateVisualAssetKey("library_manifest.json")).toThrow(
        /not in an authorized visual asset namespace/i,
      );
    });
  });

  describe("Domain Resource Resolvers (No Raw Client Key Signing)", () => {
    it("rejects artwork resolution for non-existent track with 404", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(s3Functions.getTrackArtworkUrlInternal("nonexistent-track", "guest")).rejects.toThrow(
        /RESOURCE_NOT_FOUND|Track not found/,
      );
    });

    it("rejects artwork resolution for owner-only track requested by guest with 403", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "secret-track", cover_storage_key: "artworks/secret.jpg", visibility: "owner" },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(s3Functions.getTrackArtworkUrlInternal("secret-track", "guest")).rejects.toThrow(
        /FORBIDDEN|Owner-only track artwork/,
      );
    });

    it("signs artwork URL for authorized public track with valid storage key", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "public-track", cover_storage_key: "artworks/cover.jpg", visibility: "public" },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const res = await s3Functions.getTrackArtworkUrlInternal("public-track", "guest");

      expect(res.assetUrl).toBeDefined();
      expect(res.expiresIn).toBe(900);
    });

    it("rejects playback URL for owner-only track requested by regular member", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "vault-track", storage_key: "audio/vault-track/master.flac", visibility: "owner" },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      await expect(s3Functions.getTrackPlaybackUrlInternal("vault-track", "member")).rejects.toThrow(
        /FORBIDDEN|Owner-only track/,
      );
    });
  });

  describe("Destructive Operations Failure Safety (deleteTrackDomainServer)", () => {
    it("preserves database record and fails closed when S3 binary deletion fails", async () => {
      const mockDbDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "track-precious-1" }, error: null }),
          }),
        }),
      });
      const mockDebtUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-precious-1",
                      title: "Valuable Master",
                      storage_key: "audio/track-precious-1/master.flac",
                      cover_storage_key: "artworks/cover.jpg",
                      version: 3,
                    },
                    error: null,
                  }),
                }),
              }),
              delete: () => ({ eq: mockDbDelete }),
            };
          }
          if (table === "storage_cleanup_debts") {
            return {
              insert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "debt-1" }, error: null }),
                }),
              }),
              update: mockDebtUpdate,
            };
          }
          return { insert: vi.fn() };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Mock S3 send on S3Client prototype to simulate S3 failure
      const mockS3Send = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("S3 Network Error 500"));

      // Directly invoke domain function
      await expect(s3Functions.deleteTrackDomainInternal("track-precious-1", 3, "owner-1")).rejects.toThrow(
        /S3 cleanup failed.*DB deletion is committed/i,
      );

      expect(mockS3Send).toHaveBeenCalled();
      // DB deletion is intentionally committed before S3 cleanup; a durable cleanup debt records the orphan.
      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDebtUpdate).toHaveBeenCalled();
    });

    it("successfully removes database row and logs audit when S3 binary deletion succeeds", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "track-ok-1" }, error: null });
      const mockAuditInsert = vi.fn().mockResolvedValue({ error: null });
      const mockDebtUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "tracks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "track-ok-1",
                      title: "Track to delete",
                      storage_key: "audio/track-ok-1/master.flac",
                      cover_storage_key: "artworks/cover.jpg",
                    },
                    error: null,
                  }),
                }),
              }),
              delete: () => ({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: () => ({
                      maybeSingle: mockMaybeSingle,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "storage_cleanup_debts") {
            return {
              insert: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "debt-2" }, error: null }),
                }),
              }),
              update: mockDebtUpdate,
            };
          }
          if (table === "audit_logs") {
            return { insert: mockAuditInsert };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const mockS3Send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as any);

      const result = await s3Functions.deleteTrackDomainInternal("track-ok-1", 1, "owner-1");

      expect(result).toEqual({ success: true, trackId: "track-ok-1" });
      expect(mockS3Send).toHaveBeenCalled();
      expect(mockMaybeSingle).toHaveBeenCalled();
      expect(mockAuditInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "track.delete",
          resource_id: "track-ok-1",
        }),
      );
    });
  });

  describe("Manifest Structured Error Handling", () => {
    it("throws MANIFEST_NOT_FOUND when manifest does not exist in S3 (404 / NoSuchKey)", async () => {
      const notFoundErr = new Error("The specified key does not exist.");
      (notFoundErr as any).name = "NoSuchKey";
      vi.spyOn(S3Client.prototype, "send").mockRejectedValue(notFoundErr);

      await expect(s3Functions.getLibraryManifestInternal()).rejects.toThrow(/MANIFEST_NOT_FOUND/);
    });

    it("throws STORAGE_UNAVAILABLE when S3 infrastructure/network fails", async () => {
      vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("Connection refused to S3"));

      await expect(s3Functions.getLibraryManifestInternal()).rejects.toThrow(/STORAGE_UNAVAILABLE/);
    });

    it("throws MANIFEST_CORRUPT when manifest JSON is invalid", async () => {
      vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
        Body: {
          transformToString: vi.fn().mockResolvedValue("{ invalid json syntax ..."),
        },
      } as any);

      await expect(s3Functions.getLibraryManifestInternal()).rejects.toThrow(/MANIFEST_CORRUPT/);
    });

    it("successfully parses and returns manifest when valid", async () => {
      const mockManifest = { version: "2.0", tracks: [], albums: [], videos: [] };
      vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
        Body: {
          transformToString: vi.fn().mockResolvedValue(JSON.stringify(mockManifest)),
        },
      } as any);

      const result = await s3Functions.getLibraryManifestInternal();
      expect(result).toEqual(mockManifest);
    });
  });
});
