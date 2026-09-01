# Duckroom — Phase 0–3 Remediation Summary

## Source of truth

- Architecture: `docs/DUCKROOM_MASTER_PLAN.md`
- Execution procedure: `repo/plan.md`
- Current state: `docs/audit/CURRENT_VERIFICATION.md`
- Detailed audit reports: `docs/audit/`
- Historical reports: `docs/archive/`

## Code-level changes in this revision

### Phase 2 — Canonical domain integrity, Authoritative metadata & Lyrics integrity

- Added `20260826_duckroom_v2_canonical_integrity_closure.sql` and updated `supabase/schema.sql`.
- Added unique canonical index `idx_lyrics_documents_canonical_identity` on `public.lyrics_documents(track_id, source, kind, version)`.
- Reconciliations and manifest migration preserve full multi-line synchronized lyrics arrays without truncation.
- Integer-hundredths time conversion in `src/lib/lyrics-formatter.ts` eliminates IEEE 754 precision loss.
- Caller SHA-256 and byte counts are strictly treated as unverified suggestions; `verified_at` is never set on caller claim.
- Physical metadata authority (`track_files` / `video_files`) takes strict precedence over legacy denormalized columns (`tracks.size_mb`, `tracks.sample_rate`) in public library and shared resource readers.
- Added server-side binary image analyzer (`src/services/media-analysis/image-analyzer.ts`) with magic-byte validation for JPEG, PNG, WebP, AVIF, GIF, SVG, and dynamic non-fabricating MIME resolution in RPC and migration.

### Phase 3 — DB/S3 deletion consistency & media analysis linking

- Maintained `storage_cleanup_debts` durable compensation table.
- Track/video deletion removes the canonical DB row first under CAS, then deletes the physical master object.
- Ingestion commit upserts normalized `track_files` / `video_files` with server-measured exact byte counts and server SHA-256, linking `track_file_id` / `video_file_id` to `media_analysis_records`.
- S3 cleanup failure becomes durable cleanup debt instead of leaving an authoritative DB row pointing at missing storage.
- Shared artwork/thumbs are no longer blindly hard-deleted by resource deletion; orphan cleanup remains owner-controlled.

### Verification discipline

- Full clean-environment automated test suite: 14 test files, 161/161 tests passing.
- Static checks: TypeScript exit code 0, ESLint exit code 0 (21 warnings).
- Production build: Vercel preset bundle (5.43 MB) exit code 0.
- Clean package excludes dependency/build artifacts (`node_modules`, `dist`, `.vercel`, `.output`).
- No claim of 100% completion is made without live provider/database/storage evidence.
