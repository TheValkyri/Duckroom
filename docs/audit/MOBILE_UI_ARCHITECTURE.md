# MOBILE UI ARCHITECTURE (2026-08-31)

> Design contract for the mobile-first overhaul. Companion to
> `MOBILE_UI_CONTEXT_AUDIT.md` (evidence). Follows Master Plan §17/§18/§19
> (visual/motion/perf bars) and the project's established perf conventions.
> **Principle: mobile is the primary layout; desktop is an enhancement —
> but zero desktop regression is acceptable.**

## 1. Breakpoint & safe-area strategy

| Tier | Widths | Treatment |
|---|---|---|
| Primary phones | 360 / 375 / 390 / 393 / 412 | Base layout (`base` + `xs` tuning) |
| Large phones | 430 / 768 | Same structure, more breathing room |
| Desktop | ≥768 (`md`) / ≥1024 (`lg`) | Existing desktop layouts preserved |

- Viewport meta gains `viewport-fit=cover` (required for safe-area insets).
- Global utilities (styles.css):
  - `--safe-top: max(env(safe-area-inset-top), 0px)` /
    `--safe-bottom: max(env(safe-area-inset-bottom), 0px)` as CSS vars;
    applied via helper classes (`pt-safe`, `pb-safe`, `h-safe-bottom`).
- Bottom-docked surfaces (bottom nav, mini-player, fullscreen player,
  sheets, dialogs) always reserve `--safe-bottom`. Notch/Dynamic Island:
  top bar uses `--safe-top` on mobile; fullscreen player header too.
- `min-h-screen` → keep, but fullscreen player uses `inset-0` fixed overlay
  (already) — no dvh changes needed there; body scroll lock added.

## 2. Navigation architecture (mobile)

Replace the scroll-pill top bar (<lg) with:

**Top header (compact)**: logo + page title, right side: upload-status dot
(owner), account button (login avatar or login CTA). Height ~48px +
safe-top. No nav links in the top bar.

**Bottom navigation (fixed, <lg only)**: 4 primary destinations —
Trang chủ `/`, Thư viện `/library`, Kho của tôi `/my-library`, MV `/videos`
— plus the **mini-player occupies the dock slot above the bottom nav**
(see §3). Each tab: 44×48px effective target, icon + 10px label, active
state = primary-colored icon + dot indicator (CSS only, no layoutId —
matches 2026-08-25 perf convention).

Secondary destinations reachable but not in the dock:
- Albums & Đĩa đơn: linked from Home sections + Thư viện filter pills
  (they are views of the same library data; demoting them from primary nav
  reduces dock to 4 — deliberate IA decision, recorded in ADR-M2).
- Tải lên + Owner Console: top-header account area (owner only), since
  they're low-frequency but high-stakes actions.
- Search: NOT a tab — Library is the search surface (`/library` opens
  keyboard-ready search). One less tab; avoids near-duplicate destinations.

Desktop ≥lg: unchanged sidebar.

**Z-index contract (mobile)**: content 0 → bottom nav z-30 → mini-player
z-40 → sheets/dialogs z-50 → fullscreen player z-[60] → upload banner
z-50. Mini-player sits *above* bottom nav visually (stacked dock), never
covering it.

## 3. Player on mobile

### 3.1 Mini-player (the dock, <lg)

- Fixed above bottom nav: 64px row (cover 48px, title/artist marquee-truncate,
  play/pause 44px, next 44px) + 2px seek progress strip along the top edge
  (read-only progress; full seek in expanded player — prevents accidental
  seeks in a 2px strip, honest affordance).
- Tap anywhere (except buttons) → expand. Chevron affordance on cover.
- Uses existing `usePlayer` projection + `usePlayerTime` isolated
  `<MiniProgress>` subscriber (same pattern as PlayerBarElapsedLabel).
- Desktop ≥md: keep existing PlayerBar grid exactly as-is (min-width
  fixups only where the center column forced overflow below ~480px —
  adjust to `min-w-0` below md).

### 3.2 Fullscreen player (NowPlaying, <lg)

- Stacked single column: header (collapse button + lyrics toggle + queue
  button — all 44px), artwork `min(60vw, 34vh)` centered, title/artist,
  seek + times, transport (size lg), compact visualizer.
- Lyrics on mobile = **full-screen mode inside the player**: when
  `lyricsOpen`, the pane covers the stage area (absolute inset, bg from
  ambient layer) with its own close-to-lyrics-off control — no longer a
  side-by-side sibling that crushed controls. Desktop ≥lg unchanged
  (right-half overlay).
- Queue on mobile = bottom sheet (§3.3); on desktop unchanged right drawer.
- Gesture: **swipe-down on artwork/header collapses the player**
  (pointer-events based, threshold 72px vertical, horizontal intent
  cancels) — implemented with existing motion drag gesture; every gesture
  has a visible control equivalent ("Thu nhỏ" button). No swipe-left/right
  navigation (conflicts with browser back/scroll). `prefers-reduced-motion`
  respected automatically by MotionConfig.
- Bottom transport row padded by `--safe-bottom`.

### 3.3 Queue on mobile (<md): bottom sheet

- New `QueueSheet` reusing the SAME `usePlayer()` API (queue/index/jumpTo/
  moveInQueue/shuffle) — zero player-logic duplication; the desktop
  `QueuePanel` stays for ≥md.
- Reorder: tap-target ↑/↓ buttons per row (44px), consistent with AD-11's
  accessibility-first choice (no fragile touch-DnD; HTML5 drag kept for
  desktop pointer users). Optimistic store update already handled by
  `moveInQueue`.
- PlayerBar's queue button routes to sheet on <md, drawer on ≥md.

### 3.4 Do-not-break list (from context audit §5/§15)

Engine store, queue decisions, broadcast election, persistence triggers,
MediaSession, hotkeys, resume pill, crossfade, RG multiplier — untouched;
only presentational components change.

## 4. Lists, cards, actions on touch

- **TrackRow**: on touch (no hover), row actions must be reachable:
  - Favorite: always visible (as today) but 40px hit target (p-2).
  - Share/Edit/Delete: revealed via an explicit "more" (⋯) button per row
    opening a bottom **TrackActionsSheet** on <md (favorite toggle /
    share / add-to-playlist / edit (owner) / delete (owner, with confirm
    step in sheet)). Desktop ≥md keeps current inline hover actions.
  - Row height min 48px; format chip hidden <md (as today) but info
    preserved in the sheet.
- Grid cards (albums/singles): play FAB appears on `group-hover` for
  pointer; on touch, **tap = play** (already true for title tap; make
  cover tap play too) — no hidden actions. Edit/delete for owner remain
  hover-reveal on desktop; on touch reachable through the track/album
  route's own controls (already present on pages).
- No destructive swipe gestures anywhere (per instruction; no
  confirmation/recovery model for swipe-delete at this scope).

## 5. Sheets & modals policy

- New mobile-first surfaces (TrackActionsSheet, QueueSheet) use a shared
  lightweight `MobileSheet` primitive (motion-based bottom sheet, drag-to-
  dismiss optional, safe-area padded, `role="dialog"` + focus trap via
  autoFocus + Escape/backdrop close). Radix Dialog stays for desktop and
  existing modals.
- Existing modals (edit/crop/lyrics-search/LRC studio) keep logic; only
  spacing/scroll fixes at <sm (p-4 outer, max-h-[92dvh] where needed).
- Replace `alert()` failure surfaces in member playlist flows with inline
  error banners (existing `reorderError` pattern) — logic unchanged.
- Back behavior: sheets close on backdrop tap + Escape; router back is
  never intercepted (predictable).

## 6. Search UX (library page)

- Input: `type="search"`, `enterkeyhint="search"`,
  `autoComplete="off"`, autocapitalize off; clear button (exists); 44px
  input height.
- States: existing empty ("Thư viện trống") + no-results text kept;
  add a skeleton row set while `useLibrary` is pre-hydration on first
  visit (client-only, SSR-safe) — 6 shimmer rows.
- Keyboard: results filter live (existing); input remains sticky-free
  (page scrolls under) — matches current behavior; acceptable.

## 7. Home / pages spacing

- Section paddings: `px-4 sm:px-6`, page tops `py-6 sm:py-12`; hero artwork
  `w-40 sm:w-60 md:w-80`, hero text scale `text-3xl sm:text-5xl`.
- Grids: albums `grid-cols-2 gap-4 md:gap-8` (2-up works at 360 with 16px
  gaps), singles rail: `grid-cols-2 sm:grid-cols-3…` (existing) but
  horizontal-scroll rail for "Nghe gần đây" is NOT added — vertical TrackRow
  list already fits mobile and keeps code shared (avoid duplicate
  components; instruction's "rails where appropriate" judged against
  this codebase: vertical rows are the Duckroom pattern).
- Album detail: header stacks (artwork w-44 centered, meta below) at
  <md; play buttons full-width row.

## 8. Upload / Review Center (mobile)

- Same stages/stores; layout stacks (already col-span behavior) with
  tightened spacing; bulk-edit toolbar becomes sticky action bar at
  bottom when selection > 0 (safe-area padded), Apply / Reject separated
  (destructive right, red-outline).
- Checkboxes 24px visual with 44px label hit area; review card inputs
  `h-10`; "Phê duyệt & Tải lên" sticky-safe at flow bottom.
- Duplicate decision block: buttons full-width on <sm, amber styling kept.
- No logic changes to upload-store; purely presentational.

## 9. State & code architecture rules

- One component per surface, responsive via Tailwind — NO
  `<MobileX/><DesktopX/>` duplication except where interaction models
  genuinely differ (QueueSheet vs QueuePanel share no layout but share
  the player API; MobileSheet is a primitive, not a fork).
- No new dependencies. motion + existing tokens only.
- No magic numbers: spacing/targets from the scale (`p-2`→44px targets,
  `size-11` buttons); z-index table in §2.
- SSR-safe: all viewport/safe-area code is CSS; JS touch-gesture code
  gated by pointer media checks inside effects.
- Perf: no new time subscribers (reuse isolation patterns); sheets
  unmount when closed (AnimatePresence conditional render); images keep
  `loading="lazy" decoding="async"`.

## 10. Accessibility requirements

- Bottom nav: `<nav aria-label="Chính">` with `aria-current="page"`.
- Mini/sheet buttons: aria-labels (Vietnamese, consistent with existing).
- Sheets: `role="dialog" aria-modal="true"`, labeled by heading, Escape +
  backdrop close, initial focus on primary action.
- Sliders: existing native range inputs retained (keyboard free).
- Touch targets ≥44px for: nav tabs, mini controls, transport, queue
  rows' buttons, favorite, more, sheet actions, upload bulk actions.
- Contrast: existing token palette passes on dark surfaces (gold on
  near-black); no new colors introduced.
- `prefers-reduced-motion`: gesture animations inherit MotionConfig;
  CSS transitions already covered by the global reduce block.

## 11. Out of scope (guarded)

No backend/DB/auth/ingestion-logic changes; no new routes; no settings
page duplication (user_preferences authority untouched); no Phase 8+
features; no virtualization at current scale; no desktop redesign.

## 12. Test & acceptance plan

- Gates after implementation: `npx tsc --noEmit`, `npm run lint`,
  `npm test` (297 + new UI-logic tests), `npm run build`,
  `npm run scan:secrets`.
- New automated tests (pure-logic only, following repo style): safe-area
  CSS token presence (styles.css static check), mobile-sheet/queue-sheet
  contract (render + player API wiring via jsdom where feasible without
  new deps), TrackRow actions-sheet presence at small widths (matchMedia
  mocked) — kept minimal and non-flaky.
- Localhost: dev server + real page loads at 360/375/390/393/412/430/768
  and 1280/1440/1920; all 12 mandatory flows; red-team taps (spam
  play/pause/next, back during sheet, rotate during player, keyboard
  open/close); results in `MOBILE_UI_QA.md` + responsive matrix.
