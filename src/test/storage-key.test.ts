import { describe, expect, it } from "vitest";
import { validateStorageKey, validateVisualAssetKey } from "../lib/auth-guard";

describe("Storage Key Validation & Security Guard", () => {
  it("allows canonical V2 storage keys in both read and write mode", () => {
    expect(() => validateStorageKey("audio/track-123/master.flac", "write")).not.toThrow();
    expect(() => validateStorageKey("video/mv-456/master.mp4", "write")).not.toThrow();
    expect(() => validateStorageKey("artwork/art-789/master.jpg", "write")).not.toThrow();
    expect(() => validateStorageKey("temp/upload-sessions/session-123/media.flac", "write")).not.toThrow();
  });

  it("strictly REJECTS legacy prefixes for new writes (enforces canonical write contracts)", () => {
    expect(() => validateStorageKey("singles/01-1234-song.flac", "write")).toThrow(/Write rejected/);
    expect(() => validateStorageKey("albums/album-name/01-song.flac", "write")).toThrow(/Write rejected/);
    expect(() => validateStorageKey("videos/01-mv.mp4", "write")).toThrow(/Write rejected/);
    expect(() => validateStorageKey("artworks/31-cover.jpg", "write")).toThrow(/Write rejected/);
    expect(() => validateStorageKey("covers/album-art.png", "write")).toThrow(/Write rejected/);
  });

  it("allows legacy compatibility keys strictly for read operations", () => {
    expect(() => validateStorageKey("singles/01-1234-song.flac", "read")).not.toThrow();
    expect(() => validateStorageKey("albums/album-name/01-song.flac", "read")).not.toThrow();
    expect(() => validateStorageKey("videos/01-mv.mp4", "read")).not.toThrow();
    expect(() => validateStorageKey("artworks/31-cover.jpg", "read")).not.toThrow();
    expect(() => validateStorageKey("covers/album-art.png", "read")).not.toThrow();
    expect(() => validateStorageKey("library_manifest.json", "read")).not.toThrow();
  });

  it("strictly blocks path traversal attempts", () => {
    expect(() => validateStorageKey("../secrets/key.json")).toThrow(/Path traversal/);
    expect(() => validateStorageKey("audio/../../../etc/passwd")).toThrow(/Path traversal/);
    expect(() => validateStorageKey("/audio/track-1/master.flac")).toThrow(/Path traversal/);
    expect(() => validateStorageKey("audio\\track-1\\master.flac")).toThrow(/Path traversal/);
  });

  it("strictly blocks unauthorized prefixes", () => {
    expect(() => validateStorageKey("system/config.env")).toThrow(/Key prefix not authorized/);
    expect(() => validateStorageKey("passwords/db.txt")).toThrow(/Key prefix not authorized/);
    expect(() => validateStorageKey("root/boot.flac")).toThrow(/Key prefix not authorized/);
  });

  it("strictly blocks forbidden file extensions", () => {
    expect(() => validateStorageKey("audio/track-1/script.exe")).toThrow(/File extension \.exe is not allowed/);
    expect(() => validateStorageKey("audio/track-1/payload.sh")).toThrow(/File extension \.sh is not allowed/);
    expect(() => validateStorageKey("artwork/cover.html")).toThrow(/File extension \.html is not allowed/);
  });

  it("rejects empty or malformed keys", () => {
    expect(() => validateStorageKey("")).toThrow(/Invalid or missing storage key/);
    expect(() => validateStorageKey("   ")).toThrow(/Invalid or missing storage key/);
  });
});

describe("Visual Asset Key Guard (validateVisualAssetKey)", () => {
  it("allows valid visual artwork, covers, and thumbnails", () => {
    expect(() => validateVisualAssetKey("artwork/track-123.jpg")).not.toThrow();
    expect(() => validateVisualAssetKey("artworks/cover-456.png")).not.toThrow();
    expect(() => validateVisualAssetKey("covers/album-art.webp")).not.toThrow();
    expect(() => validateVisualAssetKey("thumbnails/video-thumb.jpg")).not.toThrow();
  });

  it("strictly BLOCKS private master audio, video, backups, and manifests", () => {
    expect(() => validateVisualAssetKey("audio/track-123/master.flac")).toThrow(
      /not in an authorized visual asset namespace/,
    );
    expect(() => validateVisualAssetKey("singles/song.flac")).toThrow(/not in an authorized visual asset namespace/);
    expect(() => validateVisualAssetKey("video/mv.mp4")).toThrow(/not in an authorized visual asset namespace/);
    expect(() => validateVisualAssetKey("videos/mv.mp4")).toThrow(/not in an authorized visual asset namespace/);
    expect(() => validateVisualAssetKey("backups/snapshot.json")).toThrow(
      /not in an authorized visual asset namespace/,
    );
    expect(() => validateVisualAssetKey("library_manifest.json")).toThrow(
      /not in an authorized visual asset namespace/,
    );
  });

  it("strictly BLOCKS non-image extensions even in artwork folders", () => {
    expect(() => validateVisualAssetKey("artwork/malicious.flac")).toThrow(/not an authorized visual asset format/);
    expect(() => validateVisualAssetKey("artworks/payload.mp4")).toThrow(/not an authorized visual asset format/);
    expect(() => validateVisualAssetKey("covers/audio.wav")).toThrow(/not an authorized visual asset format/);
  });
});
