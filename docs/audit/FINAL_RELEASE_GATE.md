# FINAL RELEASE GATE (2026-09-18, post Phase 0–3 Architectural Overhaul)

Status: **CONDITIONAL GO** — Phase 0–7 code-complete + hardened; Phase 0–3 Overhaul code-complete & deployed; release bị
chặn duy nhất bởi 2 external infrastructure gates từ owner (Supabase migrations Phase 2+3 và Credential rotation).

## Single current truth

- Test count hiện tại: **472/472 across 37 files** (chi tiết:
  `docs/audit/CURRENT_VERIFICATION.md`)
- Phase status hiện tại: Phases 0–7 HARDENED · 8–11 implemented-đóng-băng · P0–P3 Overhaul COMPLETE in-repo & deployed

## Gate checklist

| #   | Gate                                | Evidence                                                                                    | Verdict                   |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | Clean install                       | npm ci — lockfileVersion 3, Node 24/npm 11                                                  | PASS                      |
| 2   | Type safety                         | tsc --noEmit strict = 0 errors                                                              | PASS                      |
| 3   | Lint                                | 0 errors (15 warnings fast-refresh Shadcn)                                                  | PASS                      |
| 4   | Unit/integration                    | 472/472 (37 files, 100% xanh)                                                               | PASS                      |
| 5   | Production build                    | Vite + Nitro/Vercel (5.98 MB total, 1.3 MB gzip)                                            | PASS                      |
| 6   | Secret-leak scan                    | CLEAN (80 client files)                                                                     | PASS                      |
| 7   | Localhost black-box                 | routes SSR + share-token hostile + fail-closed                                              | PASS                      |
| 8   | **Client module graph**             | transformed sharing.ts/TrackRow không còn node:crypto; .server.ts 403 từ dev origin (AD-13) | PASS                      |
| 9   | Client boundary guard               | client-boundary.test.ts (6 cases) chống cả class bug                                        | PASS                      |
| 10  | Migration chain review              | append-only + idempotency patterns; 21 migrations exit 0 (scripts/check-migration-columns)  | PASS (static)             |
| 11  | Live migration apply                | migrations Phase 2 (`waveform_peaks`) & Phase 3 (`display_priority`) chờ execute trên DB     | **BLOCKED (external)**    |
| 12  | Credential rotation                 | rotate Supabase Service Role Key + AWS/Cloudflare R2 keys (bắt buộc)                        | **BLOCKED (external)**    |
| 13  | Live S3 flows                       | presign/orphan/snapshot sau khi rotate credentials                                          | **BLOCKED (external)**    |
| 14  | Real-browser multi-tab + perf §26.4 | Playwright Chromium headless CI + CDP automation; manual physical device iOS PWA           | **CONDITIONAL PASS**      |

## Release procedure khi gates 11–13 xong

1. Apply migrations theo thứ tự tên file lên live Supabase (`00000000_baseline`, `20260916_waveform_peaks`, `20260917_album_priority`).
2. Rotate Supabase service key + AWS keys; cập nhật Vercel env.
3. Live S3: presigned PUT/GET, orphan scan/cleanup, snapshot verify.
4. Chạy lại `npm run build` + smoke trên preview deployment.
5. Đổi trạng thái tài liệu này thành GO kèm link evidence.

