# PHASE 5 ARCHITECTURE DECISIONS (implementation record, 2026-08-24)


> ℹ️ **POINT-IN-TIME EVIDENCE**: test counts trong tài liệu này là snapshot lịch sử. Current truth duy nhất: docs/audit/CURRENT_VERIFICATION.md.

Build contract: docs/PHASE_5_ARCHITECTURE.md (P5.1..P5.6). All steps shipped
behind existing gates; 242/242 tests green after each stage.

## P5.1 — Engine store extraction

- New `src/lib/player-engine.ts`: plain-object store + subscribe, singleton
  `playerEngine`; consumed via `useSyncExternalStore`. Kills the `indexRef`
  mirror (engine reads own state synchronously). Identity-stable no-op guard
  prevents subscriber churn for unchanged states.
- All transport decisions still delegate to frozen pure helpers in
  `player-queue.ts` (decideNext/decidePrev/shuffled/clamp*/computeIndexAfterMove).
- Provider (`player.tsx`) now only projects state + executes DOM/network.
- Deviations: none from contract §1. Quirk preservation documented as AD-6.

## P5.2 — Persistence client

- `src/lib/player-persistence.ts`: timer-injectable debounced persister
  (3000ms), guest localStorage mirror (`duckroom.player.session`, queue ids
  capped 200), pure `resolveRestoreTarget`.
- Triggers wired: pause, track-change, seek (debounced), visibilitychange→hidden
  flush, beforeunload flush. Leader-only when a mesh exists.
- Members restore via new lightweight `getPlaybackStateServer` RPC (avoids the
  full library read); guests restore from the local mirror. Restore loads the
  track paused at saved position (pendingSeek applied on loadedmetadata) and
  surfaces a Continue pill in PlayerBar. Finished tracks restart at 0.
- Guest writes skip member RPCs entirely (no wasted 401s).

## P5.3 — BroadcastChannel leader election

- `src/lib/player-broadcast.ts`: PURE reducer for HELLO/ELECT/LEADER/LEDR/
  STATE_SYNC/COMMAND/BYE with deterministic lowest-tabId tie-break and
  missed-heartbeat re-election (2s × 3). Channel `duckroom-player-v1`.
- Leader owns live audio + persistence + history writes; followers pause their
  elements, render from throttled STATE_SYNC (≥1s), and route transport
  commands to the leader. BYE on unmount triggers immediate re-election.
- This closes the present double-audio / duplicate-history defect class named
  in AGENT_HANDOFF.md.

## P5.4 — MediaSession hardening

- Action handlers registered once on mount via stable refs (empty-dep effect),
  cleaned up on unmount; metadata effect keys off projected track id;
  setPositionState throttled to ≥1000ms deltas.

## P5.5 — Recovery polish

- Self-healing retry cap resets when a fresh URL succeeds (was monotonic).
- offline→online resumes at last position with a fresh signed URL when the
  user was playing before the drop.
- stalled >8s during playback soft-reloads the source once per track.

## ReplayGain (§11.5)

See global AD-3. Mode preference persisted at `duckroom.player.rg.mode`;
cycler UI in PlayerBar (Off → Track → Album).

## Testing

- New suites: player-engine.test.ts (12), player-broadcast.test.ts (6),
  player-phase5.test.ts (12 — persistence debounce/guest mirror/restore +
  RG multiplier math).
- Total 242/242 green; tsc/eslint/build/scan all pass post-merge.
