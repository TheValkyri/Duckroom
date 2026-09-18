# CURRENT VERIFICATION — single source of current truth (2026-09-18)

> Quy tắc: tài liệu này là NƠI DUY NHẤT giữ test count + phase status HIỆN TẠI.
> Các file `FINAL_*_AUDIT.md` / `PHASE_*_MATRIX.md` là evidence theo thời điểm
> — count trong đó là historical snapshot, KHÔNG phải current truth.

## Verdict hiện tại

- Phases 0–7: IMPLEMENTED + HARDENED in-repo (xem FINAL_PHASE_0_7_HARDENING_REPORT.md).
- Phases 8–11: implemented TRƯỚC kế hoạch (feature-creep đã được ghi nhận và
  đóng băng — không mở rộng thêm; xem HISTORY.md).
- **MOBILE UI OVERRUN (2026-08-31): COMPLETE in-repo** — mobile-first shell
  (bottom nav, mini-player, sheets, safe-areas), zero desktop regression.
- **PERF/PLAYBACK/LYRICS/LOADING HARDENING PASS (2026-09-04): COMPLETE in-repo** — WP1–WP7 (AD-17/AD-18).
- **EDGE-FREE CHROME REDESIGN + BELOW-FOLD PAINT (2026-09-04): COMPLETE in-repo** — AD-19/AD-20.
- **PHASE 0 ARCHITECTURAL OVERHAUL (2026-09-15): COMPLETE in-repo** —
  Khôi phục baseline DDL (AD-16 resolved: `00000000_duckroom_v1_baseline.sql`),
  xóa sổ SSR 404 (`src/lib/ssr-loaders.ts`), căn chỉnh TTL presigned URL (15m/6h),
  lazy signing (`src: ""`) giải phóng S3 HMAC concurrency.
- **PHASE 1 SECURITY HARDENING (2026-09-15): COMPLETE in-repo** —
  Sliding-window IP rate limiter (`src/lib/rate-limit.ts`), 60s SHA-256 hashed in-memory auth cache,
  fresh authorization middleware cho toàn bộ 16 write mutations, ingestion Range clamping.
- **PHASE 2 MEDIA PERFORMANCE (2026-09-15): COMPLETE in-repo** —
  128-byte precomputed waveform peaks (`waveform_peaks` column), cứu iOS background audio (gỡ
  visualizer khỏi PlayerBar, toggle riêng trong NowPlaying), TanStack Query v5 state sync, crossfade preload reuse.
- **PHASE 3 ARCHITECTURE SUSTAINABILITY (2026-09-15): COMPLETE in-repo** —
  DB-driven album display priority (`display_priority` column + seeds, xóa bỏ hardcoded logic),
  cursor-based playback history pagination với composite tie-breaker (`started_at_id`).
- Release-ready = **NO (CONDITIONAL)** — mã nguồn đạt chuẩn production, chờ đóng 2 external gates trực tiếp từ owner (apply SQL migrations Phase 2+3 trên Supabase và credential rotation).

## Environment

- Node v24.16.0 · npm 11.13.0 · lockfileVersion 3
- QA browser: Chrome 151 via CDP @ 360/375/390/412/430/768 + 1280/1440/1920

## Gates (2026-09-18, sau Phase 0–3 Architectural Overhaul)

| Gate                   | Kết quả                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npx tsc --noEmit`     | **PASS** (0 errors)                                                                                                |
| `npx eslint .`         | **PASS** (0 errors / 15 warnings fast-refresh Shadcn)                                                               |
| `npm test`             | **PASS 472/472 across 37 files** (100% xanh)                                                                       |
| `npm run build`        | **PASS** (5.98 MB total, 1.3 MB gzip — Vite client + Nitro SSR Vercel preset)                                      |
| `npm run scan:secrets` | **CLEAN** (80 client files đã quét, 0 rò rỉ secret)                                                                |

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

## External gates (chờ thao tác từ owner để đạt full release-ready)

1. **Apply live SQL migrations**:
   - `00000000_duckroom_v1_baseline.sql` (baseline DDL cho fresh project)
   - `20260916_duckroom_v2_waveform_peaks.sql`: `ALTER TABLE public.track_files ADD COLUMN IF NOT EXISTS waveform_peaks SMALLINT[];`
   - `20260917_duckroom_v2_album_priority.sql`: `ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS display_priority INTEGER NOT NULL DEFAULT 999;` + seed updates.
2. **Rotate credentials đã từng lộ**:
   - Supabase Service Role Key + Cloudflare R2 / AWS S3 keys. Cập nhật biến môi trường trên Vercel.
3. **Live S3 verification**: presign/orphan/snapshot verification trên bucket thật sau khi rotate keys.
4. **Real-device perf pass**: Automation Playwright Chromium headless chạy trong CI; kiểm thử thủ công trên thiết bị vật lý iOS Safari/PWA.
