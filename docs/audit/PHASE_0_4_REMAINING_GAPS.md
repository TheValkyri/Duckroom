# PHASE 0-4 REMAINING GAPS - Red-Team Audit 2026-08-24

Honest register of everything NOT closed, with disposition. No silent debt.

## G1. Backup/Restore tooling - OPEN (deferred-by-plan to Phase 10)
Snapshot exists (albums/tracks/videos JSON to library_manifest.json) but:
- loader schema mismatch (camelCase vs snake_case), no restore RPC/route
- single overwriting key, no checksum, no export endpoint
Why not fixed now: Master Plan places backup/restore UX in Phase 10 Owner Console; the data-loss safety net that IS required pre-release is Layer-1 (safe destructive policy + cleanup debts) which is PASS.
Required before public release: timestamped keys + checksum + snake_case restore adapter wired to owner RPC.

## G2. MKV/WebM deep parsing - PARTIAL (accepted limitation)
EBML elements (Segment/Info/TimestampScale/TrackEntries) are not parsed: duration/resolution/fps stay UNKNOWN for Matroska family. Codec labels come from header-region string scan; WEBM vs MKV now correctly distinguished via DocType. Unknown stays unknown per Plan invariant 13 - no fabrication. Full EBML parser = candidate Phase 5+ work item.

## G3. MP3 residual limits - LOW
- ID3v2 tag/USLT/APIC path has no dedicated fixture yet (parser code real, coverage thin)
- MPEG-2/2.5 supported for rate/duration but marked with warning
Disposition: add fixtures opportunistically.

## G4. DB-level dual-metadata sync enforcement - PARTIAL
tracks/videos denormalized display columns can drift from _files authority rows; readers implement precedence so runtime is correct, but nothing DB-side enforces consistency. Remediation sketch: post-reconcile validator comparing fields, or generated-columns projection. Deferred: requires live-DB iteration.

## G5. Migration-chain replay hazards - documented, not rewritten
- 20260822 ADD CONSTRAINT lacks IF NOT EXISTS guard (replay on partially-applied env fails loudly)
- 20260825 DROP FUNCTION window historically re-opened PUBLIC execute until 20260826 regrant; terminal ACLs now enforced and re-asserted by 20260830 in same-file style going forward
- Missing pre-V2 baseline migration referenced by 20260819 FKs: fresh-project bootstrap relies on out-of-band schema.sql execution (header marks it NON-AUTHORITATIVE). Required before any fresh-environment deploy: commit a true baseline migration generated from cumulative replay.
Append-only chain preserved deliberately; 20260830 converges all reachable intermediate states deterministically.

## G6. CI live-run evidence - UNVERIFIED
Workflow exists and mirrors native gates, but has never executed (no remote configured in this working copy). First push will produce evidence; scan step may need dist path tuning per CI runner layout.

## G7. Live infrastructure verification - EXTERNAL UNVERIFIED (blocking release, not Phase entry)
1. Apply migrations 20260819->20260830 on real Supabase; run security matrix
2. Rotate historically exposed credentials (provider side)
3. Live S3 presign PUT/GET + orphan scanner against real bucket

## G8. Player multi-tab double audio + playback-state restore - PHASE 5 SCOPE
Confirmed present-today defects (two tabs = two audio authorities; reload loses position though persistence backend exists). These are Master Plan Phase 5 deliverables; architecture committed in docs/PHASE_5_ARCHITECTURE.md. NOT silently deferred: they are the first implementation work of Phase 5.

## G9. Minor hygiene accepted
- eslint 21 react-hooks warnings (pre-existing dep-array style) - tracked, non-blocking
- react-refresh export warnings in two context files - cosmetic
- playlist-position TOCTOU, share-revoke audit row, failed hard-delete audit rows - logged as backlog P3