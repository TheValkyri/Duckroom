# AGENT HANDOFF — current state (2026-08-31, mobile UI overrun complete)

## Read first
1. docs/DUCKROOM_MASTER_PLAN.md (authority)
2. docs/audit/MOBILE_UI_CONTEXT_AUDIT.md (mobile gate audit — read trước khi đụng UI)
3. docs/audit/CURRENT_VERIFICATION.md (current truth + verdicts)
4. docs/audit/FINAL_MOBILE_UI_RELEASE_REPORT.md (+ MOBILE_UI_QA.md / MOBILE_RESPONSIVE_MATRIX.md)
5. docs/audit/ARCHITECTURE_DECISIONS.md (AD-1..AD-16 + AD-M1..M6) — never deviate silently.

## State after this round
- MOBILE UI OVERRUN COMPLETE (presentation layer only — engine/auth/DB/
  ingestion untouched): bottom-nav shell, phone mini-player, QueueSheet/
  TrackActionsSheet, safe-area tokens (+viewport-fit), 44px touch
  standard. Docs: MOBILE_UI_* + FINAL_MOBILE_UI_RELEASE_REPORT.
- Tests: 310/310 (26 files) — up from 299 (+11 mobile-ui-shell guards).
  tsc 0 (fixed 4 pre-existing working-copy type errors, AD-M6) · lint 0
  errors/18 warnings · build · secret-scan green.
- QA harness retained for reuse: scripts/cdp-qa.mjs + scripts/qa-plans/
  (dev-only; CDP-driven, no new deps).
- Quy ước UTF-8 tái khẳng định (B7): KHÔNG bao giờ ghi file chứa tiếng
  Việt bằng PowerShell Set-Content/regex — đã tái phát 1 lần trong round
  này và phải revert 6 file. Dùng edit tool / node.
- External gates for public release: KHÔNG ĐỔI (live Supabase migrations
  20260819→20260904 + security matrix · credential rotation · live S3 ·
  real-device perf §26.4 — giờ có sẵn harness CDP để chạy mobile matrix).

## Deferred by decision (documented, not forgotten)
- Lyrics provider fan-out → server-side proxy (P2; needs rate-limit/cache PR).
- listUserLibrary pagination (scale debt; <1000-track scale today).
- Sheet full focus-trap loop (basic autoFocus+Escape today) — P3 polish.
- dev-only node:http2 externalization warning (P3; không có trong bundle client production).

## Non-negotiable rules (unchanged, plus:)
- Any new destructive op needs CAS guard + audit_logs + cleanup-debt + test.
- Multi-row mutations that CAN be single-statement MUST be (see 20260903).
- external_identities/user_preferences: RLS enforced; server paths keep
  explicit ownership guards.
- Mobile UI: giữ chuẩn 44px touch target + safe-area utilities; KHÔNG
  duplicate player logic giữa QueuePanel/QueueSheet/TrackActionsSheet.

## Immediate next actions
1. EXTERNAL GATES (blocking public release):
   a. Apply migrations 20260819 → 20260904 to live Supabase + security matrix.
   b. Rotate historically exposed credentials. c. Live S3 verification.
2. When authorized: real-device mobile perf pass (reuse scripts/cdp-qa.mjs
   plans on device/CDP) · lyrics server fan-out · library pagination ·
   subtitle system §15.3 · restore tooling per AD-9.

