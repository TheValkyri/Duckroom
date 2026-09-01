# FINAL RELEASE GATE (2026-08-25, post P0-hardening round)

Status: **CONDITIONAL GO** — Phase 0–7 code-complete + hardened; release bị
chặn duy nhất bởi external infrastructure gates ở cuối tài liệu.

## Single current truth

- Test count hiện tại: **297/297 across 25 files** (chi tiết:
  `docs/audit/CURRENT_VERIFICATION.md`)
- Phase status hiện tại: Phases 0–7 HARDENED · 8–11 implemented-đóng-băng

## Gate checklist

| # | Gate | Evidence | Verdict |
|---|---|---|---|
| 1 | Clean install | npm ci — lockfileVersion 3, Node 24/npm 11 | PASS |
| 2 | Type safety | tsc --noEmit strict = 0 errors | PASS |
| 3 | Lint | 0 errors (19 warnings pre-existing) | PASS |
| 4 | Unit/integration | 297/297 (25 files) | PASS |
| 5 | Production build | Vite + Nitro/Vercel | PASS |
| 6 | Secret-leak scan | CLEAN (70 client files) | PASS |
| 7 | Localhost black-box | routes SSR + share-token hostile + fail-closed | PASS |
| 8 | **Client module graph** | transformed sharing.ts/TrackRow không còn node:crypto; .server.ts 403 từ dev origin (AD-13) | PASS |
| 9 | Client boundary guard | client-boundary.test.ts (4 cases) chống cả class bug | PASS |
| 10 | Migration chain review | append-only + idempotency patterns; 20260903 RPC grants service_role-only | PASS (static) |
| 11 | Live migration apply | chưa chạy trên live Supabase | **BLOCKED (external)** |
| 12 | Credential rotation | ngoài phạm vi repo | **BLOCKED (external)** |
| 13 | Live S3 flows | presign/orphan/snapshot chưa thử bucket thật | **BLOCKED (external)** |
| 14 | Real-browser multi-tab + perf §26.4 | cần browser automation/thiết bị | **UNVERIFIED (external)** |

## Release procedure khi gates 11–13 xong

1. Apply migrations theo thứ tự tên file lên staging Supabase; chạy
   Guest/Member/Owner security matrix.
2. Rotate Supabase service key + AWS keys; cập nhật Vercel env.
3. Live S3: presigned PUT/GET, orphan scan/cleanup, snapshot verify.
4. Chạy lại `npm run build` + smoke trên preview deployment.
5. Đổi trạng thái tài liệu này thành GO kèm link evidence.
