import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  getUserPreferencesInternal,
  reorderPlaylistInternal,
  saveUserPreferencesInternal,
} from "../lib/member-data";
import * as supabaseModule from "../lib/supabase";

/**
 * §12.2 Playlist reorder + §5.2 user preferences — production internals
 * against mocked Supabase transports.
 */

type TableSpec = {
  single?: { data: unknown; error: { message: string } | null };
  rows?: unknown[] | null;
  rowsError?: { message: string } | null;
  maybeSingle?: { data: unknown; error: { message: string } | null };
};

function makeDb(tables: Record<string, TableSpec>) {
  const captured: Record<string, unknown[]> = {};
  const db = {
    __captured: captured,
    __updates: [] as Array<{ table: string; payload: Record<string, unknown>; filters: unknown[] }>,
    from: vi.fn((table: string) => {
      const spec: TableSpec = tables[table] ?? {};
      const b: any = {};
      b.select = () => b;
      b.eq = (...args: unknown[]) => {
        b.__lastEq = args;
        return b;
      };
      if (spec.single) {
        b.single = () => Promise.resolve(spec.single!);
      }
      // Always defined so an unexpected call-shape resolves null instead of hanging.
      b.maybeSingle = () =>
        Promise.resolve({ data: spec.maybeSingle?.data ?? null, error: spec.maybeSingle?.error ?? null });
      // Awaitable-after-eq reads (playlist_tracks list): implement the thenable
      // protocol correctly — .then must invoke the resolver callbacks.
      if (spec.rows !== undefined || spec.rowsError) {
        const result = () => Promise.resolve({ data: spec.rows ?? null, error: spec.rowsError ?? null });
        const origEq = b.eq.bind(b);
        b.eq = (...args: unknown[]) => {
          const chained = origEq(...args);
          chained.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            result().then(onFulfilled, onRejected);
          return chained;
        };
      }
      b.update = (payload: Record<string, unknown>) => {
        const chain: any = {};
        let eqCount = 0;
        chain.eq = () => {
          eqCount++;
          // reorderPlaylistInternal chains exactly two .eq filters before awaiting
          return eqCount < 2 ? chain : Promise.resolve({ data: null, error: null });
        };
        captured[`${table}.update`] = captured[`${table}.update`] ?? [];
        (captured[`${table}.update`] as unknown[]).push(payload);
        db.__updates.push({ table, payload, filters: b.__lastEq ?? [] });
        return chain;
      };
      b.upsert = async (row: unknown, opts?: unknown) => {
        (captured as Record<string, unknown>)[`${table}.upsert.row`] = row;
        (captured as Record<string, unknown>)[`${table}.upsert.opts`] = opts;
        return spec.maybeSingle?.error ? { data: null, error: spec.maybeSingle.error } : { data: null, error: null };
      };
      return b;
    }),
  };
  return db as any;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("reorderPlaylistInternal — atomic RPC (§12.2, audit fix #6)", () => {
  function makeRpcDb(rpcResult: { data?: unknown; error?: { message: string } | null }) {
    const captured: Record<string, unknown> = {};
    const db = {
      __captured: captured,
      rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
        captured["rpc.fn"] = fn;
        captured["rpc.params"] = params;
        return { data: rpcResult.data ?? null, error: rpcResult.error ?? null };
      }),
    };
    return db as any;
  }

  it("rejects an empty order without touching the database", async () => {
    const db = makeRpcDb({});
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(reorderPlaylistInternal({ playlistId: "p1", orderedTrackIds: [] }, "u1")).rejects.toThrow(/rỗng/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate entries in the requested order", async () => {
    const db = makeRpcDb({});
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(reorderPlaylistInternal({ playlistId: "p1", orderedTrackIds: ["t1", "t1"] }, "u1")).rejects.toThrow(
      /lặp/,
    );
  });

  it("translates PLAYLIST_NOT_FOUND / FORBIDDEN into the ownership message", async () => {
    for (const code of ["PLAYLIST_NOT_FOUND", "FORBIDDEN"]) {
      const db = makeRpcDb({ data: null, error: { message: code } });
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
      await expect(
        reorderPlaylistInternal({ playlistId: "00000000-0000-0000-0000-000000000009", orderedTrackIds: ["t1"] }, "u1"),
      ).rejects.toThrow(/không tồn tại hoặc bạn không có quyền/);
    }
  });

  it("translates MEMBERSHIP_MISMATCH into the reload hint", async () => {
    const db = makeRpcDb({ data: null, error: { message: "MEMBERSHIP_MISMATCH" } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(
      reorderPlaylistInternal({ playlistId: "00000000-0000-0000-0000-000000000001", orderedTrackIds: ["t9"] }, "u1"),
    ).rejects.toThrow(/không khớp/);
  });

  it("invokes the atomic SQL function with actor + order and returns its count", async () => {
    const db = makeRpcDb({ data: 3, error: null });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);

    const res = await reorderPlaylistInternal(
      { playlistId: "00000000-0000-0000-0000-000000000001", orderedTrackIds: ["c", "a", "b"] },
      "user-member-7",
    );
    expect(res).toEqual({ success: true, count: 3 });
    expect(db.__captured["rpc.fn"]).toBe("reorder_playlist_tracks");
    expect(db.__captured["rpc.params"]).toEqual({
      p_playlist_id: "00000000-0000-0000-0000-000000000001",
      p_ordered_track_ids: ["c", "a", "b"],
      p_actor: "user-member-7",
    });
  });

  it("surfaces unexpected database errors verbatim", async () => {
    const db = makeRpcDb({ data: null, error: { message: "connection reset" } });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(
      reorderPlaylistInternal({ playlistId: "00000000-0000-0000-0000-000000000001", orderedTrackIds: ["t1"] }, "u1"),
    ).rejects.toThrow(/connection reset/);
  });
});

describe("user preferences (§5.2)", () => {
  it("returns documented defaults when the member has no stored row", async () => {
    const db = makeDb({ user_preferences: {} });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(getUserPreferencesInternal("u1")).resolves.toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("clamps and normalizes persisted values instead of trusting raw columns", async () => {
    const db = makeDb({
      user_preferences: {
        maybeSingle: {
          data: { theme: "neon", volume: 4.2, crossfade_seconds: 99, replaygain_mode: "bogus" },
          error: null,
        },
      },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(getUserPreferencesInternal("u1")).resolves.toEqual({
      theme: "dark",
      volume: 1,
      crossfadeSeconds: 10,
      replaygainMode: "off",
    });
  });

  it("maps a valid stored row through the typed contract", async () => {
    const db = makeDb({
      user_preferences: {
        maybeSingle: {
          data: { theme: "light", volume: 0.5, crossfade_seconds: 3, replaygain_mode: "album" },
          error: null,
        },
      },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(getUserPreferencesInternal("u1")).resolves.toEqual({
      theme: "light",
      volume: 0.5,
      crossfadeSeconds: 3,
      replaygainMode: "album",
    });
  });

  it("upserts only the provided partial fields keyed on user_id", async () => {
    const db = makeDb({ user_preferences: {} });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    const res = await saveUserPreferencesInternal({ volume: 0.8, replaygainMode: "track" }, "u1");
    expect(res.success).toBe(true);
    const row = db.__captured["user_preferences.upsert.row"] as Record<string, unknown>;
    expect(row).toMatchObject({
      user_id: "u1",
      volume: 0.8,
      replaygain_mode: "track",
    });
    expect(row["theme"]).toBeUndefined();
    expect(row["crossfade_seconds"]).toBeUndefined();
    expect(typeof row["updated_at"]).toBe("string");
    expect(db.__captured["user_preferences.upsert.opts"]).toEqual({ onConflict: "user_id" });
  });

  it("propagates database errors (never invents success)", async () => {
    const db = makeDb({
      user_preferences: { maybeSingle: { data: null, error: { message: "RLS violated" } } },
    });
    vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(db);
    await expect(saveUserPreferencesInternal({ volume: 0.5 }, "u1")).rejects.toThrow(/RLS violated/);
  });
});
