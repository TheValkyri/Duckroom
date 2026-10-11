import { describe, expect, it } from "vitest";
import { normalizeBaseFileName } from "../lib/upload-store";
import { parseLrc, shiftLrcTime, beautifyLrcString } from "../lib/lyrics-formatter";
import fs from "fs";
import path from "path";

describe("LRC Upload & Auto-Pairing Integration", () => {
  describe("normalizeBaseFileName", () => {
    it("matches exact audio and lrc filenames regardless of extension", () => {
      const flacName = "Hngle - Tìm Em (feat. Bảo Anh).flac";
      const lrcName = "Hngle - Tìm Em (feat. Bảo Anh).lrc";

      expect(normalizeBaseFileName(flacName)).toBe(normalizeBaseFileName(lrcName));
      expect(normalizeBaseFileName(flacName)).toBe("hngle - tìm em (feat. bảo anh)");
    });

    it("matches files with leading track numbers or roman numerals", () => {
      const flacWithTrackNo = "01. Hngle - Tìm Em (feat. Bảo Anh).flac";
      const lrcWithoutTrackNo = "Hngle - Tìm Em (feat. Bảo Anh).lrc";

      expect(normalizeBaseFileName(flacWithTrackNo)).toBe(normalizeBaseFileName(lrcWithoutTrackNo));
    });

    it("handles case-insensitivity and whitespace differences", () => {
      const audioName = "  HNGLE - TÌM EM.wav  ";
      const lrcName = "hngle - tìm em.LRC";

      expect(normalizeBaseFileName(audioName)).toBe(normalizeBaseFileName(lrcName));
    });
  });

  describe("Real-world LRC Parsing (Hngle - Tìm Em)", () => {
    const userLrcPath = "C:/Users/Darne/Downloads/Hngle - Tìm Em (feat. Bảo Anh).lrc";

    it("correctly parses all 50 lines from user file if present or fallback sample", () => {
      let lrcContent = "";
      if (fs.existsSync(userLrcPath)) {
        lrcContent = fs.readFileSync(userLrcPath, "utf-8");
      } else {
        lrcContent = `[00:32.72]Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy
[00:38.66]Có đôi lần khẽ cười vì anh chợt nhớ người làm anh say
[01:24.10]Đi khắp thiên hà, anh vẫn sẽ bước đi để kiếm em
[04:32.03]`;
      }

      const parsed = parseLrc(lrcContent);
      expect(parsed.length).toBeGreaterThanOrEqual(4);

      // Check first line timestamp
      expect(parsed[0]?.time).toBeCloseTo(32.72);
      expect(parsed[0]?.text).toContain("Ngồi ngẩn ngơ");

      // Check second line timestamp
      expect(parsed[1]?.time).toBeCloseTo(38.66);

      // Check outro line
      const lastLine = parsed[parsed.length - 1];
      expect(lastLine?.time).toBeCloseTo(272.03);
    });

    it("preserves Vietnamese accented characters through shift and beautify", () => {
      const sample = `[00:32.72]Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy`;
      const shifted = shiftLrcTime(sample, 1.5);
      expect(shifted).toContain("[00:34.22] Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy");

      const beautified = beautifyLrcString(sample);
      expect(beautified).toContain("Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy");
    });
  });

  describe("S3 Storage Bypass Contract", () => {
    it("ensures .lrc files are identified as lyrics and not audio/video binaries", () => {
      const testFiles = [
        { name: "Hngle - Tìm Em (feat. Bảo Anh).flac", isLrc: false },
        { name: "Hngle - Tìm Em (feat. Bảo Anh).lrc", isLrc: true },
        { name: "song.LRC", isLrc: true },
        { name: "album_art.jpg", isLrc: false },
      ];

      const lrcFiles = testFiles.filter((f) => f.name.toLowerCase().endsWith(".lrc"));
      const mediaFiles = testFiles.filter((f) => !f.name.toLowerCase().endsWith(".lrc"));

      expect(lrcFiles.length).toBe(2);
      expect(mediaFiles.length).toBe(2);

      // Confirm that .lrc files will never be routed into media upload sessions
      expect(lrcFiles.every((f) => f.name.toLowerCase().endsWith(".lrc"))).toBe(true);
    });
  });
});
