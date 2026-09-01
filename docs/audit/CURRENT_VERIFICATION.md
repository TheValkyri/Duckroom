# CURRENT VERIFICATION — single source of current truth (2026-08-31)

> Quy tắc: tài liệu này là NƠI DUY NHẤT giữ test count + phase status HIỆN TẠI.
> Các file `FINAL_*_AUDIT.md` / `PHASE_*_MATRIX.md` là evidence theo thời điểm
> — count trong đó là historical snapshot, KHÔNG phải current truth.

## Verdict hiện tại

- Phases 0–7: IMPLEMENTED + HARDENED in-repo (xem FINAL_PHASE_0_7_HARDENING_REPORT.md).
- Phases 8–11: implemented TRƯỚC kế hoạch (feature-creep đã được ghi nhận và
  đóng băng — không mở rộng thêm; xem HISTORY.md).
- **MOBILE UI OVERRUN (2026-08-31): COMPLETE in-repo** — mobile-first shell
  (bottom nav, mini-player, sheets, safe-areas), zero desktop regression,
  docs in `MOBILE_UI_CONTEXT_AUDIT / MOBILE_UI_ARCHITECTURE / MOBILE_UI_QA /
  MOBILE_RESPONSIVE_MATRIX / FINAL_MOBILE_UI_RELEASE_REPORT`.
- Release-ready = **NO** — vẫn còn 3 external gates (live Supabase/rotation/S3).

## Environment

- Node v24.16.0 · npm 11.13.0 · lockfileVersion 3
- QA browser: Chrome 151 via CDP @ 360/375/390/412/430/768 + 1280/1440/1920

## Gates (2026-08-31, working copy, sau mobile UI overhaul)

| Gate | Kết quả |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors — bao gồm fix 4 lỗi type có sẵn ở working copy này, xem AD-M6) |
| `npx eslint .` | PASS (0 errors / 18 warnings pre-existing — giảm từ 19) |
| `npm test` | **PASS 310/310 across 26 files** (0 failed, 0 skipped; +11 mobile-ui-shell) |
| `npm run build` | PASS (Vite + Nitro/Vercel; client 1.22 MB gzip) |
| `npm run scan:secrets` | CLEAN (70 client files) |

## Localhost black-box (2026-08-31, vite dev @ :5173, CDP-driven)

- 10 route SSR 200 như trước + client module-graph sạch cho TOÀN BỘ file
  mobile mới (MobileSheet/QueueSheet/TrackActionsSheet/use-media-query).
- Live data thật: 76 track / 4 album / 1 video hydrate từ Supabase+S3.
- Flow mobile đã verify thực tế (play/mini/expand/queue-sheet reorder/
  lyrics-tap-seek/search/no-result/orientation/multi-tab mirror/red-team
  spam) — chi tiết + evidence lệnh: `docs/audit/MOBILE_UI_QA.md`.
- Còn hở môi trường (không phải code): audio autoplay bị chặn với gesture
  synthetic (engine đã recovery sạch); chưa có thiết bị notch thật.

## External gates (vẫn chặn public release)

1. Apply migrations 20260819 → 20260904 lên live Supabase + security matrix.
2. Rotate credentials đã từng lộ.
3. Live S3 verification (presign/orphan/snapshot).
4. Real-device perf pass §26.4 (mobile matrix giờ có harness CDP tái sử dụng
   được: `scripts/cdp-qa.mjs` + `scripts/qa-plans/`).
