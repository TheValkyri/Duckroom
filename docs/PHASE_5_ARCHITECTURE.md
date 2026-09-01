# PHASE 5 ARCHITECTURE - Player V2 Design (prepared 2026-08-24)

Status: ARCHITECTURE ONLY. No Phase 5 implementation claimed. This document is the build contract.

## 1. State ownership

Single engine store (plain object + useSyncExternalStore), generalizing the proven time-store pattern:

engine = {
  queue, baseQueue, index, isPlaying, volume, muted, shuffle, repeat,
  crossfade, direction, expanded, lyricsOpen, queueOpen,
  channels: { active: A|B, trackIdA, trackIdB, handingOver },
  time: separate fine-grained store (unchanged),
}

- All transport mutations go through player-queue.ts pure decisions.
- React Context shrinks to: current track projection + action callbacks (UI flags like lyricsOpen move OUT of the global context into local UI state where only one component consumes them).
- Kill indexRef mirror: engine reads its own index synchronously.

## 2. Player lifecycle

One <PlayerProvider> mounted in __root (GlobalPlayer). <audio> A/B elements rendered once at root; route changes never unmount them.

## 3. Queue model

- queue/baseQueue arrays of Track (immutable updates); identity-based replace with clampIndexToQueue on every library sync.
- >500 tracks: virtualize QueuePanel; shuffled() already O(n).

## 4. Playback persistence (backend exists; client wires it)

- Members: playback_state upsert - save CURRENT track id + real positionSeconds:
  triggers: pause, seek-end, track change, beforeunload/visibilitychange(hidden) debounced 3s.
  Restore: after first successful library hydration, if saved state exists and track resolvable -> load track paused at positionSeconds; show Continue pill.
- Guests: localStorage mirror duckroom.player.session (trackId+position+queue ids capped 200).
- History append stays on ended (wall-clock attribution already correct).

## 5. BroadcastChannel protocol (multi-tab)

Channel name: duckroom-player-v1 (versioned).
Messages: {type: HELLO|ELECT|LEADER|STATE_SYNC|COMMAND, tabId, ts, payload}
Rules:
- On start: send HELLO; existing leader answers LEADER within 150ms; else ELECT; lowest random tabId wins, broadcasts LEADER.
- Only leader owns live <audio> playback. Followers render UI from STATE_SYNC (throttled 1s: trackId,index,isPlaying,position coarse) and keep their audio elements muted/paused.
- Commands from follower (play/pause/next/prev/seek): sent as COMMAND; leader executes and re-syncs.
- Leader loss: heartbeat LEDR every 2s; on 3 missed heartbeats followers re-elect.
- Persistence writes: LEADER ONLY (kills duplicate-history bug class today).

## 6. MediaSession

Register handlers once on mount (empty deps + refs); metadata update on track change; setPositionState throttled to >=1s deltas.

## 7. Visibility

Audio continues in hidden tabs (product requirement). rAF consumers skip work while hidden (Visualizer already fixed). Hidden-tab transition triggers a persistence save.

## 8. Error recovery

- Existing self-healing URL refresh (cap 2) extended: reset cap when a fresh URL succeeds.
- online event after offline: if was-playing flag set, re-fetch signed URL and resume at last position.
- stalled >8s during playing: soft-reload source at same position once per track.

## 9. Gapless strategy

KEEP dual-element equal-power crossfade (Decision D2). Handover protocol hardened this audit (secondary error listener). Repeat=one bypasses secondary entirely (already).

## 10. prev/next semantics

player-queue.ts decidePrev/decideNext remain the single authority (tested). Threshold constant exported; UI may surface settings later without logic change.

## 11. Seek behavior

Seek kills secondary buffer immediately (existing); persists position via debounce; no history write for seeks.

## 12. Performance budget

- Time subscribers only: SeekBar/Lyrics/time labels (already isolated)
- Context consumers: current-track projection changes trigger TrackRow highlight scope only via memo equality on id
- No long task >50ms on transport interactions; verified via Chrome tracing checklist in Plan QA matrix
- Bundle gzip ceiling 1.3MB

## 13. Testing strategy

- player-queue.ts: existing real tests continue
- Engine store: new unit tests (leader election state machine as pure reducer; persistence debounce logic)
- BroadcastChannel protocol: reducer-level tests + jsdom integration with MessageChannel polyfill
- Persistence: mocked member-data asserts write triggers and restore path
- Manual QA matrix: reuse Plan section 31 rows + dual-tab scenario script

## 14. Migration plan (implementation order)

P5.1 Engine store extraction (no behavior change) -> P5.2 Persistence client wiring -> P5.3 BroadcastChannel leader election -> P5.4 MediaSession hardening -> P5.5 recovery polish -> P5.6 QA matrix pass.
Each step ships behind existing gates (tsc/lint/vitest/build/scan) and keeps prior phases green.