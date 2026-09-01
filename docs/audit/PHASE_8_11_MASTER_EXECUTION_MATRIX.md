# PHASE 8–11 MASTER EXECUTION MATRIX


> ℹ️ **POINT-IN-TIME EVIDENCE**: test counts trong tài liệu này là snapshot lịch sử. Current truth duy nhất: docs/audit/CURRENT_VERIFICATION.md.

Generated: 2026-08-24 (Phase 8–11 execution run on top of the completed
Phase 0–7 baseline). Statuses: PASS · PARTIAL · OPEN · BLOCKED · UNVERIFIED.
Evidence = file/function references or command output, never percentages alone.
Live-infrastructure behavior remains externally gated exactly like Phases 0–7.

## PHASE 8 — SHARING (completion of pre-existing capability model)

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Share token model §13.3 | 128-bit token, SHA-256 hash-at-rest, indistinguishable 404, revoke creator-or-owner | lib/sharing.ts:16-38,132-295; sharing.test.ts | Mocked only | Live DB | Medium | PASS* |
| Short URL `/s/{token}` | routes/s.$token.tsx loader catches RPC errors → friendly page | s.$token.tsx:9-18 | YES — unknown token returns 200 + friendly invalid-link page live | No | Low | PASS |
| Share page content §13.2 | Artwork, title, artist, duration, inline audio/video players, Play CTA | s.$token.tsx:74-141 | Static review | No | Low | PASS |
| Playlist share rendering | resolveShareLinkInternal embeds position-sorted track list (id/title/artist/duration) | sharing.ts playlist branch; s.$token renders numbered list | Mocked only | Live DB | Medium | PARTIAL |
| OpenGraph metadata §13.4 | og:type per resource (music.playlist/music.song/video.other), og:image signed-or-fallback, twitter cards | s.$token.tsx head() | Static review (crawler preview needs deployed origin) | Deployed domain | Low | PARTIAL |
| Revocation §13.3 | Existing revoke-by-token + NEW owner console revoke-by-row-id with audit | sharing.ts:revokeShareByIdInternal; owner-console.test.ts | Mocked only | Live DB | Low | PASS* |
| Share UI coverage | TrackRow (existing), album hero button (NEW), video detail button (NEW); shared helper lib/share-client.ts dedupes Web Share/clipboard flow | albums.$albumId.tsx handleShareAlbum; videos.$videoId.tsx handleShareVideo | Dev-server boot 200; interactive share requires live auth | Live auth | Low | PASS* |

## PHASE 9 — SPOTIFY BRIDGE

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| External identity model §14.3 | Generic `external_identities` table (provider/resource_type/external_id/resource_kind/resource_id unique link); Spotify = first provider; RLS enabled with ZERO policies (service-role only, fail-closed) | supabase/migrations/20260901_duckroom_v2_external_identities.sql | SQL NOT applied to live Supabase | Live Supabase | HIGH if unapplied | BLOCKED (external gate, same as 20260830/31) |
| URL parsing | parseSpotifyUrl handles open.spotify.com/{type}/{id}, /user/{uid}/playlist/{pid}, spotify: URIs; rejects foreign hosts/malformed ids | services/spotify.ts:33-77; spotify.test.ts parse suite | Unit tests | No | Low | PASS |
| Import flow §14.2 | probeSpotifyResourceServer (owner-only) → degradation ladder AD-8: Web API client-credentials → public oEmbed → status "unavailable" | services/spotify.ts probe internals; admin.tsx SpotifyImportSection | oEmbed path unit-tested with stubbed fetch; outage path unit-tested | api.spotify.com | Medium | PASS* |
| Local-file matching + confidence §14.2 | findLocalMatchesServer fetches id/title/artist (≤5000 rows, §19.4 scale) and scores via computeMatchConfidence (title 65% Jaccard/exact + artist 35%, diacritic-insensitive normalization) | services/spotify.ts normalize/computeMatch; spotify.test.ts scoring suite | Unit tests | Live DB for candidates | Medium | PASS* |
| Owner confirmation | linkExternalIdentityInternal re-validates target row existence before upsert (onConflict generic key), writes audit_logs "spotify.identity_linked"; audit failure never blocks business op | services/spotify.ts link internals; spotify.test.ts persist suite | Mocked only | Live DB | Low | PASS* |
| Fail gracefully §14.4 | Probe returns {status:"unavailable"} on total network outage; playback has zero Spotify dependency (no imports outside services/spotify.ts) | grep: no runtime references from player/library; spotify.test.ts outage case | Unit tests prove app-path independence | Internet | Low | PASS |
| Owner UI | Admin console section: URL input → probe card (artwork/title/source badge) → ranked local candidates with % confidence chips → per-candidate "Liên kết" action | admin.tsx SpotifyImportSection | SSR renders section shell (200 live); full flow needs live credentials+DB | Live env vars | Medium | PARTIAL |
| Env contract | SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET documented OPTIONAL in .env.example; absence degrades, never breaks | .env.example; getSpotifyAccessToken returns null without creds | Unit tested (creds absent → oembed/unavailable) | No | Low | PASS |

## PHASE 10 — OWNER CONSOLE / HEALTH (completion)

Pre-existing: overview counts, storage diagnostics, orphan scan/cleanup (with staging protection + re-validation), audit log viewer, snapshot creation.

| Module §25.1 | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Users management | getOwnerUsersServer (profiles list) + setUserRoleInternal: self-change lockout guard, target-existence check, no-op when unchanged, audited before→after trail | owner-data.ts Users block; owner-console.test.ts role suite | Mocked only | Live DB/RLS | Medium | PASS* |
| Duplicates scan §24.4 | scanDuplicateMastersInternal groups track_files+video_files by sha256 (>1), joins titles, reports size/verified state; read-only | owner-data.ts duplicates block; owner-console.test.ts grouping cases | Mocked only | Live DB | Low | PASS* |
| Shares registry | getOwnerSharesServer derives active/expired/revoked status; revokeShareByIdInternal idempotent + audited | owner-data.ts shares block; owner-console.test.ts revoke cases | Mocked only | Live DB | Low | PASS* |
| Upload queue health §25.2 | getUploadHealthServer counts upload_sessions by status + lists ≤20 non-terminal stuck sessions | owner-data.ts uploads block | Mocked only (dev-log session previously clean) | Live DB | Low | PASS* |
| Snapshot verification §24 | verifyBackupSnapshotInternal streams library_manifest.json from S3, safe-parses JSON, computes per-kind drift (DB − snapshot); READ-ONLY by design (AD-9) | owner-data.ts snapshot block; owner-console.test.ts 4 cases incl. corrupt JSON | Mocked only | Live S3 | Low | PASS* |
| Console UI wiring | Six new sections render below audit log: Spotify Import, Users & Roles, Duplicates, Shares, Upload Queue, Snapshot Verify; all behind existing requireOwner middleware chain | admin.tsx SectionCard + sections | SSR 200 live; fail-closed without secrets verified (sections hidden until health loads) | Live auth | Low | PASS* |
| Restore operation | NOT implemented as a button (AD-9). Snapshot verify provides the diagnostic half; actual restore stays a human-approved procedure using the manifest tooling | AD-9 in ARCHITECTURE_DECISIONS.md | n/a | n/a | Low | OPEN (intentional design boundary) |

## PHASE 11 — MOTION / VISUAL MASTERING

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Motion token system §18.1 | Central tokens: springSnappy/Smooth/Gentle/Pill, easeDuck, durFast/Base/Slow, tween*, tapScale/hoverLift, pageVariants, list stagger, modal overlay/panel variants | lib/motion.ts | Static | No | Low | PASS |
| Reduced motion §17/§26 | `<MotionConfig reducedMotion="user">` wraps entire app — every motion/react animation honors OS reduce-motion automatically | __root.tsx:154 | Static (OS toggle needs real browser/device pass) | Browser | Low | PASS* |
| Token adoption breadth | New Phase 8–11 UI uses springSnappy/tapScale/tweenBase exclusively (share buttons, admin sections); no ad-hoc durations introduced this run | grep motion imports in touched files | Static | No | Low | PASS |
| Performance verification methodology §26.4/§11 | Chrome Performance trace, React Profiler, CPU/network throttle, low-power device pass — NOT executed this run | — | NO | Real browser + devices | Medium | UNVERIFIED (tracked QA-matrix item, same as Phase 5 perf budget) |
| Route/theme transition polish | pageVariants/modal variants already consumed across routes; theme switch untouched this run (pre-existing smooth implementation) | routes usage | Static | No | Low | PASS |

## Verification commands executed this run (2026-08-24)

```text
npx tsc --noEmit        PASS (0 errors)
npx eslint .            PASS (0 errors / 19 pre-existing warnings — react-refresh + player hooks noise)
npx vitest run          PASS (272/272 across 22 files — was 242/242)
npm run build           PASS (5.61 MB total / ~1.2 MB gzip < 1.3 MB budget §12)
npm run scan:secrets    CLEAN (66 client files)
Dev-server black-box    / 200 · /admin 200 · /s/<unknown-token> 200 friendly page · supabase/schema.sql 403 (AD-1 holds)
```

## EXTERNAL GATES (unchanged + one addition)

1. Apply migrations 20260819 → **20260901** to live Supabase + run the Guest/Member/Owner security matrix there.
2. Credential rotation (Supabase service key, AWS keys).
3. Live S3 presign/orphan/snapshot verification against the real bucket.
4. Set SPOTIFY_CLIENT_ID/SECRET (optional) to unlock full-metadata import mode.
