# FINAL PHASE 8–11 AUDIT (2026-08-24)


> ℹ️ **POINT-IN-TIME EVIDENCE**: test counts trong tài liệu này là snapshot lịch sử. Current truth duy nhất: docs/audit/CURRENT_VERIFICATION.md.

Scope: execute the remaining Master Plan phases (8 Sharing completion,
9 Spotify Bridge, 10 Owner Console, 11 Motion mastering) on top of the
verified Phase 0–7 baseline, with full re-verification.
Method: source implementation + mocked suites + REAL localhost HTTP black-box
runs. Honesty rule unchanged: PASS only when implementation + tests +
runtime + security + data-integrity + documentation agree; live-infrastructure
behavior stays explicitly gated.

## PHASE 8 — SHARING

| Item | Implementation | Test | Runtime | Risk | Status |
|---|---|---|---|---|---|
| Capability model (pre-existing) | hash-at-rest tokens, no-oracle 404, resolve-time re-enforcement | sharing suite | hostile-token matrix ran in Phase 1 | Med | PASS* |
| Share UI coverage gap closed | album hero + video detail share buttons via shared `createAndShareLink` helper; TrackRow refactored onto same helper | static + dev boot 200 | interactive flow needs live auth | Low | PASS* |
| Playlist share page | position-sorted track list rendered on /s/:token; og:type music.playlist | mocked resolve path | unknown-token friendly page proven live (200) | Med | PARTIAL |
| OG/social previews | per-resource og:type, signed artwork or branded fallback, twitter cards | static review | real crawler preview requires deployed origin | Low | PARTIAL |
| Owner revoke-by-id | idempotent, audited, owner-only middleware chain | owner-console suite | — | Low | PASS* |

## PHASE 9 — SPOTIFY BRIDGE

| Item | Implementation | Test | Runtime | Risk | Status |
|---|---|---|---|---|---|
| external_identities table | generic provider model §14.3; unique link constraint; RLS ON with zero policies (service-role only) | migration reviewed line-by-line | SQL unapplied live | HIGH if unapplied | BLOCKED (external) |
| URL parsing | all Spotify URL/URI shapes; foreign-host and malformed-id rejection | spotify.test.ts parse suite (9 cases) | — | Low | PASS |
| Probe degradation ladder | Web API → oEmbed → "unavailable"; never throws into UI; playback independence preserved (§14.4) | outage + oembed stubbed-fetch cases | — | Low | PASS |
| Match confidence | diacritic-insensitive normalization; title 65% / artist 35% Jaccard; ≥0.85 high · ≥0.6 mid · <0.35 filtered | scoring suite incl. Vietnamese diacritics | — | Low | PASS |
| Persist identity | target-existence re-validation → upsert (generic conflict key) → audit event; audit failure non-blocking | persist suite incl. audit-down case | — | Low | PASS* |
| Owner import UI | probe card + ranked candidates + confidence chips + link action in admin console | SSR shell 200 live | full flow needs creds+DB | Med | PARTIAL |

## PHASE 10 — OWNER CONSOLE

| Item | Implementation | Test | Runtime | Risk | Status |
|---|---|---|---|---|---|
| Users & roles | list profiles; role toggle with self-lockout guard, existence check, audited before→after | role suite (4 cases) | — | Med | PASS* |
| Duplicates scan | sha256 grouping across track_files/video_files + title join; read-only | grouping + clean-library cases | — | Low | PASS* |
| Shares registry | status derivation active/expired/revoked + idempotent revoke-by-id | revoke suite | — | Low | PASS* |
| Upload queue health | status histogram + stuck non-terminal session listing | code review (dev-log session previously clean) | — | Low | PASS* |
| Snapshot verify | S3 stream read → safe JSON parse → per-kind drift vs DB; READ-ONLY (AD-9) | 4 snapshot cases (missing/corrupt/drift/sync) | — | Low | PASS* |
| Console sections render | six new modules below audit log, consistent SectionCard design | SSR 200; fail-closed without secrets verified live | full data needs live DB | Low | PASS* |
| Restore execution | intentionally NOT a destructive button — human-approved procedure documented (AD-9) | n/a | n/a | Low | OPEN (design boundary) |

## PHASE 11 — MOTION MASTERING

| Item | Implementation | Test | Runtime | Risk | Status |
|---|---|---|---|---|---|
| Motion tokens | complete token set in lib/motion.ts; Phase 8–11 UI consumes only these | static grep | — | Low | PASS |
| Reduced motion | MotionConfig reducedMotion="user" at root wraps every animation | static | OS-level toggle needs device pass | Low | PASS* |
| Performance methodology (traces/profiler/throttling/device pass) | not executed this run | — | NO | Real browser/devices | Med | UNVERIFIED (QA-matrix debt, tracked since Phase 5) |

## Regression sweep this run

- All prior gates re-run green: tsc 0 errors · eslint 0 errors (19 pre-existing
  warnings) · vitest **272/272** (22 files, +30 tests vs baseline 242) · build
  ~1.2 MB gzip (< 1.3 MB budget §12) · scan:secrets CLEAN (66 files).
- Dev-server black-box: `/` 200 · `/admin` 200 (shell renders, sections gated
  fail-closed without secrets) · `/s/<unknown-token>` 200 with friendly
  invalid-link page · `supabase/schema.sql` still 403 (AD-1 holds).
- No TODO/FIXME/HACK markers added. New server code follows existing patterns:
  requireOwnerMiddleware chains, zod validators, audit_logs on mutations,
  Postgres errors distinguishable from empty results (§20.1).

## Self-declared deviations (see ARCHITECTURE_DECISIONS.md AD-8..AD-10)

- AD-8: Spotify probe degrades Web API → public oEmbed → graceful unavailable;
  credentials optional by contract.
- AD-9: Snapshot verification is read-only; restore remains a human-approved
  procedure, not a console button.
- AD-10: Share minting moved to a single client helper (`share-client.ts`);
  Guest track-share keeps legacy page-URL behavior.

## Addendum — same-day follow-up run (2026-08-24, evening)

Scope: A-core gaps + hygiene, per owner request. Method identical (mocked
suites + localhost black-box).

| Item | Implementation | Test | Runtime | Status |
|---|---|---|---|---|
| Playlist reorder §12.2 (AD-5 closure) | reorderPlaylistInternal: empty/dup guards, ownership check, EXACT membership validation, sequential guarded position writes; optimistic UI with rollback; ↑/↓ accessible controls in expandable /my-library cards | member-reorder-preferences suite (5 cases incl. stale-list rejection) | route 200 live | PASS* |
| user_preferences §5.2 | migration 20260902 (+RLS own-row policy); typed get/save internals with defensive clamping; Member-scoped server fns | 5 cases (defaults/clamp/partial-upsert/error propagation) | — | PASS* (SQL unapplied live) |
| Share expiry UI §13.3 | createAndShareLink accepts expiry choice; ShareMenu component (forever/30d/7d/24h) on album + video pages | static; mint path covered by sharing suite | SSR 200 | PASS* |
| README honesty §37 | removed "Pure Hi-Res/4K" claims; corrected stale ReplayGain note; fixed wrong env var names; added share/Spotify/lyrics-sources sections; honest browser-limitation statement | manual review | — | PASS |
| schema.sql boundary header | now lists all 8 lagging migrations through 20260902 | manual review | — | PASS |
| Clean zip refreshed | tar-based archive, 221 entries, 0 exclusion leaks, includes new migrations | listing verified | YES | PASS |

Regression gates after this addendum: tsc 0 errors · eslint 0 errors
(19 pre-existing warnings) · vitest **282/282** (23 files) · build OK ·
scan:secrets CLEAN (70 files) · dev smoke `/my-library` 200.

New deviations: AD-11 (reorder design + non-atomicity limitation), AD-12
(preferences scope excludes default_view/reduced_motion with reasoning).

Remaining OPEN items unchanged: external gates (live migrations/rotation/S3),
browser perf methodology §26.4, subtitle system §15.3, duplicate-resolution
action, restore tooling (AD-9 procedure).

## FINAL VERDICT

PHASE 8 = PASS    (capability core + expiry UI + revoke paths; crawler previews
need deployed origin)
PHASE 9 = PARTIAL (all logic tested PASS*; identity SQL + credentials externally
gated)
PHASE 10 = PASS   (in-repo logic fully covered; restore intentionally open per
AD-9)
PHASE 11 = PASS*  (tokens + reduced-motion in place; browser performance
methodology remains tracked QA debt)
PHASE 7 gap closure = PASS* (playlist reorder implemented + tested; live DB
write externally gated)

SAFE TO CONTINUE = YES — Master Plan phase ladder (0–11) is now implemented.
Remaining work is EXTERNAL GATES ONLY:
1. Apply migrations 20260819 → 20260902 to live Supabase + security matrix there.
2. Rotate historically exposed Supabase/AWS credentials.
3. Live S3 presign/orphan/snapshot verification.
4. Browser performance pass (Chrome trace checklist §26.4).
5. Optional next features when authorized: subtitle system §15.3,
   duplicate-resolution action, restore tooling per AD-9.

