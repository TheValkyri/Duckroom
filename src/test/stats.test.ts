import { describe, expect, it } from "vitest";
import { extractPrimaryArtist, aggregateStats, fmtHours, type HistoryRow } from "../lib/stats";
import type { Track } from "../data/library";

describe("Stats Logic & Primary Artist Normalization", () => {
  describe("extractPrimaryArtist", () => {
    it("strips (feat. ...) pattern cleanly", () => {
      expect(extractPrimaryArtist("MCK (feat. tlinh)")).toBe("MCK");
      expect(extractPrimaryArtist("MCK (feat. RPT Orijinn & Thành Draw)")).toBe("MCK");
      expect(extractPrimaryArtist("Wren Evans (feat. itsnk)")).toBe("Wren Evans");
    });

    it("strips [feat. ...] pattern cleanly", () => {
      expect(extractPrimaryArtist("MCK [feat. tlinh]")).toBe("MCK");
      expect(extractPrimaryArtist("Low G [feat. Thắng]")).toBe("Low G");
    });

    it("strips ft. and feat. mid-string or trailing", () => {
      expect(extractPrimaryArtist("MCK ft. JustaTee")).toBe("MCK");
      expect(extractPrimaryArtist("MCK feat. Trung Trần")).toBe("MCK");
      expect(extractPrimaryArtist("MCK featuring TLinh")).toBe("MCK");
      expect(extractPrimaryArtist("MCK (ft. tlinh)")).toBe("MCK");
    });

    it("strips with pattern", () => {
      expect(extractPrimaryArtist("MCK (with tlinh)")).toBe("MCK");
      expect(extractPrimaryArtist("MCK with tlinh")).toBe("MCK");
    });

    it("strips punctuation-delimited featuring credits", () => {
      expect(extractPrimaryArtist("MCK, feat. tlinh")).toBe("MCK");
      expect(extractPrimaryArtist("MCK - feat. tlinh")).toBe("MCK");
      expect(extractPrimaryArtist("MCK / feat. tlinh")).toBe("MCK");
    });

    it("strips collaboration x / × patterns with surrounding whitespace", () => {
      expect(extractPrimaryArtist("MCK x JustaTee")).toBe("MCK");
      expect(extractPrimaryArtist("MCK × tlinh")).toBe("MCK");
    });

    it("handles multiple featuring tags and brackets cleanly", () => {
      expect(extractPrimaryArtist("Artist A (feat. B) [with C]")).toBe("Artist A");
      expect(extractPrimaryArtist("Artist A feat. B & C")).toBe("Artist A");
    });

    it("preserves standalone artist names without modifications", () => {
      expect(extractPrimaryArtist("MCK")).toBe("MCK");
      expect(extractPrimaryArtist("RPT MCK")).toBe("RPT MCK");
      expect(extractPrimaryArtist("Sơn Tùng M-TP")).toBe("Sơn Tùng M-TP");
      expect(extractPrimaryArtist("The xx")).toBe("The xx");
      expect(extractPrimaryArtist("Jamie xx")).toBe("Jamie xx");
      expect(extractPrimaryArtist("Lil Nas X")).toBe("Lil Nas X");
      expect(extractPrimaryArtist("Charli XCX")).toBe("Charli XCX");
    });

    it("handles edge cases and invalid inputs safely", () => {
      expect(extractPrimaryArtist("")).toBe("Không rõ");
      expect(extractPrimaryArtist("   ")).toBe("Không rõ");
      expect(extractPrimaryArtist(null as any)).toBe("Không rõ");
      expect(extractPrimaryArtist(undefined as any)).toBe("Không rõ");
    });
  });

  describe("aggregateStats", () => {
    const mockTracks: Track[] = [
      {
        id: "mck-1",
        title: "Chìm Sâu",
        artist: "MCK (feat. Trung Trần)",
        albumId: "mck-99",
        trackNo: 1,
        duration: 180,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96000,
        sizeMB: 50,
        lyrics: [],
      },
      {
        id: "mck-2",
        title: "Thắt Cà Vạt",
        artist: "MCK (feat. tlinh)",
        albumId: "mck-99",
        trackNo: 2,
        duration: 200,
        format: "FLAC",
        bitDepth: 24,
        sampleRate: 96000,
        sizeMB: 60,
        lyrics: [],
      },
      {
        id: "mck-3",
        title: "Chỉ Một Đêm Nữa Thôi",
        artist: "MCK (feat. RPT Orijinn & Thành Draw)",
        albumId: "mck-99",
        trackNo: 3,
        duration: 220,
        format: "WAV",
        bitDepth: 24,
        sampleRate: 48000,
        sizeMB: 70,
        lyrics: [],
      },
      {
        id: "other-1",
        title: "Nơi Này Có Anh",
        artist: "Sơn Tùng M-TP",
        albumId: "st-1",
        trackNo: 1,
        duration: 250,
        format: "FLAC",
        bitDepth: 16,
        sampleRate: 44100,
        sizeMB: 30,
        lyrics: [],
      },
    ];

    it("aggregates all featuring variants under a single primary artist", () => {
      const history: HistoryRow[] = [
        {
          id: 1,
          track_id: "mck-1",
          started_at: "2026-09-01T00:00:00Z",
          ended_at: null,
          seconds_played: 180,
          completed: true,
        },
        {
          id: 2,
          track_id: "mck-2",
          started_at: "2026-09-01T01:00:00Z",
          ended_at: null,
          seconds_played: 200,
          completed: true,
        },
        {
          id: 3,
          track_id: "mck-3",
          started_at: "2026-09-01T02:00:00Z",
          ended_at: null,
          seconds_played: 120,
          completed: false,
        },
        {
          id: 4,
          track_id: "other-1",
          started_at: "2026-09-01T03:00:00Z",
          ended_at: null,
          seconds_played: 250,
          completed: true,
        },
      ];

      const res = aggregateStats(history, mockTracks);

      // Total numbers
      expect(res.totalPlays).toBe(4);
      expect(res.completedPlays).toBe(3);
      expect(res.totalSeconds).toBe(180 + 200 + 120 + 250);

      // Top artist should be MCK with all 3 plays and 500 seconds rolled in
      expect(res.topArtists.length).toBe(2);
      expect(res.topArtists[0]!.artist).toBe("MCK");
      expect(res.topArtists[0]!.plays).toBe(3);
      expect(res.topArtists[0]!.seconds).toBe(500);

      // Sơn Tùng is 2nd
      expect(res.topArtists[1]!.artist).toBe("Sơn Tùng M-TP");
      expect(res.topArtists[1]!.plays).toBe(1);
      expect(res.topArtists[1]!.seconds).toBe(250);

      // Check top tracks
      expect(res.topTracks.length).toBe(4);

      // Verify format breakdown is completely deleted
      expect((res as any).formatBreakdown).toBeUndefined();
    });

    it("handles empty history gracefully", () => {
      const res = aggregateStats([], mockTracks);
      expect(res.totalPlays).toBe(0);
      expect(res.totalSeconds).toBe(0);
      expect(res.completedPlays).toBe(0);
      expect(res.topArtists).toEqual([]);
      expect(res.topTracks).toEqual([]);
    });
  });

  describe("fmtHours", () => {
    it("formats minutes and hours appropriately", () => {
      expect(fmtHours(120)).toBe("2 phút");
      expect(fmtHours(3600)).toBe("1 giờ");
      expect(fmtHours(3720)).toBe("1h 2p");
    });
  });
});
