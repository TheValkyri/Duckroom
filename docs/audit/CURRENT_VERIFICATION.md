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
- **PERF/PLAYBACK/LYRICS/LOADING HARDENING PASS (2026-09-04): COMPLETE
  in-repo** — WP1–WP7 theo feedback round (audio stall, lyrics jitter,
  initial-load "khựng 2–3s", iOS PWA background, artwork perf). Chi tiết
  AD-17/AD-18 trong ARCHITECTURE_DECISIONS.md.
- Release-ready = **NO** — vẫn còn 3 external gates (live Supabase/rotation/S3).

## Environment

- Node v24.16.0 · npm 11.13.0 · lockfileVersion 3
- QA browser: Chrome 151 via CDP @ 360/375/390/412/430/768 + 1280/1440/1920

## Gates (2026-09-04, working copy, sau perf/playback/lyrics/loading pass)

| Gate | Kết quả |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors) |
| `npx eslint .` | PASS (0 errors / 22 warnings pre-existing) |
| `npm test` | **PASS 363/363 across 30 files** (+13: library-loading-state ×7, playback-lyrics-hardening ×6) |
| `npm run build` | PASS (Vite + Nitro/Vercel; client 1.25 MB gzip) |
| `npm run scan:secrets` | CLEAN (74 client files) |

## Perf/playback/lyrics/loading pass (2026-09-04) — thay đổi chính

1. **WP3 Initial load**: `useLibrary` snapshot giờ expose `status`/`error`;
   index/library/albums render **skeleton đúng geometry** (LibrarySkeleton.tsx,
   không spinner/glow, giữ khung tránh CLS) khi hydrate lần đầu thay vì
   empty-state onboarding sai nội dung rồi pop sang library. Hero cover
   preload above-fold. KHÔNG artificial delay.
2. **WP2 Lyrics jitter**: crossfade handover (cả timed + ended) giờ gọi
   `setTime(0)` đồng bộ với `advanceWrapForHandover()` — trước đây timeRef
   treo ở cuối bài cũ ~250ms làm LyricsTicker nhảy active line. LyricsPane
   render frame đầu với active line đúng (usePlayerTimeSnapshot — đọc 1 lần,
   không subscribe) — hết flash "toàn FUTURE" khi mở sheet giữa bài.
3. **WP1 Audio stall**: stall soft-reload nới 8s→14s + gate readyState===0 +
   cách cuối bài >30s (Agent-1) — pin bằng guard test chống rollback.
4. **WP5 Artwork**: bỏ `layoutId` trên AlbumCard grid (vi phạm quy ước perf
   2026-08-25, đo layout vô nghĩa trên phone); hero ambient blur giảm bậc
   trên phone (blur-xl sm:blur-2xl md:blur-3xl) theo pattern NowPlaying.
5. **WP4 iOS**: PWA meta (apple-mobile-web-app-capable + status-bar +
   icons 192/512/maskable) — Safari tab iOS LUÔN ngắt web audio khi background
   (platform policy, không phải bug Duckroom — đã audit code path: không có
   pause theo visibilitychange/pagehide). Đường nghe nền đúng trên iPhone:
   Add to Home Screen (standalone PWA).

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
