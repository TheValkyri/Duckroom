# FINAL PHASE 0–7 HARDENING REPORT (2026-08-25)

> Báo cáo tổng hợp đợt hardening cuối. Current truth: CURRENT_VERIFICATION.md.
> Điểm số KHÔNG thay thế evidence — mỗi dòng status dẫn về bằng chứng cụ thể.

## Bối cảnh

Đợt này khởi động từ finding của OWNER (F12): `node:crypto` externalized
crash mọi page — một P0 mà 4 vòng "verified" trước không bắt được vì smoke
chỉ assert HTTP status SSR. Bài học đã được institutionalize thành AD-14
(client module-graph smoke) + guard test tự động.

## Bugs found → fixed (đợt này)

| # | Bug | Severity | Fix | Regression test |
|---|---|---|---|---|
| B1 | node:crypto trong client graph → crash mọi page browser | **P0** | AD-13: split sharing.server.ts + dynamic-import + fs.deny | client-boundary.test.ts (4) |
| B2 | Election: timeout tự xưng leader không so tie-break; leader bỏ qua challenger thấp hơn | P1 | CLAIM phase + monotonic lowest-id acceptance (AD trong player-broadcast.ts header) | player-broadcast.test.ts viết lại (9) |
| B3 | Reorder tuần tự partial-write | P1 | atomic RPC 20260903 | member-reorder-preferences (6) |
| B4 | History không idempotent | P1 | client_event_id unique + upsert-ignore (20260904) | member-data.test (+2) |
| B5 | user_preferences không nối player | P1 | player-preferences-sync + wiring | player-preferences-sync.test (6) |
| B6 | Guest position mất precision | P2 | giữ 3 decimals | player-phase5 (existing) |
| B7 | (process) PS redirection hỏng UTF-8 test files trong lúc fix | — | khôi phục từ zip; quy ước mới: file ops UTF-8 qua node/cmd | — (documented HISTORY) |

## Scorecard Phase 0–7

Legend: PASS / PARTIAL / OPEN / BLOCKED(external) / UNVERIFIED(external)

| Phase | Implementation | Tests | Runtime | Security | Data Integrity | Perf | Docs | External | Remaining risk | **Status** |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 Freeze/Baseline | gates green; docs single-truth (banner historical) | 297 suite | dev smoke + module-graph | scan CLEAN | n/a | n/a | ✅ single count=297 | CI runner chưa chạy | CI UNVERIFIED | **PASS** |
| 1 Security P0 | fail-closed JWT, G/M/O middleware 51 RPCs | auth-policy, sharing, storage-key, redteam, client-boundary | hostile-token + fs.deny 403 + module-graph | scanner CLEAN; secrets server-only | n/a | n/a | AD-1/13/14 | **live JWT/RLS matrix BLOCKED** | live behavior chưa thử | **PASS\*** |
| 2 Data Foundation | canonical track_files/video_files; CAS; 20260903/04 | domain-mutations, media-integrity, reorder, history-idempotency | — | RLS policies static review | atomic reorder RPC; idempotent history | — | schema boundary header | **live apply BLOCKED**; migration chain static-reviewed, chưa fresh-PG run | fresh-bootstrap UNVERIFIED | **PASS\*** |
| 3 Storage | canonical namespaces; orphan scan protect staging; manifest=snapshot | storage-key, manifest-migration.server, server-boundaries | — | traversal rejected; presign owner-only 900s | cleanup-debt compensation | — | — | **live S3 BLOCKED** | orphan purge trên bucket thật | **PASS\*** |
| 4 Ingestion | parsers FLAC/WAV/MP3/M4A/MP4/MOV/MKV/WebM + artwork magic-byte; SHA gate; duplicate; review center | media-ingestion (synthetic buffers), ingestion-db-integration | dev-log session sạch | sha mismatch fail-closed | commit atomic per item | streaming hash 1-pass | PHASE_4 matrix trong FINAL_PHASE_0_7_AUDIT | **real-file fixtures OPEN (debt)**; live bucket | synthetic-buffer gap | **PARTIAL** |
| 5 Player | engine store; queue pure; crossfade; RG; MediaSession; multi-tab CLAIM election; preferences sync | player-engine/semantics/phase5/broadcast/preferences-sync (39 tests) | module-graph; app boots | — | prefs hydrate-gate no-echo | time-store isolation giữ | AD-3/8/11/12/14 | **real-browser multi-tab + perf trace UNVERIFIED** | device matrix | **PASS\*** |
| 6 Lyrics | providers + source tracking; offset; LRC parser; timeline editor wired | lyrics-formatter, lyrics-migration-integrity | — | — | lyrics_documents versioned | — | AD-4 | provider fan-out server-side DEFERRED (documented) | external providers client-side (P2 debt) | **PASS\*** |
| 7 Member | favorites/playlists/rename/reorder/history/state/preferences | member-data, member-reorder-preferences (16) | /my-library 200 | eq(user_id)+RLS double-guard | atomic reorder; idempotent history | — | AD-5/11/12 | **live RLS cross-user BLOCKED** | pagination debt | **PASS\*** |

`\*` = PASS in-repo; hành vi live bị chặn bởi external gates — KHÔNG được
diễn giải là đã verify trên hạ tầng thật.

## Tổng hợp trạng thái

```text
P0 open            : 0
P1 open            : 0   (B2–B5 đã fix + test)
P2 open (tracked)  : real-file fixtures · lyrics server fan-out · library pagination
EXTERNAL blocked   : live Supabase apply+matrix · credential rotation · live S3 · real-browser matrix/perf
Contradictory docs : 0 (single count 297; historical docs bannered)
```

## Kết luận

Phase 0–7 đạt mức defensible cao nhất có thể TỪ TRONG REPO. Mọi claim còn
lại đều gắn với external gates được liệt kê tường minh. SAFE TO CONTINUE = YES
(với điều kiện external gates trước public release).
