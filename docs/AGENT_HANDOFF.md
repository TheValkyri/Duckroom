# AGENT HANDOFF — current state (2026-09-04, perf/playback/lyrics/loading pass complete)

## Read first
1. docs/DUCKROOM_MASTER_PLAN.md (authority)
2. docs/audit/MOBILE_UI_CONTEXT_AUDIT.md (mobile gate audit — read trước khi đụng UI)
3. docs/audit/CURRENT_VERIFICATION.md (current truth + verdicts)
4. docs/audit/FINAL_MOBILE_UI_RELEASE_REPORT.md (+ MOBILE_UI_QA.md / MOBILE_RESPONSIVE_MATRIX.md)
5. docs/audit/ARCHITECTURE_DECISIONS.md (AD-1..AD-18 + AD-M1..M6) — never deviate silently.

## State after this round
- PERF/PLAYBACK/LYRICS/LOADING HARDENING COMPLETE (feedback round:
  audio ngắt/rè mobile, lyric chớp, initial-load khựng 2-3s, iOS
  background, polish): AD-17 (loading skeleton + status expose),
  AD-18 (crossfade handover time-reset + lyrics first-frame),
  stall 14s hardening (Agent-1), PWA meta + icons (Agent-1),
  AlbumCard bỏ layoutId, hero blur giảm bậc phone.
- Tests: 363/363 (30 files) — up from 350 (+7 library-loading-state,
  +6 playback-lyrics-hardening). tsc 0 · lint 0 errors/22 warnings ·
  build 1.25 MB gzip · secret-scan clean (74 files).
- iOS note (quan trọng, không phải bug): Safari tab iOS LUÔN ngắt web
  audio khi background — OS policy. Đường nghe nền trên iPhone: Add to
  Home Screen (standalone PWA — meta + icons đã sẵn). Dynamic Island/
  MediaSession artwork đã hoạt động và được giữ nguyên.
- Quy ước UTF-8 tái khẳng định (B7): KHÔNG bao giờ ghi file chứa tiếng
  Việt bằng PowerShell Set-Content/regex. Dùng edit tool / node.
- External gates for public release: KHÔNG ĐỔI (live Supabase migrations
  20260819→20260904 + security matrix · credential rotation · live S3 ·
  real-device perf §26.4 — harness CDP sẵn sàng).

## Deferred by decision (documented, not forgotten)
- Lyrics provider fan-out → server-side proxy (P2; needs rate-limit/cache PR).
- listUserLibrary pagination (scale debt; <1000-track scale today).
- Sheet full focus-trap loop (basic autoFocus+Escape today) — P3 polish.
- dev-only node:http2 externalization warning (P3; không có trong bundle client production).
- Real-device iOS Safari + PWA background-audio verification (cần iPhone
  thật — code path đã audit sạch: không pause theo visibility).

## Non-negotiable rules (unchanged, plus:)
- Any new destructive op needs CAS guard + audit_logs + cleanup-debt + test.
- Multi-row mutations that CAN be single-statement MUST be (see 20260903).
- external_identities/user_preferences: RLS enforced; server paths keep
  explicit ownership guards.
- Mobile UI: giữ chuẩn 44px touch target + safe-area utilities; KHÔNG
  duplicate player logic giữa QueuePanel/QueueSheet/TrackActionsSheet.
- Loading states: KHÔNG artificial delay; skeleton chỉ khi initial-hydrate
  (idle/syncing + chưa data) — sync ngầm sau khi có data KHÔNG hiện lại.

## Immediate next actions
1. EXTERNAL GATES (blocking public release):
   a. Apply migrations 20260819 → 20260904 to live Supabase + security matrix.
   b. Rotate historically exposed credentials. c. Live S3 verification.
2. When authorized: real-device mobile perf pass (reuse scripts/cdp-qa.mjs
   plans on device/CDP) · real-device iOS PWA background-audio test ·
   lyrics server fan-out · library pagination · subtitle system §15.3 ·
   restore tooling per AD-9.

