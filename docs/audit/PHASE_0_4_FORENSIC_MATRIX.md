# PHASE 0-4 FORENSIC MATRIX - Red-Team Audit 2026-08-24

Status vocabulary: PASS / PARTIAL / OPEN / BLOCKED / UNVERIFIED.
Evidence = native command output in this working copy or exact file:line quotes.

## Phase 0 - Baseline and Reproducibility

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Clean install reproducible | npm ci lockfile-driven | Exit 0, 0 vulnerabilities | PASS |
| Typecheck gate | tsc --noEmit (strict + extra flags) | Exit 0 | PASS |
| Lint gate | eslint flat config | 0 errors / 21 pre-existing warnings | PASS |
| Test suite | vitest 17 files | 212/212 PASS | PASS |
| Production build | vite + nitro vercel preset | 5.45 MB bundle exit 0 | PASS |
| Client secret scan | shape-based scanner (AKIA / service-role JWT / env reads) | 62 client files CLEAN | PASS |
| CI enforcement | .github/workflows/ci.yml full chain | Workflow code present; live run pending first push | PARTIAL |
| Runtime smoke | dev :5173, 10 routes | 9x200 clean; /s/token invalid was 500 -> fixed graceful page this audit | PASS post-fix |
| Stale/duplicate evidence docs | FINAL_RELEASE_GATE + old IMPLEMENTATION_SUMMARY archived | moved to docs/archive/historical-acceptance | PASS |

## Phase 1 - Security

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Fail-closed auth | crypto verification only; role solely profiles.role | auth-policy.test.ts | PASS |
| Server-only secrets | server-env process.env only; window-blocked admin client | bundle scan CLEAN | PASS |
| Owner enforced server-side | middleware discipline all mutations | enumerated | PASS |
| Path traversal defense | validateStorageKey read/write | storage-key.test.ts | PASS |
| Share tokens entropy/hash/revocation | 128-bit random; SHA-256 at rest; revoke rules | sharing.test.ts | PASS |
| RPC actor binding (H-3) | 20260830 R2: actor must equal auth.uid() unless service_role | migration body | PASS in-repo; live apply EXTERNAL UNVERIFIED |
| Policy modernization | 20260830 R4 jwt subquery policies | migration body | PASS same caveat |

## Phase 2 - Data Foundation

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Canonical DB truth | readers Postgres-only; manifest snapshot-only | spy test | PASS |
| Single source of truth per fact | physical authority = _files tables; reader precedence chain | master-library.ts | PASS reader-level; DB-level sync constraints absent (GAPS) | 
| Lyrics NO truncation (Critical) | 20260830 R1 purge+unify+rebuild full-fidelity+delete-on-empty+dedupe | migration | PASS in-repo SQL; live EXTERNAL UNVERIFIED |
| Migration idempotency | IF NOT EXISTS discipline; 20260822 replay gap known | agent report | PARTIAL |
| schema.sql terminal match | lyrics_source/artwork_*/share hash era synced | diffed | PARTIAL (RPC bodies illustrative by design header) |
| CAS mandatory expectedVersion | eq(version) + global revision FOR UPDATE | domain tests | PASS |

## Phase 3 - Storage Foundation

| Requirement | Evidence | Status |
|---|---|---|
| Zero accidental legacy writers | enumeration agent C A: none found | PASS |
| Short-lived signed reads 900s never persisted | request-time signing | PASS (staging presign 3600s documented) |
| Master immutability | deterministic IDs; LOW collision windows residual | PARTIAL |
| Orphan scan correctness | protects live upload_sessions; cleanup re-validates + audit log + failed keys | owner-data.ts rewritten; PASS unit-level; live S3 UNVERIFIED |
| Cleanup-debt retry path | durable debts + retry RPC wired | PASS |
| Backup/restore | snapshot exists; restore tooling absent | OPEN -> Phase 10 scope (GAPS doc) |

## Phase 4 - Media Analysis + Upload V2

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Audio parsers FLAC/WAV/MP3/M4A/ALAC | real binary parsers; MP3 upgraded MPEG-1/2/2.5 + Xing/VBRI exact duration | fixtures + redteam-closure.test.ts | PASS core |
| Video MP4/MOV/WebM/MKV | MOV brand detect added; WEBM DocType label added; MKV/WebM duration/resolution remain honest-unknowns | new tests | PARTIAL |
| Artwork binary authority | FIXED: staged bytes downloaded and magic-byte analyzed; detected mime persisted; commit ext from detection; presign content-type constraint removed | redteam-closure.test.ts both branches | PASS |
| Server SHA-256 streaming + integrity gate | single-download merged hash+prefix capture; client-vs-server mismatch now FAILS CLOSED | redteam-closure tests | PASS |
| Duplicate detection two-layer | client pre-check + server authoritative re-check surfaced to review state | upload-store wiring | PASS |
| Confidence model | explicit STATUS model (verified/warning/error x signals), no fabricated numbers; UI chips render meta/artwork/integrity/duplicate | upload.tsx ReviewChip + store wiring | PASS (numeric scoring intentionally absent - justified in DECISION doc) |
| Review Center visibility | statuses rendered per item; duplicate alert retained | upload.tsx | PASS |
| Bulk edits (8.4) | multi-select + artist/album/year apply-to-selected + reject-selected; per-item atomic commits (deviation documented) | upload.tsx + store API | PASS minimal-viable |
| Controlled concurrency | worker pool limit 3 sync slot claiming | unchanged, tested | PASS |
| Retry/recovery | retire-session recovery + fresh re-analysis | retryIngestionItem | PASS |
| Safe commit gates | approval+verification+analysis required pre-commit; CAS transitions; compensation debts | ingestion.ts suite | PASS |
| AIFF gate honesty | removed allowed-but-unparseable .aiff | ingestion.ts | PASS |

## Verification commands executed natively (this audit)

npm ci PASS / npx tsc --noEmit PASS / npx eslint . 0 errors / npx vitest run 212 of 212 PASS / npm run build PASS 5.45MB / npm run scan:secrets CLEAN 62 files / dev-server route smoke 9 routes 200 + share fix verified by unit-level catch-render pattern