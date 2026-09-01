# PHASE 4 PERFORMANCE AUDIT - Red-Team 2026-08-24

Method: code-path op counting + native gate timings on this machine. No synthetic media benchmarks (no real corpus available in-repo); numbers marked measured vs analytical.

## Measured (native, this working copy)

| Item | Value |
|---|---|
| vitest 212 tests wall time | ~5.0s (import graph dominates: ~20.7s transform first run) |
| Production bundle | 5.45 MB total / 1.16 MB gzip |
| npm ci | exit 0 |
| Dev SSR route render | 9 routes 200; no server-side error lines |

## Analytical findings + fixes applied

### P1 Client SHA-256 whole-file buffering - FIXED
Before: file.arrayBuffer() loaded entire master into RAM per item (2GB FLAC -> 2GB spike) before review.
After: CLIENT_HASH_MAX_BYTES=256MB cap; larger files skip client hash entirely and rely on the server-authoritative streaming hash post-upload for duplicate detection. Rationale: client hash is advisory pre-check only; correctness preserved, memory bounded. No new dependency (SubtleCrypto cannot stream; a JS incremental SHA would violate simplicity/dep prohibitions).

### P1 Double download in verification - FIXED
Before: GET full object (hash) + separate ranged GET first-2MB (analysis) = same bytes twice.
After: single full-object GET; node-crypto hash updated incrementally while first 2MB captured into the analysis buffer. S3 ops per verify session: HEAD + 1xGET(media) [+1 tail ranged GET for videos >2MB] + artwork path now 1xGET when present. Net: minus one full-pipeline ranged request per track.

### P2 Repeated hashing eliminated
Client hash reused across retry of same session (stored on item); server never re-downloads for commit (server-side CopyObject).

### P3 Local triple-read residual
enqueue still reads: capped hash slice (<=256MB), 2MB analysis header, up-to-20MB tag slice. Accepted: bounded and sequential during local review phase; further dedup requires merging analyzers (deferred, complexity > win at limit 3 concurrency).

### DB round trips
Verify path: 1 select session + 1 CAS update(verifying) + 1 duplicate lookup + 1 final update = 4 statements; commit path unchanged from audited design (CAS-guarded). N+1 absent.

## Concurrency behavior
Worker pool limit 3 with synchronous slot claiming (stage flip before await) prevents oversubscription; burst input queues without memory growth beyond queued File handles (metadata lazy).

## Budgets going into Phase 5
- Playback must not depend on React render pressure (already enforced via useSyncExternalStore time store)
- Visualizer: rAF loop now survives hidden tabs without doing work; analyser cached per element (no per-frame WeakMap churn)
- Bundle: keep gzip < 1.3MB; recheck after Phase 5 additions