import { describe, expect, it } from "vitest";
import { validateStorageKey } from "../lib/auth-guard";

describe("Storage Key Validation & Security Guard", () => {
  it("allows canonical V2 storage keys", () => {
    expect(() => validateStorageKey("audio/track-123/master.flac")).not.toThrow();
    expect(() => validateStorageKey("video/mv-456/master.mp4")).not.toThrow();
    expect(() => validateStorageKey("artwork/art-789/master.jpg")).not.toThrow();
    expect(() => validateStorageKey("subtitles/mv-456/vi.vtt")).not.toThrow();
    expect(() => validateStorageKey("backups/snapshot-001/library_manifest.json")).not.toThrow();
  });

  it("allows legacy compatibility keys (singles, albums, videos, artworks)", () => {
    expect(() => validateStorageKey("singles/01-1234-song.flac")).not.toThrow();
    expect(() => validateStorageKey("albums/album-name/01-song.flac")).not.toThrow();
    expect(() => validateStorageKey("videos/01-mv.mp4")).not.toThrow();
    expect(() => validateStorageKey("artworks/31-cover.jpg")).not.toThrow();
    expect(() => validateStorageKey("covers/album-art.png")).not.toThrow();
    expect(() => validateStorageKey("library_manifest.json")).not.toThrow();
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
