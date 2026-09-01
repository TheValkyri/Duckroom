# ARCHITECTURE DECISIONS — Phase 0–7 Execution Run (2026-08-24)

Per Master Plan deviation policy: every meaningful deviation from implementation
detail is recorded here with full trade-off analysis. Product requirements are
never silently altered.

---

## AD-1 — Dev-server static exposure hardening (`server.fs.deny`)

- **Requirement**: Infrastructure artifacts (SQL schema/migrations, docs,
  lockfiles) must not leak through any HTTP surface.
- **Master Plan proposal**: §21 secrets hygiene focuses on bundle leakage.
- **Problem found (Stage 2 black-box)**: `vite dev` served the entire project
  root as static files — `/supabase/schema.sql` (59 KB), all migrations,
  `AGENTS.md`, `package.json`, `plan.md` returned HTTP 200 on the dev origin.
  Production output verified clean (`.vercel/output/static` contains none of
  these), so this is dev-only — but `vite --host` on an untrusted LAN would
  expose the full DB architecture.
- **Chosen design**: explicit `server.fs.deny` list in `vite.config.ts`
  (`**/*.sql`, `**/*.md`, `**/package-lock.json`, `.env`, `.env.*`).
- **Why better**: framework-native mechanism; zero runtime cost; fails visible
  (403 + logged reason) instead of silent.
- **Security impact**: closes a real information-disclosure path in dev.
- **Performance impact**: none.
- **Data/Migration impact**: none.
- **Testing strategy**: Stage 2 re-run — schema.sql/migrations now HTTP 403;
  app routes still 200.
- **Rollback**: delete the `server.fs` block.
- **Compatibility**: Vite 8 native option; no plugin interference observed.

## AD-2 — Dead `/api/stream/*` playback fallbacks removed (fail-closed)

- **Requirement**: Playback must only ever use server-signed URLs (§6.2).
- **Master Plan proposal**: presigned short-lived URL is the single source of
  playable media.
- **Problem**: `lib/player.tsx` and `routes/videos.$videoId.tsx` fabricated
  `/api/stream/{track|video}/<id>` fallback URLs when `src` was empty. No such
  route exists anywhere in the repo → guaranteed 404 at runtime.
- **Alternative designs**: (a) implement the missing API route; (b) remove the
  fabricated URLs and treat "no src" as "not yet uploaded / expired".
- **Chosen design**: (b). A proxy route would add server bandwidth cost and a
  second playback authority — against §0.3 invariant #2/#3.
- **Why chosen**: fail-closed over silent broken fetches; matches "Unknown >
  Fake".
- **Security impact**: removes an unauthenticated media-proxy-shaped surface
  before it could ever exist.
- **Testing**: existing suites green; `<video src={undefined}>` omits the
  attribute entirely (no document-relative request).

## AD-3 — ReplayGain persistence through canonical `track_files`

- **Requirement**: §11.5 ReplayGain modes Off/Track/Album without mutating
  masters; technical metadata measured from real bytes.
- **Master Plan proposal**: RG as player feature; storage location unspecified.
- **Problem**: applying gain at playback requires per-track dB values from
  server analysis to reach the client. Options: (a) new migration columns;
  (b) per-play analysis-record lookup RPC; (c) client-only tags (rejected —
  violates server-authority invariant).
- **Chosen design**: (a) — append-only migration `20260831_replaygain.sql`
  adds nullable `replaygain_track_gain_db` / `replaygain_album_gain_db` to
  `track_files`; FLAC Vorbis-comment parser extracts them; ingestion commit
  persists them; public library loader surfaces them on Track.
- **Why better**: one source of truth (physical-file layer), zero extra
  runtime round-trips, non-fabricating NULL semantics preserved.
- **Security impact**: none (server-derived values only).
- **Performance impact**: two DOUBLE PRECISION columns; no query changes.
- **Migration impact**: additive/idempotent; safe on fresh + existing DBs.
- **Clipping safety**: multiplier clamped ≤ 1.0 (HTMLMediaElement volume
  cannot exceed unity) — positive corrections capped rather than amplified.
  Documented limitation: true >1 amplification would require a WebAudio
  GainNode graph (deferred; §11.6 EQ also deferred).
- **Rollback**: drop the two columns; UI mode toggle degrades to neutral ×1.
- **Testing**: parser round-trip + multiplier math in `player-phase5.test.ts`.

## AD-4 — Lyrics timeline editor entry point restored (was dead code)

- **Requirement**: §10.5 timeline editor reachable by Owner; Phase 6 exit
  criterion "fix timing visually without editing raw timestamps".
- **Problem**: `LrcLiveSyncModal` (737-line waveform/tap-sync studio) was
  imported but never rendered anywhere — the flagship Phase 6 feature was
  unreachable. Review Center had NO lyrics editor at all despite store support.
- **Chosen design**: wire both modals into the upload Review Center
  (textarea + normalize + ±0.5s shift + online search + live sync studio),
  audio items only. NOT added to `EditTrackModal` because the studio requires
  a local audio File which exists only during ingestion.
- **Documented limitation**: already-committed tracks cannot use the live-sync
  studio (no local file); they keep textarea/search/shift paths. Future work:
  temporary re-download for re-sync, or persisted offset editing UI.

## AD-5 — Playlist rename vertical added (Phase 7 gap)

- **Requirement**: §12.2 playlists support rename.
- **Problem**: rename existed nowhere (create/delete/add/remove only).
- **Chosen design**: `renamePlaylistInternal/Server` with `.eq("user_id")`
  ownership guard + optimistic local update with rollback in
  `useMemberLibrary.renamePlaylist` + inline pencil-icon editor in
  `/my-library`.
- **Security**: ownership enforced twice (RPC guard + RLS policy).
- **Reorder** remains OPEN (documented in FINAL_PHASE_0_7_AUDIT.md): needs a
  batched position-mutation RPC + drag-drop UI; deferred to avoid a rushed
  half-design this run.

## AD-6 — Engine stop semantics preserved exactly

During P5.1 extraction, the pre-engine behavior "stop freezes current index"
(never resets index to 0) was identified in review and preserved verbatim in
the engine's `stop` decision branch, and crossfade handover keeps its modulo
wrap quirk (`advanceWrapForHandover`) that bypasses repeat=off — matching
production behavior before the refactor. Behavior-preserving refactors must
not silently "fix" product quirks; that is a separate product decision.

## AD-7 — Explicit `vitest.config.ts`

The suite previously ran on Vitest defaults by implicitly reading
`vite.config.ts`. An explicit config pins environment=node, include glob,
alias resolution, and `dangerouslyIgnoreUnhandledErrors:false` (unhandled
rejections must fail runs). Verified zero behavioral delta: 212/212 before
and after adoption.

## AD-8 — Spotify probe degrades Web API → oEmbed → graceful unavailable (Phase 9)

- **Requirement**: §14 Spotify is an external metadata/identity bridge; §14.4
  forbids any runtime dependency of Duckroom playback on Spotify.
- **Problem**: Spotify Web API requires client credentials the deployment may
  not have (optional by contract in `.env.example`). Hard-requiring them would
  make a marketing/identity feature into an operational dependency.
- **Chosen design**: three-rung ladder inside `probeSpotifyResourceInternal`:
  1. Web API via client-credentials token (cached with expiry) when
     `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are present;
  2. public `open.spotify.com/oembed` (title + thumbnail only, marked
     `source:"oembed"` so the UI can label metadata as partial);
  3. `{status:"unavailable"}` result object instead of a thrown error.
- **Why better**: Owner import flow always answers with something actionable;
  network outage degrades visibly but never crashes the console panel, and
  playback code paths contain zero Spotify imports.
- **Security impact**: all three server fns sit behind
  `requireOwnerMiddleware`; identity persistence re-validates target-row
  existence before upsert and writes audit_logs.
- **Data model impact**: generic `external_identities`
  `(provider, resource_type, external_id, resource_kind, resource_id)` unique
  link per §14.3 — no provider-specific columns in domain tables; RLS enabled
  with zero policies (service-role only, fail-closed).
- **Rollback**: drop the table / remove the admin section; nothing else
  references it.

## AD-9 — Snapshot verification is read-only; restore stays human-approved (Phase 10)

- **Requirement**: §24 backup/recovery layers; §25 owner console should let an
  Owner diagnose failure modes without opening the database manually.
- **Alternative considered**: a "Restore from snapshot" button that upserts
  manifest rows back into canonical tables.
- **Rejected because**: bulk restore is a destructive-class operation that per
  AGENTS.md must carry CAS guards, compensation and review; automating it
  behind one click invites mass-mutation accidents (the exact class of risk
  the `allowMassDeletion` guard was built to prevent).
- **Chosen design**: `verifyBackupSnapshotInternal` streams
  `library_manifest.json` from S3, safely parses it, and reports per-kind
  drift (DB − snapshot) with actionable messaging. Restore remains a documented
  procedure executed by a human using the existing manifest migration tooling,
  with the verify report as its pre-flight check.
- **Security impact**: none (read-only); reduces blast radius versus automated
  restore.
- **Testing**: missing snapshot / corrupt JSON / drifted counts / exact-sync
  cases in `owner-console.test.ts`.

## AD-10 — Single client share helper; Guest track-share keeps page-URL behavior

- **Problem**: Phase 8 needed share buttons on album and video pages while
  TrackRow already had its own mint+WebShare+clipboard flow — four copies of
  the same logic would drift apart.
- **Chosen design**: `lib/share-client.ts:createAndShareLink` centralizes
  mint → Web Share API → clipboard fallback for logged-in users across track/
  album/video/playlist. Guests keep the pre-existing behavior of sharing the
  current page URL directly (§1.3 grants Guests sharing of public content;
  minting a capability link adds nothing for an anonymous viewer of an
  already-public page).
- **Behavior note**: clipboard-copy confirmation remains an `alert()` in the
  Guest path exactly as before; migrating to toasts is a product polish item,
  not silently changed here.
- **Testing**: covered indirectly through sharing suite (mint internals) +
  live SSR boot checks; interactive Web Share requires real devices (tracked).

## AD-11 — Playlist reorder via guarded sequential updates (Phase 7 gap closure)

- **Requirement**: §12.2 playlists support reorder; AD-5 deferred it pending a
  batched position-mutation design.
- **Alternative considered**: SQL RPC function doing one atomic
  `UPDATE ... FROM (VALUES ...)` statement.
- **Rejected because**: the member-data layer consistently uses plain
  service-role queries with explicit ownership guards; an atomic RPC would
  introduce a second authorization style for a NON-destructive operation.
- **Chosen design**: `reorderPlaylistInternal` validates (a) non-empty,
  duplicate-free order list, (b) playlist ownership, (c) EXACT membership
  match against current `playlist_tracks` — rejecting stale client lists
  loudly instead of silently corrupting positions — then writes positions
  sequentially (`0..n-1`) each guarded by the composite key.
- **Honest limitation**: multi-row write is not atomic; a mid-way failure can
  leave partially-updated ordering. Accepted because reorder is cosmetic,
  fully recoverable by retrying, and never loses data. Documented here rather
  than hidden.
- **UI**: expandable playlist cards in `/my-library` with ↑/↓ controls
  (keyboard-accessible buttons over drag-drop: zero new dependencies, works
  with screen readers and reduced-motion). Optimistic move with exact
  rollback lives in `useMemberLibrary.reorderPlaylist`.
- **Known edge case (fail-safe)**: if a playlist references a track that no
  longer exists in the global library, the resolved UI list differs from the
  server membership set — the server rejects the request with a visible
  error instead of writing wrong positions. Surfaced, not swallowed.

## AD-13 — Client/server split của share module (P0 release-blocker fix)

- **Requirement**: §13 sharing; mọi page phải load được trong browser.
- **Problem (bị independent review bắt qua F12, smoke cũ bỏ lỡ)**:
  `sharing.ts` có `import { createHash, randomBytes } from "node:crypto"` ở
  module scope, nhưng module này nằm trong client graph (TrackRow →
  share-client, routes/s/$token). Vite externalized node:crypto cho browser →
  **Uncaught Error tại module evaluation → MỌI page trắng**. SSR smoke
  (HTTP-status-only) không bao giờ bắt được vì SSR chạy trong Node.
- **Root cause**: TanStack Start chỉ strip code NẰM TRONG handler; helper
  module-level (generateShareToken/hashShareToken) dùng node:crypto khiến
  import bị giữ lại client bundle.
- **Chosen design**:
  1. `sharing.server.ts` — toàn bộ internals (node:crypto, DB, S3 signing);
  2. `sharing.ts` — chỉ 3 createServerFn wrappers; handler body gọi internals
     qua **dynamic `await import("./sharing.server")`** → bị strip khỏi
     client bundle cùng handler;
  3. `manifest-migration.ts` → `manifest-migration.server.ts` (cùng class
     risk, hiện chỉ test import — đặt tên theo convention);
  4. Guard test `client-boundary.test.ts`: (a) không file client-reachable
     trong lib/services chứa `from "node:"`; (b) sharing.ts regression;
     (c) routes/components không import `*.server` trực tiếp; (d) convention
     sanity;
  5. `vite.config.ts` fs.deny thêm `**/*.server.ts` (dev-origin không serve
     trực tiếp server internals).
- **Why better**: xử lý CẢ CLASS bug (mọi `node:*` top-level import), không
  chỉ 1 instance; guard tự động chạy trong mọi `npm test`.
- **Security impact**: + (dev origin không tải được server internals);
  behavior share không đổi (token model, revoke, capability rules nguyên vẹn
  — 12 sharing tests vẫn green).
- **Data integrity impact**: none.
- **Performance impact**: dynamic import chỉ chạy server-side; client bundle
  NHỎ hơn trước (bỏ node:crypto shim path).
- **Migration impact**: none (không đụng DB).
- **Compatibility impact**: import paths đổi cho tests (sharing.server) —
  đã cập nhật; không API công khai thay đổi.
- **Testing evidence**: 297/297; dev-server module-graph check: transformed
  sharing.ts/TrackRow không còn node:crypto; sharing.server.ts → 403.
- **Rollback**: revert 3 file (sharing.ts/sharing.server.ts/vite.config) —
  nhưng sẽ tái tạo P0; rollback chỉ dùng nếu fix gây regression khác.

## AD-14 — Smoke verification mở rộng: client module-graph check

- **Problem**: mọi localhost smoke trước đây chỉ assert HTTP status của SSR
  HTML → mù với lỗi client-side module evaluation (chính là chỗ P0 trượt qua
  4 vòng "verified").
- **Chosen design**: smoke bắt buộc thêm bước GET transformed module URLs từ
  dev origin (`/src/lib/<file>.ts`) và assert không chứa `node:` imports;
  kèm guard test tĩnh trong suite. Ghi nhận: đây vẫn là proxy — browser thật
  (Playwright §26.3) vẫn là external gate cho UI behavior.

## AD-12 — user_preferences scope: playback-critical settings only

- **Requirement**: §5.2 lists theme/volume/crossfade/replaygain/default_view/
  reduced_motion under a user_preferences table.
- **Chosen design**: migration `20260902` persists theme, volume,
  crossfade_seconds (0–10 check), replaygain_mode (enum check) — the settings
  that change actual playback behavior. `default_view`/`reduced_motion` are
  deliberately NOT columns yet: default_view has no consumer feature, and OS
  reduced-motion is already honored globally via `MotionConfig
  reducedMotion="user"` (§18) — persisting it would create two competing
  sources of truth for the same signal.
- **Non-fabrication**: absence of a row returns documented client defaults;
  reads clamp/normalize stored values defensively (tested).
- **Guests unaffected**: preferences sync is Member-scoped; Guests keep
  localStorage behavior.

## AD-15 — Sửa mar.created_at trong 20260825 (bug lộ khi apply live lần đầu)

- **Requirement**: backfill track_files.verified_at từ analysis record (§5.1).
- **Problem**: statement tham chiếu mar.created_at — cột KHÔNG TỒN TẠI bao giờ
  (bảng có verified_at từ 20260821; analyzed_at thêm 20260822). Chain chưa bao
  giờ được apply trọn vẹn nên typo nằm im. Owner chạy live lần đầu →
  ERROR 42703 đúng tại statement này.
- **Chosen design**: sửa đúng 1 identifier thành COALESCE(mar.verified_at,
  NOW()) + banner comment ngay trong file. Không phải rewrite history âm
  thầm: chain chưa từng apply thành công ở môi trường nào; việc sửa được ghi
  công khai tại đây + HISTORY.
- **Guard mới**: scripts/check-migration-columns.cjs (npm run check:migrations)
  — static validator xây schema map từ CREATE/ALTER toàn chain rồi đối chiếu
  mọi alias.column reference; bắt đúng class bug này trước khi tới live.
- **Testing evidence**: checker exit 0 (128 refs / 22 tables) sau fix; trước
  fix bắt đúng 1 phantom.

## AD-16 — Chain đòi LEGACY BASELINE: tracks/albums/videos không được tạo

- **Requirement**: fresh-bootstrap safety (Master Plan §34/§35).
- **Discovery (live, 2026-08-25)**: chain KHÔNG tạo tracks/albums/videos —
  chỉ ALTER ADD COLUMN IF NOT EXISTS trên schema legacy v1 có sẵn. DB của
  owner có legacy tables (vì vậy albums tồn tại nhưng thiếu version) → chain
  chạy được. Một Supabase project mới tinh khiết sẽ fail ngay ALTER đầu tiên
  (relation does not exist). Các audit trước đánh dấu fresh-bootstrap
  UNVERIFIED — nay được chứng minh bằng thực tế.
- **Chosen design (hiện tại)**: ghi nhận contract rõ ràng: chain yêu cầu
  legacy baseline; checker chứa LEGACY_BASELINE map (các cột mà chain thực
  sự tham chiếu) để static validation có ý nghĩa; schema.sql boundary header
  bổ sung cảnh báo.
- **OPEN gap**: tạo baseline DDL cho project mới (supabase/baseline-v1.sql) —
  cần schema v1 gốc chính xác, không đoán; tracked trong handoff.
- **Impact**: không đổi behavior với DB hiện có; biến điều ngầm định thành
  explicit contract.

---

# MOBILE UI OVERRUN (2026-08-31) — ADRs AD-M1..AD-M6

> Per Master Plan deviation policy. Scope: presentation layer + shell only;
> player engine/queue/broadcast/persistence/auth/ingestion logic untouched.

## AD-M1 — Bottom navigation dock replaces the horizontal pill bar (<lg)

- **Problem**: the mobile top bar crammed up to ~8 destinations into a
  horizontally scrolling row of ~26px text pills — thumb-hostile, hidden
  options, 0 primary reachability, sign-out as a 28px mystery icon.
- **Alternatives**: (a) keep pills + enlarge; (b) hamburger drawer; (c)
  bottom dock with 4 tabs.
- **Chosen**: (c). 4 primary destinations (Trang chủ/Thư viện/Kho của tôi/
  MV) in a fixed glass dock; secondary destinations (Albums/Đĩa đơn via
  context links, Tải lên + Owner Console in the top header for owner) —
  matches "limited primary destinations" IA rule.
- **Why superior**: thumb-reachable, always visible, no hidden nav;
  hamburger buries everything one level deeper and wastes the prime zone.
- **Measured**: tabs 98×56px, aria-current, active CSS-only (no layoutId —
  2026-08-25 perf convention). Desktop sidebar untouched.
- **Testing**: mobile-ui-shell.test.ts pins 4-tab contract + aria-current +
  lg:hidden; CDP verified geometry + tab flow + back.

## AD-M2 — Phone queue = bottom sheet with button reorder (not touch-DnD)

- **Problem**: QueuePanel is a 360px right drawer with HTML5 drag reorder —
  unusable on touch (drag events don't map); drawer pattern is desktop-centric.
- **Alternatives**: (a) make HTML5 drag work with pointer polyfills; (b)
  reuse vaul Drawer; (c) dedicated QueueSheet + ↑/↓ buttons.
- **Chosen**: (c), reusing the exact same `usePlayer()` API
  (queue/index/jumpTo/moveInQueue) — zero player-logic duplication; desktop
  drawer unchanged ≥md. Reorder via 44px ↑/↓ buttons mirrors AD-11's
  accessibility-first playlist reorder decision (screen-reader + reduced
  motion friendly, no fragile touch-DnD fighting scroll).
- **Why superior**: honest touch affordances, a11y, no new deps (own
  MobileSheet primitive); drag kept for pointer users on desktop.
- **Testing**: CDP — 76 rows, reorder swap observed optimistically;
  guard test pins same-API + no `draggable` in QueueSheet.

## AD-M3 — TrackRow phone actions via bottom actions sheet

- **Problem**: Share/Edit/Delete were `opacity-0 group-hover:opacity-100`
  → permanently unreachable on touch (no hover). Favorite was 28px.
- **Alternatives**: (a) always-visible inline icons (5 icons/row = cramped,
  violates "item exposes only the most important info"); (b) long-press
  menu (undiscoverable, conflicts with scroll); (c) ⋯ button → sheet.
- **Chosen**: (c). Favorite stays inline (44px) as the highest-frequency
  action; ⋯ opens TrackActionsSheet (Play/Favorite/Add-to-playlist/Share/
  Edit(owner)/Delete(owner with two-tap confirm, no alert()). Handlers are
  passed from TrackRow — no business-logic duplication; guest login CTA
  path preserved.
- **Why superior**: touch discoverability + 44px targets + destructive
  confirm without browser alert(); desktop keeps hover elegance (verified
  no ⋯ renders ≥md).
- **Testing**: CDP guest flow (sheet actions, auth-gate); guard test pins
  sheet trigger + confirm pattern.

## AD-M4 — Phone mini-player as stacked dock above bottom nav

- **Problem**: the desktop 3-column PlayerBar grid (min-w-[280px] center)
  cannot fit 360px; several controls (lyrics/queue/volume) were
  `hidden md:flex` — phone users lost queue/lyrics entry from the bar.
- **Chosen**: dedicated phone dock (<md, `lg:hidden`): 48px cover + titles
  + play/next (44px) + 2px read-only progress strip (isolated
  `<MiniProgressStrip>` subscriber — same time-isolation pattern as
  PlayerBarElapsedLabel); tap expands. Full seek/lyrics/queue live in the
  expanded player (queue button added to phone fullscreen header since the
  mini is intentionally minimal).
- **Why superior**: honest 44px targets instead of a squeezed grid; zero
  timeupdate re-render cost for the whole dock.
- **Bug caught by QA**: `bottom-safe` utility + `bottom-14` collided on the
  `bottom` property (custom utility wins) → dock lifted above its intended
  offset; fixed to `bottom-[calc(3.5rem+var(--safe-bottom))]` and pinned by
  test. Same collision fixed on the nav itself (flush bottom-0 + pb-safe).
- **Testing**: CDP geometry (no strict overlap), controls 44×44, strip
  updates on seek; desktop footer asserted display:none at 1440.

## AD-M5 — Safe-area system via CSS custom properties (+ viewport-fit)

- **Problem**: no `env(safe-area-inset-*)` usage anywhere; `viewport-fit`
  was not set → notch/Dynamic Island/gesture bars overlap docked UI.
- **Chosen**: `viewport-fit=cover` in __root meta + `--safe-top/bottom/
  left/right` tokens (`max(env(...), 0px)`) + utilities `pt-safe/pb-safe/
  px-safe` + explicit `calc()` offsets where a numeric offset is needed
  (AD-M4). Applied to: bottom nav, mini dock, fullscreen player (top+bottom),
  MobileSheet, upload sticky bar, top header.
- **Why superior**: single source of truth, zero JS, no magic numbers;
  resolves to 0 on desktop/no-notch (verified computed value in dev).
- **Testing**: guard test pins tokens + utilities + viewport meta; real
  device insets remain an honest OPEN (no physical device in env).

## AD-M6 — Pre-existing working-copy tsc errors fixed (scope note)

- **Problem**: this working copy at HEAD failed `tsc --noEmit` with 4
  errors (EditTrackModal/EditAlbumModal TS7030; admin.tsx TS2345 union
  narrowing from `orphanKeys: []` literal; TS2367 `s3Available === false`),
  despite CURRENT_VERIFICATION.md's "0 errors" claim (that doc's env or the
  zip snapshot differed from this tree).
- **Chosen**: minimal behavior-identical fixes (explicit `return undefined`
  cleanup branches; widen literal types via annotated locals/`as boolean`)
  so the mobile run restores the documented gate state.
- **Why**: "if something is architecturally wrong: fix it" + the release
  gate requires 0 errors; leaving known type errors in a UI- overhaul diff
  would poison attribution of any new failure.
- **Testing**: tsc 0 errors; full suite 310/310; no behavior change (types
  only). CURRENT_VERIFICATION.md updated accordingly.
