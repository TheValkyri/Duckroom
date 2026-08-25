import { describe, expect, it, vi } from "vitest";
import { executeManifestMigration } from "../lib/manifest-migration.server";
import { parseLrc, beautifyLrcString, shiftLrcTime } from "../lib/lyrics-formatter";
import * as supabaseModule from "../lib/supabase";

describe("Blocker A — Lyrics Data Integrity & Non-Truncation Invariants", () => {
  describe("1. Manifest Migration Full Multi-Line Preservation", () => {
    it("preserves every single line of a multi-line synced lyric document without truncation", async () => {
      let insertedLyricsDocuments: any[] = [];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "migration_markers") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          if (table === "lyrics_documents") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[]) => {
                insertedLyricsDocuments = rows;
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "tracks") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "track-lyrics-1",
                    album_id: null,
                    title: "Song with Lyrics",
                    artist: "Artist 1",
                    storage_key: "audio/track-lyrics-1/master.flac",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "artists") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "artist-1", normalized_name: "artist 1" }],
                error: null,
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };

      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockDb as any);

      const complexLyrics = [
        { time: 0.5, text: "Verse 1: Starting the journey" },
        { time: 4.2, text: "Walking through the rain" },
        { time: 8.9, text: "Looking for a sign" },
        { time: 14.1, text: "Chorus: We find the light" },
        { time: 20.0, text: "Outro: Fade away" },
      ];

      const manifestData = {
        libraryVersion: "2026.08.26",
        albums: [],
        tracks: [
          {
            id: "track-lyrics-1",
            title: "Song with Lyrics",
            artist: "Artist 1",
            duration: 180,
            src: "audio/track-lyrics-1/master.flac",
            lyrics: complexLyrics,
          },
        ],
        videos: [],
      };

      const res = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(res.success).toBe(true);

      // Verify lyrics_documents received full multi-line array
      expect(insertedLyricsDocuments).toHaveLength(1);
      const doc = insertedLyricsDocuments[0];
      expect(doc.track_id).toBe("track-lyrics-1");
      expect(doc.source).toBe("manifest");
      expect(doc.kind).toBe("synced");

      const parsedContent = JSON.parse(doc.content);
      expect(parsedContent).toHaveLength(5); // All 5 lines preserved!
      expect(parsedContent[0].text).toBe("Verse 1: Starting the journey");
      expect(parsedContent[4].text).toBe("Outro: Fade away");
    });

    it("handles single-line lyrics, empty lyrics, and avoids creating empty documents", async () => {
      let insertedLyricsDocuments: any[] = [];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "migration_markers") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          if (table === "lyrics_documents") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[]) => {
                insertedLyricsDocuments = rows;
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "tracks") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "track-single-lyric",
                    album_id: null,
                    title: "Single Line",
                    artist: "Artist 1",
                    storage_key: "audio/track-single-lyric/master.flac",
                  },
                  {
                    id: "track-no-lyrics",
                    album_id: null,
                    title: "No Lyrics",
                    artist: "Artist 1",
                    storage_key: "audio/track-no-lyrics/master.flac",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "artists") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "artist-1", normalized_name: "artist 1" }],
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
        albums: [],
        tracks: [
          {
            id: "track-single-lyric",
            title: "Single Line",
            artist: "Artist 1",
            duration: 60,
            src: "audio/track-single-lyric/master.flac",
            lyrics: [{ time: 1.0, text: "Just one line" }],
          },
          {
            id: "track-no-lyrics",
            title: "No Lyrics",
            artist: "Artist 1",
            duration: 60,
            src: "audio/track-no-lyrics/master.flac",
            lyrics: [],
          },
        ],
        videos: [],
      };

      const res = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(res.success).toBe(true);

      // Only the track with actual lyrics should produce a document
      expect(insertedLyricsDocuments).toHaveLength(1);
      expect(insertedLyricsDocuments[0].track_id).toBe("track-single-lyric");
      const parsed = JSON.parse(insertedLyricsDocuments[0].content);
      expect(parsed).toEqual([{ time: 1.0, text: "Just one line" }]);
    });

    it("is strictly idempotent on repeated migration execution without data loss or duplicate collisions", async () => {
      let upsertCallCount = 0;
      let lastUpsertRows: any[] = [];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "migration_markers") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          if (table === "lyrics_documents") {
            return {
              upsert: vi.fn().mockImplementation((rows: any[], options: any) => {
                upsertCallCount++;
                lastUpsertRows = rows;
                expect(options.onConflict).toBe("track_id,source,kind,version");
                return Promise.resolve({ error: null });
              }),
            };
          }
          if (table === "tracks") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "track-idem-1", album_id: null, storage_key: "audio/t1.flac" }],
                error: null,
              }),
            };
          }
          if (table === "artists") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockResolvedValue({
                data: [{ id: "artist-1", normalized_name: "test" }],
                error: null,
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
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
        albums: [],
        tracks: [
          {
            id: "track-idem-1",
            title: "Idempotent Song",
            artist: "Test",
            duration: 100,
            src: "audio/t1.flac",
            lyrics: [
              { time: 1.0, text: "Line 1" },
              { time: 2.0, text: "Line 2" },
            ],
          },
        ],
        videos: [],
      };

      // First run
      const res1 = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(res1.success).toBe(true);
      expect(upsertCallCount).toBe(1);

      // Second run (simulating repeated idempotent pass)
      const res2 = await executeManifestMigration(manifestData as any, "user-owner-1");
      expect(res2.success).toBe(true);
      expect(upsertCallCount).toBe(2);

      const parsed = JSON.parse(lastUpsertRows[0].content);
      expect(parsed).toHaveLength(2);
    });
  });

  describe("2. LRC Formatter Exact Round-Trip & Preservation", () => {
    it("round-trips LRC strings to LyricLine arrays without altering text or timing precision", () => {
      const rawLrc = `[00:01.50] First line of the song
[00:05.80] Second line with special chars: @#$%^&*()
[01:12.34] Third line in minute 1`;

      const lines = parseLrc(rawLrc);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toEqual({ time: 1.5, text: "First line of the song" });
      expect(lines[1]).toEqual({ time: 5.8, text: "Second line with special chars: @#$%^&*()" });
      expect(lines[2]).toEqual({ time: 72.34, text: "Third line in minute 1" });

      const beautified = beautifyLrcString(rawLrc);
      expect(beautified).toContain("[00:01.50] First line of the song");
      expect(beautified).toContain("[00:05.80] Second line with special chars: @#$%^&*()");
      expect(beautified).toContain("[01:12.34] Third line in minute 1");

      const shifted = shiftLrcTime(rawLrc, 2.5);
      const shiftedLines = parseLrc(shifted);
      expect(shiftedLines[0]?.time).toBe(4.0);
      expect(shiftedLines[1]?.time).toBe(8.3);
      expect(shiftedLines[2]?.time).toBe(74.84);
    });

    it("handles malformed LRC lines gracefully without crashing or dropping valid lines", () => {
      const malformedLrc = `[invalid-header] Not a timestamp
[00:02.00] Valid Line 1
Corrupted line without brackets
[99:99] Missing milliseconds
[00:04.50] Valid Line 2`;

      const parsed = parseLrc(malformedLrc);
      // Valid lines must be retained in chronological order
      expect(parsed).toHaveLength(3);
      expect(parsed[0]?.text).toBe("Valid Line 1");
      expect(parsed[1]?.text).toBe("Valid Line 2");
      expect(parsed[2]?.text).toBe("Missing milliseconds");
    });
  });
});
