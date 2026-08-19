import { describe, expect, it } from "vitest";

describe("Media Integrity & Duplicate Detection Rules", () => {
  describe("Audiophile Quality Integrity (No Fake Values)", () => {
    it("preserves authentic 16-bit / 44.1kHz FLAC analysis", () => {
      const track = {
        format: "FLAC",
        bitDepth: 16,
        sampleRate: 44100,
      };
      const badge =
        track.format && track.bitDepth && track.sampleRate
          ? `${track.format} ${track.bitDepth}/${track.sampleRate > 1000 ? Math.round(track.sampleRate / 1000) : track.sampleRate}`
          : "LOSSLESS";
      expect(badge).toBe("FLAC 16/44");
    });

    it("preserves authentic 24-bit / 96kHz Studio Master analysis", () => {
      const track = {
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96000,
      };
      const badge =
        track.format && track.bitDepth && track.sampleRate
          ? `${track.format} ${track.bitDepth}/${track.sampleRate > 1000 ? Math.round(track.sampleRate / 1000) : track.sampleRate}`
          : "LOSSLESS";
      expect(badge).toBe("FLAC 24/96");
    });

    it("falls back to LOSSLESS or UNKNOWN when audio analysis is missing or unverified", () => {
      const unverifiedTrack = {
        format: "",
        bitDepth: 0,
        sampleRate: 0,
      };
      const badge =
        unverifiedTrack.format && unverifiedTrack.bitDepth && unverifiedTrack.sampleRate
          ? `${unverifiedTrack.format} ${unverifiedTrack.bitDepth}/${unverifiedTrack.sampleRate > 1000 ? Math.round(unverifiedTrack.sampleRate / 1000) : unverifiedTrack.sampleRate}`
          : "LOSSLESS";
      expect(badge).toBe("LOSSLESS");
      expect(badge).not.toBe("FLAC 24/96"); // NEVER fake 24/96
    });
  });

  describe("SHA-256 Checksum-First Duplicate Detection", () => {
    type LibraryEntry = { id: string; title: string; artist: string; sha256?: string };
    const library: LibraryEntry[] = [
      {
        id: "track-1",
        title: "Một Đêm Trắng",
        artist: "Hồ Việt Trung",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ];

    function checkDuplicate(incoming: { title: string; artist: string; sha256?: string }) {
      if (incoming.sha256) {
        const exactMatch = library.find((t) => t.sha256 === incoming.sha256);
        if (exactMatch) {
          return { type: "EXACT_DUPLICATE" as const, matchedTrack: exactMatch };
        }
      }

      const metadataMatch = library.find(
        (t) =>
          t.title.trim().toLowerCase() === incoming.title.trim().toLowerCase() &&
          t.artist.trim().toLowerCase() === incoming.artist.trim().toLowerCase(),
      );
      if (metadataMatch) {
        return { type: "METADATA_WARNING" as const, matchedTrack: metadataMatch };
      }

      return { type: "UNIQUE" as const };
    }

    it("identifies exact duplicates by SHA-256 checksum", () => {
      const incoming = {
        title: "Tên Khác",
        artist: "Nghệ Sĩ Khác",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };
      const result = checkDuplicate(incoming);
      expect(result.type).toBe("EXACT_DUPLICATE");
      expect(result.matchedTrack?.id).toBe("track-1");
    });

    it("flags metadata similarity as warning only when SHA-256 differs (e.g. remastered/different master)", () => {
      const incoming = {
        title: "Một Đêm Trắng",
        artist: "Hồ Việt Trung",
        sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };
      const result = checkDuplicate(incoming);
      expect(result.type).toBe("METADATA_WARNING");
    });

    it("accepts unique tracks without warning", () => {
      const incoming = {
        title: "Bài Hát Mới Toanh",
        artist: "Nghệ Sĩ Mới",
        sha256: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66660000777788889999",
      };
      const result = checkDuplicate(incoming);
      expect(result.type).toBe("UNIQUE");
    });
  });
});
