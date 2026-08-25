/**
 * PHASE 5.2 — Playback persistence client (docs/PHASE_5_ARCHITECTURE.md §4).
 *
 * Policy:
 * - Members: playback_state upserts (trackId + real positionSeconds) on
 *   pause / seek-end / track-change / hidden-tab / beforeunload, debounced.
 * - Guests: localStorage mirror `duckroom.player.session` (trackId +
 *   position + queue ids capped at 200). No server writes for guests —
 *   the member RPC would 401 anyway; skipping it avoids wasted requests.
 * - History append stays event-driven (on ended) in the provider.
 *
 * Everything here is side-effect-thin and timer-injectable so the debounce
 * policy itself is unit-testable with fake timers.
 */

export const GUEST_SESSION_STORAGE_KEY = "duckroom.player.session";
export const GUEST_QUEUE_ID_LIMIT = 200;

export interface GuestSession {
  trackId: string | null;
  positionSeconds: number;
  queueIds: string[];
}

export interface PersistEvent {
  trackId: string | null;
  positionSeconds: number;
  queue?: TrackIdList;
}

type TrackIdList = string[];

/** Reads the guest mirror; never throws (storage can be disabled/private mode). */
export function readGuestSession(): GuestSession | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestSession> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const trackId = typeof parsed.trackId === "string" ? parsed.trackId : null;
    const positionSeconds =
      typeof parsed.positionSeconds === "number" &&
      Number.isFinite(parsed.positionSeconds) &&
      parsed.positionSeconds >= 0
        ? parsed.positionSeconds
        : 0;
    const queueIds = Array.isArray(parsed.queueIds)
      ? parsed.queueIds.filter((id): id is string => typeof id === "string").slice(0, GUEST_QUEUE_ID_LIMIT)
      : [];
    if (!trackId && queueIds.length === 0) return null;
    return { trackId, positionSeconds, queueIds };
  } catch {
    return null;
  }
}

export function writeGuestSession(session: PersistEvent & { queue?: TrackIdList }): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    // Keep sub-second precision (audit finding #9): continue-listening should
    // restore where the user actually was, matching the member DB path.
    const pos = Math.max(0, session.positionSeconds);
    const payload: GuestSession = {
      trackId: session.trackId,
      positionSeconds: Number.isFinite(pos) ? Math.round(pos * 1000) / 1000 : 0,
      queueIds: (session.queue ?? []).slice(0, GUEST_QUEUE_ID_LIMIT),
    };
    window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private mode/quota) — persistence is best-effort by design.
  }
}

export function clearGuestSession(): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Debounced persister factory. `flush()` forces an immediate save (used on
 * page-hide/unload paths where waiting out the debounce would lose state).
 */
export function createPlaybackPersister(
  save: (event: PersistEvent) => void,
  delayMs = 3000,
): { notify(event: PersistEvent): void; flush(): void; cancel(): void } {
  let pending: PersistEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fire() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const event = pending;
      pending = null;
      save(event);
    }
  }

  return {
    notify(event) {
      pending = event;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    flush: fire,
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}

export interface RestorableState {
  track_id: string | null;
  position_seconds: number;
}

/**
 * Resolve what to restore after library hydration. Pure so both the member
 * path (playbackState row) and the guest path (localStorage session) share
 * one deterministic decision:
 * - track must exist in the hydrated library;
 * - position must be a sane positive number;
 * - tracks already finished (position ≥ duration − 1s) restore paused at 0
 *   only when explicitly requested (we treat them as "start fresh").
 */
export function resolveRestoreTarget(
  source: RestorableState | null,
  libraryTracks: { id: string; duration: number }[],
): { trackId: string; positionSeconds: number } | null {
  if (!source || !source.track_id) return null;
  const track = libraryTracks.find((t) => t.id === source.track_id);
  if (!track) return null;
  const pos =
    typeof source.position_seconds === "number" && Number.isFinite(source.position_seconds)
      ? Math.max(0, source.position_seconds)
      : 0;
  const duration = Number.isFinite(track.duration) && track.duration > 0 ? track.duration : Infinity;
  // Finished or absurd positions restart from the top rather than restoring.
  if (pos >= duration - 1 || pos < 0) {
    return { trackId: track.id, positionSeconds: 0 };
  }
  return { trackId: track.id, positionSeconds: pos };
}
