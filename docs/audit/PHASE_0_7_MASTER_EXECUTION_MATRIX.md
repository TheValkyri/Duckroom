# PHASE 0–7 MASTER EXECUTION MATRIX


> ℹ️ **POINT-IN-TIME EVIDENCE**: test counts trong tài liệu này là snapshot lịch sử. Current truth duy nhất: docs/audit/CURRENT_VERIFICATION.md.

Generated: 2026-08-24 (Phase 0–4 clean + Phase 5/6/7 execution run).
Statuses: PASS · PARTIAL · OPEN · BLOCKED · UNVERIFIED · NOT STARTED.
Evidence = file/function references or command output, never percentages alone.

## PHASE 0 — FREEZE & BASELINE

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| npm ci clean | package-lock.json pinned install | `npm ci` → 459 pkgs, 0 vulnerabilities (2026-08-24) | YES | No | Low | PASS |
| typecheck | strict tsconfig (exactOptionalPropertyTypes…) | `npx tsc --noEmit` PASS | YES | No | Low | PASS |
| lint | eslint 9 flat config | 0 errors / 21 pre-existing warnings (all react-refresh/fast-refresh noise in shadcn scaffolding + player hooks deps) | YES | No | Low | PASS |
| tests | vitest.config.ts now explicit | 212/212 across 17 files | YES | No | Medium (mocked-transport only) | PASS |
| build | vite build && nitro build --preset vercel | 5.47 MB total / 1.17 MB gzip (< 1.3 MB budget §12) | YES | No | Low | PASS |
| secret scan | scripts/scan-client-secrets.mjs shape-based gate | CLEAN, 62 client files | YES | No | Low | PASS |
| CI pipeline | .github/workflows/ci.yml runs all gates on push/PR | ci.yml steps 1-8 | NO (not executed here) | GitHub runners | Low | UNVERIFIED |
| Clean package (zip/release) | no node_modules/dist/.vercel/.env in archive | duckroom-source-clean.zip verified tree | YES | No | Low | PASS |
| Docs consistency — single truth | AGENT_HANDOFF.md is current; stale gates archived under docs/archive/ | docs tree inspected; FINAL_RELEASE_GATE.md was MISSING → recreated this run | PARTIAL | No | Medium | PARTIAL→PASS after this run |
| Migration order & snapshot honesty | 12 migrations append-only 20260819→20260830 | schema.sql coverage boundary header added (missing 4 migrations documented) | YES (static) | No | Low | PASS |

## PHASE 1 — SECURITY P0

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| JWT fail-closed verification | auth.server.ts:22 verifyMemberAuthorization — only supabase.auth.getUser(token), no unsigned decode | code + auth-policy.test.ts | Mocked only | Live Supabase | High if unverified live | PARTIAL |
| Missing-secret fail-closed | server-env.ts:8 requireServerEnv throws [SERVER_CONFIG] | serverSecurityMiddleware auth-guard.ts:120 | YES (dev without secrets → error page, see Stage 2) | No | Low | PASS |
| Guest/Member/Owner matrix | optionalAuth/requireMember/requireOwner middleware chains on all 51 RPCs | grep export *Server + .middleware() audit | Mocked only | Live Supabase | Medium | PARTIAL |
| Role from DB not client claims | profiles.role sole source; default member | auth.server.ts:98-125 | Mocked only | Live Supabase | Medium | PARTIAL |
| Client secret leakage | supabase.ts/supabase-client.ts split; service-role never in client graph; scanner gate | scan:secrets CLEAN | YES | No | Low | PASS |
| S3 path traversal / namespace | validateStorageKey write=canonical prefixes only; traversal chars rejected | auth-guard.ts:56; storage-key.test.ts | Mocked only | Live S3 | Medium | PARTIAL |
| Presign ownership/expiry | requestPresignedUploadUrlServer owner-only, 900s TTL | s3-functions.ts:44 | Mocked only | Live S3 | Medium | PARTIAL |
| Sharing capability model | 128-bit token, SHA-256 at rest, indistinguishable 404, resolve-time re-enforcement, revoke creator-or-owner | sharing.ts:16-38,132-145,270-295; sharing.test.ts | Mocked only | Live Supabase | Medium | PARTIAL |
| localStorage auth abuse | No custom auth storage; supabase-js session mgmt only; role spoofing irrelevant (server re-verifies) | useAuth.ts | Static review | No | Low | PASS |

## PHASE 2 — DATA FOUNDATION

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Canonical physical truth | track_files/video_files own size/sha256/codec/container/sample_rate/bit_depth/duration/resolution | migration 20260822+20260825; share resolver prefers masterFile with verified_at (sharing.ts:166) | Mocked only | Live DB | Medium | PARTIAL |
| Legacy fields as display/fallback only | tracks.format/bit_depth/sample_rate remain but every reader overlays track_files when verified rows exist | s.$token resolver; getPublicMasterLibraryServer | Mocked only | Live DB | Medium | PARTIAL |
| CAS on all mutations | domain-mutations.ts updateAlbum/updateTrack/updateVideo/trash*/restore* require expectedVersion; delete flows eq(version) | domain-mutations.ts:103-140; s3-functions.ts:364-383 | Mocked + simulated A/B stale test (domain-mutations.test.ts) | Live DB | Low | PASS (logic) / PARTIAL (live) |
| Destructive ops compensation | cleanup-debt insert BEFORE delete; DB-first deletion; S3 failure → debt failed + durable message | s3-functions.ts:348-410,457-516 | Mocked only | Live S3 | Medium | PARTIAL |
| Lyrics integrity | 20260830 R1 purges ->>0 truncation poison, dedupes, full-fidelity rebuild from tracks.lyrics, delete-on-empty | migration 20260830 header R1; lyrics-migration-integrity.test.ts | SQL NOT applied to live | Live Supabase | HIGH (unapplied) | BLOCKED (external) |
| Mass-deletion safety guard | replace_master_library_atomic requires allowMassDeletion=true + expected revision | migration 20260824 section | Mocked only | Live DB | Medium | PARTIAL |
| Fresh bootstrap vs upgrade | All migrations IF NOT EXISTS/DROP POLICY IF EXISTS idempotent patterns; 20260830 deterministic convergence of any intermediate state | migrations read-through | NO (needs disposable Postgres) | Supabase project | Medium | UNVERIFIED |
| schema snapshot consistency | Derived file lags 4 migrations — boundary header added | schema.sql header | Static | No | Low | PASS (documented) |

## PHASE 3 — STORAGE FOUNDATION

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Canonical write namespaces | audio/, video/, artwork/, temp/upload-sessions/ enforced at presign | auth-guard.ts:30 CANONICAL_WRITE_PREFIXES | Mocked | Live S3 | Medium | PARTIAL |
| Legacy namespaces read-only | LEGACY_READ_PREFIXES list; no writer emits them for new objects | auth-guard.ts:35 | Static | No | Low | PASS |
| Manifest independence | manifest only via explicit save/get RPCs (snapshot/recovery); runtime library loads from Postgres | master-library.ts getPublicMasterLibraryServer; manifest-migration.test.ts asserts independence | Mocked | No | Low | PASS |
| Orphan detection/purge | Owner scanner protects in-flight staging keys; cleanup re-validates fresh scan + audit_logs | owner-data.ts:65,116 | Mocked | Live S3 | Medium | PARTIAL |
| URL expiry semantics | all signs 900s | s3-functions.ts sign calls | Static | Live S3 | Low | PARTIAL |

## PHASE 4 — MEDIA ANALYSIS + UPLOAD V2

| Requirement | Implementation | Evidence | Runtime Verified | External | Risk | Status |
|---|---|---|---|---|---|---|
| Audio parsers FLAC/WAV/MP3/M4A(ALAC/AAC) | media-analysis/audio-analyzer.ts magic-byte dispatch; Xing/VBRI VBR duration | audio-analyzer.ts | Synthetic-buffer unit tests (media-ingestion.test.ts) | Real files E2E | Medium | PARTIAL |
| Video parsers MP4/MOV/MKV/WebM + moov tail fallback | video-analyzer.ts ftyp brand + tailBuffer scan | video-analyzer.ts | Synthetic-buffer tests | Real files E2E | Medium | PARTIAL |
| Artwork JPEG/PNG/WebP/AVIF/GIF/SVG magic-byte authority | image-analyzer.ts detectImageMimeFromMagicBytes; staged bytes downloaded+analyzed server-side; detected mime persisted | image-analyzer.ts; ingestion.ts artwork path; 20260830 R5 columns | Unit tests | Live S3 | Medium | PARTIAL |
| SHA-256 transport integrity | client-vs-server mismatch fails closed; streaming hash once | ingestion.ts verifyAndAnalyzeServerUploadInternal | Unit tests | Live S3 | Low | PASS (logic) |
| Duplicate handling | exact sha duplicate decision upload_anyway/use_existing/cancel; uncertainty states | upload_sessions duplicate_status enum; media-ingestion tests | Mocked | Live DB | Low | PARTIAL |
| Review/bulk/concurrency/recovery | Review Center chips wired to server truth; bulk multi-select apply; per-item atomic commit; cleanup_pending recovery states | upload.tsx bulk handlers; ingestion.ts status transitions | Mocked + dev-server.log shows clean session | Real browser flow | Medium | PARTIAL |

### Format fixture matrix (Phase 4)

| Format | Real Fixture | Parse test | Integrity test | Failure-path test | Runtime path exercised |
|---|---|---|---|---|---|
| FLAC | No (synthetic bytes) | YES | sha256 YES | malformed-buffer YES (redteam-closure) | Upload pipeline mocked |
| WAV | No (synthetic) | YES | YES | YES | mocked |
| MP3 (CBR/VBR Xing/VBRI) | No (synthetic) | YES | YES | YES | mocked |
| M4A/ALAC | No (synthetic ISOBMFF boxes) | YES | partial | partial | mocked |
| MP4/MOV | No (synthetic ftyp/moov) | YES | partial | moov-missing YES | mocked |
| MKV/WebM | No (synthetic EBML) | YES | partial | partial | mocked |
| JPEG/PNG/WebP/GIF/AVIF/SVG | Magic-byte synthetic | YES | mime-detect YES | garbage-reject YES | mocked |
| LRC multiline/malformed | Text fixtures inline | lyrics-formatter YES | round-trip YES | malformed YES | n/a (pure) |

Honest gap: no real binary fixture files; acceptable for parser logic confidence but flagged as technical debt.

## PHASE 5 — PLAYER V2 (this run)

See docs/audit/PHASE_5_ARCHITECTURE_DECISIONS.md + FINAL_PHASE_0_7_AUDIT.md. Implementation P5.1..P5.6 per docs/PHASE_5_ARCHITECTURE.md.

## PHASE 6 — LYRICS V2 (this run)

Timeline editor exists as LrcLiveSyncModal (was dead code — wired into Review Center this run). Provider search + offset + formatter already present and tested.

## PHASE 7 — MEMBER EXPERIENCE (this run)

Favorites/playlists/history/playback-state server layer pre-exists (member-data.ts + RLS). This run hardens UI failure feedback paths.

## EXTERNAL GATES (unchanged, still required before public release)

1. Apply migrations 20260819→20260830 to live Supabase + security matrix execution.
2. Credential rotation (Supabase service key, AWS keys).
3. Live S3 presign/orphan/cleanup verification against real bucket.
