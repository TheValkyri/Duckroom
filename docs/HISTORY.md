# HISTORY

## 2026-08-24 (run 2) — PHASE 0–4 CLEAN + PHASE 5/6/7 EXECUTION
- Phase 0: all gates re-run green on this copy (npm ci 0-vuln, tsc, lint 0
  errors, tests, build 1.18 MB gzip, secret scan). Explicit vitest.config.ts
  adopted (AD-7). schema.sql coverage-boundary header added (was silently
  missing 4 migrations).
- Phase 1 red-team re-audit + fixes: fabricated /api/stream fallbacks removed;
  videos sync button auth gate aligned; dev-server root-file exposure closed
  via server.fs.deny with runtime proof (schema.sql 200 → 403) — AD-1/AD-2.
- Phase 2/3/4 audits: canonical physical-truth precedence confirmed in every
  reader; cleanup-debt destructive flows confirmed; migration chain reviewed
  idempotent-by-pattern; live apply remains the external gate.
- Phase 5 IMPLEMENTED (P5.1..P5.6): player-engine store, persistence client
  (member RPC + guest mirror + debounce/flush), BroadcastChannel leader
  election (pure reducer + adapter), MediaSession register-once + throttle,
  recovery polish (retry-cap reset / online resume / stalled soft-reload),
  ReplayGain vertical end-to-end incl. append-only migration 20260831.
- Phase 6: lyrics chain verified; Review Center gained a real lyrics editor
  and the previously-dead LrcLiveSyncModal became reachable.
- Phase 7: playlist rename added (optimistic + rollback); member isolation
  re-checked (server guards + RLS + tests).
- Tests grown 212 → 242 across 20 files. Localhost black-box matrix executed
  twice (post-fix, post-P5): 10 routes HTTP 200; invalid/expired share tokens
  render friendly page; missing-config failure injection behaves fail-closed.

## 2026-08-24 (run 1) — RED-TEAM CLOSURE (Phase 0–4) + Phase 5 preparation
- Full first-principles re-audit (media pipeline, migrations/lyrics,
  storage/CAS/destructive ops, player architecture).
- P0/P1 fixes: artwork binary-authority path, transport SHA mismatch gate,
  single-download verification, MP3 VBR/Xing duration, MOV/WEBM identity,
  AIFF honesty, client-hash memory bound, review-status chips, bulk edits,
  orphan-scan session protection, share-route graceful failure, player
  handover/visualizer/hotkeys hardening.
- SQL 20260830 redteam hardening authored. Verdict: enter Phase 5 = YES.

## 2026-08-21 (historical context)
- Canonical integrity closure package. Superseded details archived under docs/archive/.

## Earlier phases
See docs/archive/.


---

# 2026-08-25 — P0 hardening round

- Independent review (owner F12) bắt P0: node:crypto leak vào client bundle →
  mọi page crash ở browser. Nguyên nhân gốc: smoke chỉ check HTTP status SSR.
- Fix: AD-13 (split sharing.server.ts, dynamic-import handlers, rename
  manifest-migration.server.ts) + AD-14 (client module-graph smoke) + guard
  test client-boundary.test.ts + vite fs.deny *.server.ts.
- Sự cố phụ trong quá trình fix: PowerShell Set-Content/> hỏng encoding UTF-8
  2 test file (mojibake) → đã khôi phục từ zip gần nhất + redirect qua cmd.
  Bài học ghi nhận: mọi file operation UTF-8 phải qua node/cmd, không qua
  PowerShell redirection.
- Gates: 297/297 (25 files) · tsc 0 · lint 0 · build OK · scan CLEAN.
- Phases 8–11 chính thức ĐÓNG BĂNG (feature-creep đã có từ trước, không mở
  rộng); release gate scoped Phase 0–7 per FINAL_RELEASE_GATE.md.

---

# 2026-08-25 (supp) — Migration chain: bug đầu tiên bị bắt khi apply live

- Owner chạy apply-all.sql lần đầu → ERROR 42703 mar.created_at (20260825).
- Fix in-place + AD-15; checker npm run check:migrations sinh ra từ bài học.
- Phát hiện AD-16: chain đòi legacy v1 baseline (tracks/albums/videos);
  fresh project sẽ fail — gap OPEN đã ghi nhận trong handoff.

---

# 2026-08-31 — MOBILE UI OVERRUN (presentation layer only)

- Context audit gate completed BEFORE any code (MOBILE_UI_CONTEXT_AUDIT.md).
- Mobile-first shell: bottom-nav dock (4 tabs, AD-M1), phone mini-player
  dock + fullscreen stacked player with full-stage lyrics mode, swipe-down
  dismiss, QueueSheet + TrackActionsSheet bottom sheets (AD-M2/M3),
  safe-area token system + viewport-fit=cover (AD-M5).
- TrackRow phone actions no longer hover-gated; 44px touch standard
  enforced and measured.
- Gates: tsc 0 (incl. 4 pre-existing working-copy type errors fixed —
  AD-M6), lint 0 errors/18 warnings, tests 310/310 (26 files; +11
  mobile-ui-shell guards), build PASS, secret-scan CLEAN.
- QA: CDP harness (scripts/cdp-qa.mjs + 18 plans), live data (76 tracks),
  flows 1-12 (10 PASS / 2 PARTIAL-env), red-team spam clean, zero
  horizontal overflow 360→1920, desktop regression asserted clean.
- Sự cố quy trình: 1 lần PowerShell bulk-regex tái tạo class lỗi B7
  (mojibake) → revert 6 file + re-apply bằng edit tool; byte-check sạch.
- External gates for public release: KHÔNG ĐỔI (live Supabase/rotation/S3/
  real-device perf).
