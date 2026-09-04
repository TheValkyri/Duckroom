import {
  clampCrossfade,
  clampIndexToQueue,
  computeIndexAfterMove,
  decideNext,
  decidePrev,
  smartShuffled,
  type RepeatMode,
} from "./player-queue";
import type { Track } from "../data/library";

/**
 * PHASE 5.1 — Engine store (docs/PHASE_5_ARCHITECTURE.md §1).
 *
 * Plain-object store + subscribe, consumed through useSyncExternalStore.
 * All transport mutations go through the pure decision helpers in
 * player-queue.ts; the engine reads its own state synchronously so no
 * indexRef-style mirror exists anywhere else.
 *
 * The engine intentionally knows NOTHING about <audio> elements or the
 * network. DOM execution stays in PlayerProvider; persistence policy lives
 * in player-persistence.ts; multi-tab arbitration lives in
 * player-broadcast.ts. This keeps every transition unit-testable.
 */

export type PlayerEngineState = {
  baseQueue: Track[];
  queue: Track[];
  index: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  /** Volume to restore on unmute (last audible level). */
  prevVolume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  crossfade: number;
  direction: 1 | -1;
};

export type NextDecision = ReturnType<typeof decideNext>;
export type PrevDecision = ReturnType<typeof decidePrev>;

export interface PlayerEngineActions {
  /** Replace the canonical library backing both queues (identity-safe). */
  replaceLibrary(tracks: Track[]): void;
  playQueue(list: Track[], startIndex?: number, shuffleNow?: boolean): void;
  requestPlay(): void;
  requestPause(): void;
  requestToggle(): void;
  /** Manual next always advances; auto next respects repeat semantics. */
  nextIntent(manual: boolean): NextDecision;
  /** §11.4 threshold semantics decided by decidePrev(currentPos…). */
  prevIntent(currentPosSeconds: number): PrevDecision;
  jumpTo(i: number): void;
  /** Crossfade handover advance (wraps; preserves pre-engine semantics). */
  advanceWrapForHandover(): void;
  moveInQueue(from: number, to: number): void;
  /** QoL A1 (2026-09-01): chèn track vào NGAY SAU bài đang phát.
   *  Duplicate có chủ đích (user yêu cầu) — không dedupe. Không đổi index.
   *  Nếu bài chèn TRÙNG bài hiện tại: bỏ qua (chèn chính nó = vô nghĩa). */
  insertNext(track: Track): void;
  toggleShuffle(): void;
  cycleRepeat(): RepeatMode;
  setVolume(v: number): void;
  toggleMute(): void;
  setCrossfade(seconds: number): void;
}

export type PlayerEngine = {
  getState(): PlayerEngineState;
  subscribe(listener: () => void): () => void;
  actions: PlayerEngineActions;
};

const INITIAL_STATE: PlayerEngineState = {
  baseQueue: [],
  queue: [],
  index: 0,
  isPlaying: false,
  volume: 0.8,
  muted: false,
  prevVolume: 0.8,
  shuffle: false,
  repeat: "off",
  crossfade: 10,
  direction: 1,
};

export function createPlayerEngine(initial?: Partial<PlayerEngineState>): PlayerEngine {
  let state: PlayerEngineState = { ...INITIAL_STATE, ...initial };
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((fn) => fn());
  }

  function set(partial: Partial<PlayerEngineState>) {
    const next = { ...state, ...partial };
    // Identity-stable no-op guard: subscribers must not re-render for states
    // that did not change a single field.
    const changed = Object.keys(partial).some((key) => {
      const k = key as keyof PlayerEngineState;
      return next[k] !== state[k];
    });
    if (!changed) return;
    state = next;
    emit();
  }

  const sameIds = (a: Track[], b: Track[]) => a.length === b.length && a.every((t, i) => t.id === b[i]?.id);

  const actions: PlayerEngineActions = {
    replaceLibrary(tracks) {
      if (!tracks || tracks.length === 0 || sameIds(state.baseQueue, tracks)) {
        // Still clamp: a shrinking library must never leave index dangling.
        set({ index: clampIndexToQueue(state.index, tracks?.length ?? 0) });
        return;
      }
      const currentTrack = state.queue[state.index];
      const queue = state.shuffle && currentTrack ? smartShuffled(tracks, (t) => t.artist, currentTrack) : tracks;
      const index = clampIndexToQueue(
        // Keep pointing at the same track when it still exists.
        Math.max(
          0,
          tracks.findIndex((t) => t.id === currentTrack?.id),
        ),
        queue.length,
      );
      set({ baseQueue: tracks, queue, index });
    },

    playQueue(list, startIndex = 0, shuffleNow) {
      if (!list || list.length === 0) return;
      const start = list[startIndex];
      const useShuffle = shuffleNow ?? state.shuffle;
      // F2 2026-09-04: shuffle = SMART — rải nghệ sĩ thay random thuần.
      const queue = useShuffle && start ? smartShuffled(list, (t) => t.artist, start) : list;
      const index = clampIndexToQueue(useShuffle ? 0 : startIndex, queue.length);
      set({
        baseQueue: list,
        queue,
        index,
        isPlaying: true,
        direction: 1,
        ...(shuffleNow !== undefined ? { shuffle: shuffleNow } : {}),
      });
    },

    requestPlay() {
      set({ isPlaying: true });
    },

    requestPause() {
      set({ isPlaying: false });
    },

    requestToggle() {
      set({ isPlaying: !state.isPlaying });
    },

    nextIntent(manual) {
      const decision = decideNext(state.index, state.queue.length, state.repeat, manual);
      if (decision.action === "stop") {
        // Preserve pre-engine semantics: stop freezes position/index as-is.
        set({ isPlaying: false, direction: 1 });
        return decision;
      }
      if (decision.action === "restart-current") {
        set({ direction: 1 });
        return decision;
      }
      set({ direction: 1, index: clampIndexToQueue(decision.index, state.queue.length) });
      return decision;
    },

    prevIntent(currentPosSeconds) {
      const decision = decidePrev(currentPosSeconds, state.index, state.queue.length);
      set({ direction: -1 });
      if (decision.action === "advance") {
        set({ index: clampIndexToQueue(decision.index, state.queue.length) });
      }
      return decision;
    },

    jumpTo(i) {
      if (i < 0 || i >= state.queue.length) return;
      set({ direction: i >= state.index ? 1 : -1, index: i, isPlaying: true });
    },

    /**
     * Crossfade handover advance: wraps modulo the queue length exactly like
     * the pre-engine player did at the 0.15s handover point and on secondary
     * 'ended'. Deliberately bypasses repeat=off stop semantics because the
     * fade has already begun (documented quirk preserved from production).
     */
    advanceWrapForHandover() {
      if (state.queue.length === 0) return;
      set({ index: (state.index + 1) % state.queue.length });
    },

    moveInQueue(from, to) {
      if (from === to || from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length) return;
      const copy = [...state.queue];
      const [item] = copy.splice(from, 1);
      if (!item) return;
      copy.splice(to, 0, item);
      set({ queue: copy, index: clampIndexToQueue(computeIndexAfterMove(from, to, state.index), copy.length) });
    },

    insertNext(track) {
      if (!track) return;
      const cur = state.queue[state.index];
      if (cur && cur.id === track.id) return; // chèn chính bài đang phát = no-op
      const insertAt = state.queue.length ? state.index + 1 : 0;
      const copy = [...state.queue];
      copy.splice(insertAt, 0, track);
      // Không đổi index, không đổi isPlaying — bài đang phát giữ nguyên,
      // queue chỉ "mọc" 1 slot sau nó. baseQueue KHÔNG chèn (nó là
      // library snapshot; queue là bản phát). Shuffle đang bật thì vẫn
      // chèn sau current — "phát kế tiếp" là ý định rõ ràng của user,
      // thắng mọi thứ tự shuffle.
      set({ queue: copy });
    },

    toggleShuffle() {
      const on = !state.shuffle;
      const cur = state.queue[state.index];
      if (on && cur) {
        // F2: smart shuffle — rải nghệ sĩ, current giữ đầu.
        set({
          shuffle: true,
          queue: smartShuffled(state.baseQueue.length ? state.baseQueue : state.queue, (t) => t.artist, cur),
          index: 0,
        });
      } else if (cur) {
        const base = state.baseQueue.length ? state.baseQueue : state.queue;
        const restoredIndex = Math.max(
          0,
          base.findIndex((t) => t.id === cur.id),
        );
        set({ shuffle: false, queue: base, index: restoredIndex });
      } else {
        set({ shuffle: on });
      }
    },

    cycleRepeat() {
      const repeat: RepeatMode = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      set({ repeat });
      return repeat;
    },

    setVolume(v) {
      const volume = Math.min(1, Math.max(0, v));
      set(volume > 0 ? { volume, muted: false } : { volume });
    },

    toggleMute() {
      if (!state.muted) {
        set({ muted: true, prevVolume: state.volume > 0 ? state.volume : state.prevVolume });
      } else {
        set({ muted: false, ...(state.volume === 0 ? { volume: state.prevVolume } : {}) });
      }
    },

    setCrossfade(seconds) {
      set({ crossfade: clampCrossfade(seconds) });
    },
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
  };
}

/** Application-wide singleton — one global player per tab (§2 lifecycle). */
export const playerEngine = createPlayerEngine();
