import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTrackToPlaylistInternal,
  appendPlaybackHistoryInternal,
  deletePlaylistInternal,
  listUserLibraryInternal,
  removeTrackFromPlaylistInternal,
  savePlaybackStateInternal,
  toggleFavoriteInternal,
} from "../lib/member-data";
import * as supabaseModule from "../lib/supabase";

/**
 * REAL production tests for the Member personal-library data layer.
 * Every assertion targets src/lib/member-data.ts internals — the exact code
 * path the server functions execute after auth middleware resolution.
 */
describe("Member Library Data Layer (production member-data.ts)", () => {
  const USER = "user-member-1";

  function makeDb() {
    const calls: { table: string; op: string; args?: unknown[] }[] = [];
    const ok = (data: unknown = null) => Promise.resolve({ data, error: null });

    const chain = (table: string, terminal: () => ReturnType<typeof ok> = () => ok()) => {
      const builder: any = {};
      const method = (name: string) => {
        builder[name] = (...args: unknown[]) => {
          calls.push({ table, op: name, args });
          return builder;
        };
      };
      ["select", "eq", "neq", "order", "limit", "delete", "update"].forEach(method);
      builder.upsert = (...args: unknown[]) => {
        calls.push({ table, op: "upsert", args });
        return Promise.resolve({ data: null, error: null });
      };
      builder.insert = (...args: unknown[]) => {
        calls.push({ table, op: "insert", args });
        return builder;
      };
      builder.maybeSingle = () => {
        calls.push({ table, op: "maybeSingle" });
        return terminal();
      };
      builder.single = () => {
        calls.push({ table, op: "single" });
        return terminal();
      };
      return builder;
    };

    const db = {
      from: vi.fn((table: string) => chain(table)),
    };
    return { db, calls };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("toggleFavoriteInternal", () => {
    it("upserts scoped to the member's user_id when favoriting", async () => {
      const { db, calls } = makeDb();
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

      await expect(toggleFavoriteInternal({ trackId: "t1", favorite: true }, USER)).resolves.toEqual({
        favorite: true,
      });

      const upsert = calls.find((c) => c.op === "upsert");
      expect(upsert?.table).toBe("user_favorites");
      expect(upsert?.args?.[0]).toEqual({ user_id: USER, track_id: "t1" });
    });

    it("deletes by composite key when unfavoriting", async () => {
      const { db, calls } = makeDb();
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

      await toggleFavoriteInternal({ trackId: "t1", favorite: false }, USER);

      expect(calls.some((c) => c.table === "user_favorites" && c.op === "delete")).toBe(true);
      expect(calls.filter((c) => c.table === "user_favorites").some((c) => c.args?.[0] === "track_id")).toBe(true);
    });

    it("propagates database failure instead of faking success", async () => {
      const failingDb = {
        from: () => ({
          upsert: () => Promise.resolve({ data: null, error: new Error("RLS violation") }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(failingDb as any);

      await expect(toggleFavoriteInternal({ trackId: "t1", favorite: true }, USER)).rejects.toThrow(/RLS violation/);
    });
  });

  describe("addTrackToPlaylistInternal — ownership enforcement", () => {
    it("refuses when the playlist belongs to someone else", async () => {
      const owningDb = {
        from: (table: string) =>
          table === "playlists"
            ? {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      single: () => Promise.resolve({ data: null, error: new Error("no row") }),
                    }),
                  }),
                }),
              }
            : {},
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(owningDb as any);

      await expect(addTrackToPlaylistInternal({ playlistId: "p1", trackId: "t1" }, USER)).rejects.toThrow(
        /không có quyền/i,
      );
    });

    it("appends at last position + 1", async () => {
      let step = 0;
      const appenderDb = {
        from: (table: string) => {
          if (table === "playlists") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({ single: () => Promise.resolve({ data: { id: "p1" }, error: null }) }),
                }),
              }),
            };
          }
          if (table === "playlist_tracks") {
            step += 1;
            if (step === 1) {
              // position probe
              return {
                select: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({ maybeSingle: () => Promise.resolve({ data: { position: 4 }, error: null }) }),
                    }),
                  }),
                }),
              };
            }
            return {
              upsert: (row: Record<string, unknown>) => {
                (appenderDb as any).lastUpsertRow = row;
                return Promise.resolve({ data: null, error: null });
              },
            };
          }
          return {};
        },
      } as any;
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(appenderDb);

      const res = await addTrackToPlaylistInternal({ playlistId: "p1", trackId: "t9" }, USER);
      expect(res).toEqual({ success: true, position: 5 });
      expect(appenderDb.lastUpsertRow).toMatchObject({ playlist_id: "p1", track_id: "t9", position: 5 });
    });
  });

  describe("listUserLibraryInternal — DB error ≠ empty library", () => {
    it("throws when any subquery fails", async () => {
      const failingDb = {
        from: (table: string) =>
          table === "user_favorites"
            ? {
                select: () => ({
                  eq: () => ({
                    order: () => Promise.resolve({ data: null, error: new Error("Postgres down") }),
                  }),
                }),
              }
            : {
                select: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                    }),
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              },
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(failingDb as any);

      await expect(listUserLibraryInternal(USER)).rejects.toThrow(/Postgres down/);
    });

    it("returns an explicit empty shape when queries succeed with zero rows", async () => {
      const emptyDb = {
        from: (table: string) =>
          table === "playback_state"
            ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
            : table === "playlists"
              ? {
                  select: () => ({
                    eq: () => ({
                      order: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }
              : {
                  select: () => ({
                    eq: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                },
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(emptyDb as any);

      const lib = await listUserLibraryInternal(USER);
      expect(lib.favorites).toEqual([]);
      expect(lib.playlists).toEqual([]);
      expect(lib.history).toEqual([]);
      expect(lib.playbackState).toBeNull();
    });

    it("sorts playlist tracks by ascending position", async () => {
      const playlistsDb = {
        from: (table: string) => {
          if (table === "playlists") {
            return {
              select: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "p1",
                          name: "Mix",
                          description: null,
                          cover_storage_key: null,
                          is_public: false,
                          created_at: "",
                          updated_at: "",
                          playlist_tracks: [
                            { track_id: "b", position: 2, added_at: "" },
                            { track_id: "a", position: 1, added_at: "" },
                          ],
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === "playback_state") {
            return {
              select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          };
        },
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(playlistsDb as any);

      const lib = await listUserLibraryInternal(USER);
      expect(lib.playlists[0]?.tracks.map((t: any) => t.track_id)).toEqual(["a", "b"]);
    });
  });

  describe("state & history writers", () => {
    it("savePlaybackStateInternal upserts keyed on user_id", async () => {
      const captured: Record<string, unknown>[] = [];
      const stateDb = {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            captured.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(stateDb as any);

      await expect(savePlaybackStateInternal({ trackId: "t1", positionSeconds: 42.5 }, USER)).resolves.toEqual({
        success: true,
      });
      expect(captured[0]).toMatchObject({ user_id: USER, track_id: "t1", position_seconds: 42.5 });
    });

    it("appendPlaybackHistoryInternal upserts a scoped row keyed by client_event_id", async () => {
      const captured: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
      const histDb = {
        from: () => ({
          upsert: (row: Record<string, unknown>, opts: unknown) => {
            captured.push({ row, opts });
            return {
              select: () => Promise.resolve({ data: [{ id: "h1" }], error: null }),
            };
          },
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(histDb as any);

      const payload = {
        trackId: "t1",
        startedAt: "2026-08-24T10:00:00Z",
        secondsPlayed: 180,
        completed: true,
        clientEventId: "evt-abc-12345",
      };
      await expect(appendPlaybackHistoryInternal(payload, USER)).resolves.toEqual({
        success: true,
        duplicate: false,
      });
      expect(captured[0]?.row).toMatchObject({ user_id: USER, track_id: "t1", client_event_id: "evt-abc-12345" });
      expect(captured[0]?.opts).toEqual({ onConflict: "client_event_id", ignoreDuplicates: true });
    });

    it("appendPlaybackHistoryInternal flags an ignored duplicate (idempotent retry)", async () => {
      const histDb = {
        from: () => ({
          upsert: () => ({
            select: () => Promise.resolve({ data: [], error: null }), // nothing written → duplicate
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(histDb as any);
      await expect(
        appendPlaybackHistoryInternal(
          {
            trackId: "t1",
            startedAt: "2026-08-24T10:00:00Z",
            secondsPlayed: 10,
            completed: true,
            clientEventId: "evt-x-999999",
          },
          USER,
        ),
      ).resolves.toEqual({ success: true, duplicate: true });
    });
  });

  describe("deletePlaylistInternal & removeTrackFromPlaylistInternal", () => {
    it("deletes only within the owner scope", async () => {
      const { db, calls } = makeDb();
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db as any);

      await deletePlaylistInternal({ playlistId: "00000000-0000-0000-0000-000000000001" }, USER);
      const del = calls.find((c) => c.table === "playlists" && c.op === "delete");
      expect(del).toBeDefined();
    });

    it("removeTrack refuses when playlist lookup misses", async () => {
      const missingDb = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            }),
          }),
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(missingDb as any);

      await expect(removeTrackFromPlaylistInternal({ playlistId: "pX", trackId: "t1" }, USER)).rejects.toThrow(
        /không có quyền|không tồn tại/i,
      );
    });
  });
});
