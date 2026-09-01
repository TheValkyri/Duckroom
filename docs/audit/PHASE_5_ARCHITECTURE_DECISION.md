# PHASE 5 ARCHITECTURE DECISION RECORD - Master Plan Deviations

Every deviation below is EXPLICIT. Requirement satisfied is stated per item.

## D1. Transport semantics: pure-function module instead of class-based AudioEngine split

- Requirement: Master Plan 11.1 - separate Player Store / Queue Store / Audio Engine; React as consumer only.
- Original proposal: extract an AudioEngine class owning <audio> elements, plus separate stores.
- Problem with original: a class engine re-introduces imperative ownership that duplicates React state during migration, invites lifecycle bugs, and its testable core is exactly the decision logic - not the element plumbing.
- Chosen design: src/lib/player-queue.ts pure decision functions (prev/next/repeat/shuffle/crossfade window/equal-power gains/clamps) consumed by PlayerProvider; time isolated behind useSyncExternalStore store; dual <audio> elements stay declaratively rendered.
- Why superior: 100% deterministic unit coverage of every transport rule (212-suite), zero duplicated state ownership for decisions, engine plumbing stays minimal and inspectable.
- Trade-off: audio-element control remains inside the provider effect graph (acceptable: effects are idempotent guards, not state authority).
- Migration impact: none - already implemented in Phase 0-4 closure; Phase 5 builds ON it.
- Testing: player-semantics.test.ts real-module tests; handover covered by code-path assertions + runtime smoke.
- Rollback: none needed (pure additive refactor already landed).
- Requirement satisfied: YES - decisions are engine-grade and React-independent; playback never depends on render pressure.

## D2. Crossfade architecture: KEEP dual-element equal-power crossfade; reject WebAudio buffer scheduling for Phase 5

- Requirement: Plan 11.3/11.6 - configurable crossfade 0-10s, gapless best-effort, no absolute claims.
- Alternative considered: WebAudio AudioBufferSourceNode scheduling with GainNodes (sample-accurate).
- Problem: full-file decode into AudioBuffers for lossless masters = large memory spikes; complexity high; the existing dual-element equal-power fade already masks the boundary; replaygain/EQ later can still adopt WebAudio incrementally.
- Chosen: keep dual elements; harden protocol this audit (secondary onerror clears registration so primary ended->next() fallback stays authoritative).
- Trade-off: fade precision bounded by element timing (~tens of ms) - acceptable under best-effort wording.
- Rollback: N/A (no change of paradigm).
- Requirement satisfied: YES, with honest best-effort framing preserved.

## D3. Bulk edit commit model: per-item atomicity instead of batch transaction

- Requirement: Plan 8.4 bulk editing incl. apply-to-selected.
- Original implication: one atomic batch commit.
- Problem: unrelated masters failing together (all-or-nothing) is worse operationally than independent commits; each item already carries CAS guards + audit + compensation debt.
- Chosen: multi-select -> field patch applied to selected review items -> each item flows through the normal pipeline individually; failures isolate per item with visible status chips.
- Security/concurrency: unchanged per-item guarantees; no new privileged path.
- Rollback: UI-level feature, trivially removable.
- Requirement satisfied: YES (bulk editing exists; atomicity scope consciously narrowed and documented).

## D4. Confidence: explicit STATUS model now; numeric scores rejected

- Requirement: Plan 8.3 confidence/warnings per signal.
- Rejected: fabricated percentages/thresholds (Plan prohibition: no meaningless hardcoded numbers).
- Chosen: four-signal status matrix (metadata/artwork/integrity/duplicate) derived from verifiable events only; surfaced as ReviewChips.
- Future path: numeric confidence allowed only when backed by measured signals (parser warning counts, tag completeness) - documented trigger for revisiting.
- Requirement satisfied: YES (review behavior identical; honesty improved).

## D5. Multi-tab coordination: BroadcastChannel leader-election ADDED to Phase 5 scope (was implicit)

- Requirement: Plan Phase 5 lists BroadcastChannel.
- Decision: implement leader election FIRST in Phase 5 because double-audio today is a present defect, not polish. Protocol fixed in docs/PHASE_5_ARCHITECTURE.md (versioned channel name, leader heartbeat, follower silent-render).
- Requirement satisfied: planned explicitly; no silent deferral.

## Non-deviations reaffirmed
player-queue.ts untouched going forward (template status). Dual-channel gapless kept. Server-authoritative media facts kept everywhere.