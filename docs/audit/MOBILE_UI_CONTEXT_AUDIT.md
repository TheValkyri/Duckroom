# MOBILE UI CONTEXT AUDIT (2026-08-31)

> GATE DOCUMENT. Per instruction: **no mobile implementation code was written
> before this audit was completed.** This file records what Duckroom IS today
> — product, architecture, data flows, player semantics, design language — so
> the mobile overhaul preserves Duckroom's identity instead of replacing it
> with a generic music app.

Sources read before writing this audit:

1. `docs/DUCKROOM_MASTER_PLAN.md` (full 2876 lines)
2. `docs/AGENT_HANDOFF.md`
3. `docs/audit/CURRENT_VERIFICATION.md`
4. `docs/audit/FINAL_RELEASE_GATE.md`
5. `docs/audit/FINAL_PHASE_0_7_HARDENING_REPORT.md`
6. `docs/PHASE_5_ARCHITECTURE.md`
7. `docs/audit/ARCHITECTURE_DECISIONS.md` (AD-1…AD-16)
8. `docs/HISTORY.md`
9. `repo/README.md`, `repo/package.json`, `repo/vite.config.ts`, `repo/AGENTS.md`
10. Full `src/routes/*`, `src/components/**` (incl. `player/*`), `src/lib/*`
    (player, queue, broadcast, persistence, preferences-sync, member data,
    upload-store, share-client, motion), `src/hooks/use-mobile.tsx`,
    `src/styles.css`, `src/test/*` inventory.

---

## 1. Product purpose

Duckroom is a **personal music platform** (Vietnamese-language UI):
lossless-first playback of user-owned masters, lyrics as a first-class
feature, artwork as identity, owner-controlled ingestion with real binary
analysis, member personal library, and professional share links. It is NOT a
Spotify clone; the duck mascot + waveform + dark "quiet luxury" aesthetic are
the brand DNA (Master Plan §17).

Three roles (§1.3, §7.2):

| Capability | Guest | Member | Owner |
|---|:-:|:-:|:-:|
| Browse/play public library, lyrics, artwork, share | ✅ | ✅ | ✅ |
| Persistent favorites / playlists / history / continue-listening | ❌ | ✅ | ✅ |
| Upload master, edit metadata, trash, admin/storage tools | ❌ | ❌ | ✅ |

Terminology in the UI is Vietnamese and MUST be preserved: "Trang chủ",
"Thư viện", "Kho của tôi", "Albums", "Đĩa đơn", "MV", "Tải lên", "Hàng đợi",
"Lời bài hát", "Yêu thích", "Trộn bài", "Lặp lại", "Chủ nhân"... A mobile
overhaul that renames these breaks product identity.

## 2. Target user flows (current)

- **Guest**: browse home → play track → see lyrics → share page URL.
- **Member**: everything above + favorite (optimistic + rollback), playlists
  (create/rename/delete/reorder/add/remove), history, continue-listening
  pill ("Tiếp tục nghe … ?"), preferences synced to `user_preferences`
  (theme/volume/crossfade/ReplayGain mode — AD-12).
- **Owner**: ingestion Review Center (upload.tsx): select files → local
  analysis → metadata review (bulk edits §8.4) → artwork crop → lyrics
  (textarea / normalize / ±0.5s / online search / LRC live-sync studio) →
  duplicate decision (upload_anyway/use_existing/cancel) → approve →
  server verify (SHA-256) → commit; Owner Console `/admin` (health,
  duplicates, orphans, shares, users, backups, audit).

## 3. Current information architecture (routes)

```
/                     Home: hero featured album, albums grid, singles grid,
                      recent tracks (first 5), videos grid
/library              All tracks: search input + album filter pills + TrackRow list
/albums               Album grid (+create modal for members)
/albums/$albumId      Album detail: artwork, play/shuffle, AddTracksModal, TrackRow list
/singles              Singles: grid/list view toggle, search, per-card edit/delete
/videos               Video grid
/videos/$videoId      Native <video> + custom controls, specs dl
/my-library           Member: tabs Yêu thích / Playlists / Lịch sử (auth-gated)
/upload               Owner: Review Center (redirects non-owner)
/admin                Owner Console (14 sections, 1340 lines)
/login                Email/password + Google OAuth
/s/$token             Public share page (fail-closed friendly error state)
```

## 4. Current navigation architecture

- **Desktop ≥1024px (lg)**: fixed collapsible sidebar (256↔80px, CSS width
  transition). Items: Trang chủ, Thư viện, Kho của tôi, Albums, Đĩa đơn, MV,
  Tải lên (owner only) + Owner Console (owner) + login/logout block.
- **Mobile <1024px**: a **horizontal scroll pill bar** pinned under a top
  glass bar: every nav item (up to 8 links incl. Admin + Đăng nhập/Đăng xuất)
  is crammed into an `overflow-x-auto` row of tiny text pills.
- `useIsMobile()` exists (`src/hooks/use-mobile.tsx`, 768px breakpoint) but
  is only used by the unused shadcn `ui/sidebar.tsx`.

### Mobile navigation problems (observed, to fix)

1. The pill row holds up to ~8 destinations → violates "limited primary
   destinations"; horizontal scrolling hides most of them.
2. Touch targets: pills are `px-3 py-1 text-xs` (~26px tall) — below the
   44px standard.
3. Sign-out on mobile is a single tiny icon button with no confirmation and
   28px-ish target.
4. No bottom navigation: the thumb-reachable zone is unused; primary nav
   lives at the very top (opposite corner from thumb on tall phones).
5. No safe-area handling anywhere (`env(safe-area-inset-*)` is not used;
   `viewport-fit=cover` not set in the viewport meta).

## 5. Player architecture (Phase 5 — MUST NOT BREAK)

From `docs/PHASE_5_ARCHITECTURE.md` + `src/lib/player.tsx`:

- **State ownership**: transport state lives in an external engine store
  (`player-engine.ts`, `useSyncExternalStore`); React `PlayerProvider` only
  projects it and performs side effects. Fine-grained **time store** is
  separate (`usePlayerTime()`); only SeekBar/time labels/lyrics subscribe.
- **Queue**: pure decisions in `player-queue.ts` (`decideNext`, `decidePrev`
  — prev restarts current if position > threshold; tested). Shuffle O(n),
  repeat off/all/one, `moveInQueue`, `jumpTo`, `clampIndexToQueue`.
- **Audio**: dual `<audio>` A/B elements at root (never unmounted by route
  changes); equal-power crossfade 0–10s; gapless best-effort; ReplayGain as
  clamped ≤1.0 volume multiplier (AD-3), mode persisted locally +
  synced to server prefs for members.
- **Multi-tab**: BroadcastChannel `duckroom-player-v1` with CLAIM-phase
  leader election (B2 fix); only leader plays/persists; followers mirror
  STATE_SYNC and send COMMANDs. `tabRole` exposed in context.
- **Persistence**: member → `playback_state` RPC (debounced 3s, flush on
  hide/beforeunload), guest → `duckroom.player.session` localStorage;
  restore produces the "Tiếp tục nghe" resume pill. History idempotent via
  `client_event_id` (20260904).
- **UI flags in context**: `expanded`, `lyricsOpen`, `queueOpen` (with
  setters) — consumed by PlayerBar/NowPlaying/QueuePanel.
- **MediaSession**: registered once via refs; metadata + playbackState.
- **Hotkeys**: Space, Shift+←/→, S, R, L, Escape (desktop parity, keep).
- **Recovery**: self-healing URL refresh cap 2, online resume, stalled
  soft-reload.

**Player UI components**:

- `PlayerBar.tsx` — fixed bottom glass footer (desktop: 3-col grid
  [info | controls+seek | right actions]; mobile: SAME 3-col grid crammed
  at 360px → overflow of the `min-w-[280px]` center column forces
  horizontal squish; volume/crossfade/lyrics/queue buttons partially
  `hidden md:flex` so mobile loses lyrics/queue access from the bar).
- `NowPlaying.tsx` — fullscreen overlay (z-50) with ambient crossfade bg,
  spinning vinyl, SeekBar, TransportControls, lyrics pane (desktop:
  right-half overlay; mobile: `h-[60vh]` inline block that COVERS the
  controls because it's rendered as a sibling in a flex row).
- `QueuePanel.tsx` — fixed right drawer `w-[360px] max-w-[88vw]`,
  `bottom-[73px]`, HTML5 drag reorder (`draggable` + onDragStart/Over/Drop)
  — drag does not exist on touch; no touch reorder path.
- `Controls.tsx` — TransportControls (shuffle/prev/play/next/repeat) with
  `size md|lg`; SeekBar = custom track + hidden native range input
  (good a11y pattern, thin hit area on mobile: `h-6` compact / `h-8`).
- `Lyrics.tsx` — `LyricsPane`: rAF auto-scroll (interrupt-safe,
  4500ms user-scroll override), active-line scale/opacity highlighting,
  tap-to-seek per line, per-track offset from localStorage applied at
  display time (offset control UI was deliberately removed 2026-08-25
  — KEEP that decision), no-lyrics empty state.

## 6. Member vs non-member differences (UI-relevant)

- Guest: favorite tap → inline auth-gate modal (TrackRow's login prompt —
  nice pattern, keep); playlists picker hidden (`isLoggedIn && extraActions`);
  `/my-library` → login CTA screen; preferences remain localStorage-only.
- Member: everything persists server-side; `user_preferences` is canonical
  (AD-12) — volume/crossfade/ReplayGain hydrate on login; debounced report
  with hydrate-gate (no echo-write). **Mobile settings UI must not create a
  second preference authority.**

## 7. Ingestion flow (Owner, upload.tsx)

Store: `upload-store.ts` external store (subscribe/getState) with items:
stage machine (`waiting_review → uploading → verifying_server → committing
→ complete | failed`), progress %, per-item metadata/artwork/lyrics/
duplicate/review chips (§8.3), bulk-edit `applyBulkMetadataEdit`
(artist/album/year) + reject-selected, retry/cancel/clear-completed,
approve single/all. Floating global banner (AppShell) when uploads run in
background. Modals: ArtworkCropModal, LyricsSearchModal (max-w-5xl, 85vh),
LrcLiveSyncModal (737-line waveform tap-sync studio, max-w-4xl).

Layout: 12-col grid — list col-span-5, review card col-span-7 → collapses
to single column on mobile but the review card's 2-col sm:grid metadata
form and modals are desktop-dense.

## 8. Lyrics flow

- Ingestion: textarea + "Chuẩn hóa LRC" + ±0.5s shift + online search
  (LRCLIB/Lyrics.ovh via `lyrics-search.ts`) + live tap-sync studio (AD-4
  wired it into Review Center; audio-only because it needs the local File).
- Playback: `Track.lyrics: LyricLine[]` + `lyricsSource` attribution;
  LyricsPane (above) with per-track offset applied at display only (§10.4).
- Owner can edit committed tracks via EditTrackModal (textarea/search/
  shift only — studio limitation documented in AD-4).

## 9. Sharing flow

- Logged-in users: `createAndShareLink` (lib/share-client) mints
  `/s/{token}` (128-bit, SHA-256-attributed server-side) → Web Share API →
  clipboard fallback. TrackRow = instant share; album/video/playlist pages
  use `ShareMenu` with expiry choices (forever/30d/7d/24h).
- Guests share the current page URL directly (AD-10 — intentional; keep).
- `/s/$token` renders friendly invalid/expired page (fail-closed loader).

## 10. Important existing components (inventory)

Core: AppShell (sidebar + mobile top bar + main + PlayerBar + NowPlaying),
TrackRow (memoized, CSS-hover actions — actions are `opacity-0
group-hover:opacity-100` → **invisible/unusable on touch**), AlbumCard,
SingleMiniCard/SingleCard (vinyl hover animations), VideoThumb, Visualizer
(canvas, hidden-tab aware, reduced-motion aware), SmoothImage, EditTrack/
EditAlbum/ArtworkCrop/LyricsSearch/LrcLiveSync modals, ShareMenu.
UI kit: full shadcn set (unused: sidebar, calendar, chart, command, etc. —
do not adopt new deps; we already have vaul (drawer) + Radix available).

## 11. Existing design language / tokens

- Colors: oklch tokens in `styles.css` — dark default (bg oklch(0.16…258)),
  primary amber/gold oklch(0.76 0.14 66) ("duck gold"), accent, sidebar
  tokens; radius scale from `--radius: 0.5rem`.
- Fonts: `--font-display: "Playfair Display"` (headings), `--font-sans:
  "Sora"`.
- Utilities: `glass` (blur 20px + contain:paint), `grain` (noise overlay),
  `animate-shimmer`.
- Motion: `lib/motion.ts` tokens (springSnappy/Smooth/Gentle/Pill, easeDuck,
  tweenFast/Base/Slow, tapScale, page/list/modal variants) —
  `MotionConfig reducedMotion="user"` at root + CSS reduced-motion block.
- Perf conventions already established (2026-08-25): CSS transitions over
  JS animation for chrome (sidebar width, TrackRow hover, active nav state
  replaced layoutId), isolated time subscribers, cover crop prefetch cache,
  visualizer pause when hidden. **Mobile work must follow the same rules.**

## 12. Current responsive strategy

There is none as a *system* — desktop is the primary layout with scattered
Tailwind `sm:/md:/lg:` overrides (breakpoints 640/768/1024px). `lg` (1024)
gates sidebar vs top-bar. PlayerBar's `w-[38vw] min-w-[280px]` center
column and QueuePanel `w-[360px]` are desktop-first dimensions. No
`dvh`-aware heights, no safe-area, no `viewport-fit=cover`, no
touch-specific interaction patterns (hover reveals used as the ONLY way to
reach edit/share/delete in TrackRow and grid cards).

## 13. Current UI problems on mobile (evidence-based)

1. **Navigation**: see §4 — cramped scroll pills, tiny targets, no bottom
   nav, top-heavy.
2. **PlayerBar**: 3-col desktop grid breaks at ≤400px (min-w-[280px]
   center + 56px cover + right actions overflow); mobile users lose
   lyrics & queue buttons (hidden md:flex for some controls); seek hit
   area thin; footer doesn't respect safe areas.
3. **NowPlaying**: lyrics pane covers controls on narrow screens (flex-row
   siblings); header 3-col grid is cramped; vinyl cover sizes use vh-based
   maxes tuned for desktop (`min(34vh,270px)` fine, but paddings are
   `px-6` desktop-ish); bottom pad `h-6` ignores home-indicator.
4. **QueuePanel**: right drawer pattern is desktop-centric; HTML5 drag
   reorder unusable on touch; `bottom-[73px]` hardcoded against PlayerBar
   height (fragile once PlayerBar height changes per breakpoint).
5. **TrackRow/grid cards**: hover-reveal actions are invisible on touch →
   share/edit/delete unreachable; favorite is reachable but 28px target;
   album column hidden below md (good) but format chip remains.
6. **Lists/pages**: page headers `py-12` + `px-6` with 4xl-5xl display
   headings waste vertical space on phones; `grid-cols-2` album grids are
   acceptable at 360 but 8px gaps + big section paddings feel cramped;
   hero album `w-60` fixed artwork + py-24 hero padding is heavy on 360px.
7. **Search**: library search input is fine (type=search-able), but there
   is NO keyboard `enterkeyhint`/`inputmode` tuning, no recent-search
   concept, results are a single flat list (fine for scale), no
   loading/empty-differentiation beyond "Không tìm thấy bài nào."
8. **Modals**: all center-screen fixed dialogs with `p-4` outer padding —
   usable at 360 but bottom-sheet pattern is more natural on phones;
   `alert()` confirmations (playlist create/rename/delete errors, guest
   share copy) are hostile on mobile.
9. **Upload/Review Center**: dense desktop two-column; works stacked but
   bulk-edit inputs `h-8`, checkboxes `size-4` (below 44px target);
   destructive "Loại bỏ mục đã chọn" sits next to "Áp dụng" without
   separation; LRC studio modals are desktop-first.
10. **No safe-area / dvh handling** anywhere; `min-h-screen` used while
    mobile browser chrome overlaps.
11. **Visualizer** renders on mobile NowPlaying (36 bars) — acceptable but
    should stay; it already respects reduced-motion/hidden tabs.
12. **No loading skeletons** for library hydration (library sync happens
    in background after paint; lists pop in).

## 14. Technical constraints

- Stack: React 19 + TanStack Start (SSR, file routes) + Tailwind v4
  (`@theme inline`, no tailwind.config) + motion (framer) + vaul/Radix +
  Vitest. Node 24, npm 11.
- Gates: `npx tsc --noEmit` 0 errors · `eslint` 0 errors (19 pre-existing
  warnings) · **297/297 tests (25 files)** · build (Vite+Nitro/Vercel) ·
  `scan:secrets` CLEAN. Any UI change must keep all green; add tests for
  new logic.
- Client-boundary guard (AD-13/14): no `node:` imports in client-reachable
  lib/services; routes never import `*.server.ts`. New mobile code must
  not add server deps.
- SSR: routes render server-side; `useSyncExternalStore` getServerSnapshot
  patterns; `window`/`localStorage` only in effects/guards. Mobile
  components must stay SSR-safe (no `typeof window` at render top-level
  without guard).
- External gates still blocked (live Supabase apply, rotation, live S3) —
  out of scope; localhost testing only with existing `.env` (Supabase +
  Pikamc S3 keys present).
- Do NOT touch: player engine semantics, queue decisions, BroadcastChannel
  protocol, persistence triggers, member-data RPCs, migrations, auth,
  canonical data model, ingestion commit logic. UI-only + shell-level
  changes, plus safe-area/viewport plumbing.

## 15. Components that MUST be preserved (behavior)

- `PlayerProvider` contract: context shape (queue/index/current/actions/
  expanded/lyricsOpen/queueOpen/tabRole/replayGainMode/cycleReplayGain/
  resumeHint…) — consumed everywhere; extend, never rename.
- `usePlayerTime` isolation (perf), engine store, `player-queue` decisions.
- TrackRow memo + play/favorite/share/auth-gate behaviors; PlaylistPicker;
  optimistic favorite/playlist flows with rollback (useMemberLibrary).
- Upload store + Review Center semantics (approve/retry/cancel/bulk/
  duplicate decisions); floating upload banner.
- Share flows (share-client, ShareMenu, /s/$token fail-closed).
- LyricsPane behaviors (auto-scroll, tap-seek, offset display-only).
- MotionConfig reducedMotion="user" + CSS reduced-motion block.
- MediaSession, hotkeys, continue-listening pill.

## 16. Components that MAY be redesigned (UI layer only)

- AppShell mobile navigation (replace pill bar with bottom nav + top
  header; desktop sidebar unchanged).
- PlayerBar mobile layout (mini-player pattern: cover+titles+play+next,
  thin seek strip; desktop grid unchanged ≥md).
- NowPlaying mobile composition (stacked column, lyrics as full-bleed
  toggle instead of side overlay; gesture: swipe down to minimize —
  with visible close button as fallback).
- QueuePanel on mobile → bottom sheet (keep right drawer on ≥md; reuse
  same queue store API; add touch-friendly up/down reorder buttons
  consistent with AD-11 playlist reorder choice).
- TrackRow action visibility on touch (always-visible compact actions or
  tap-to-reveal sheet; keep desktop hover reveal).
- Upload Review Center stacking/spacing/targets on mobile (no logic
  changes).
- Modals → may add bottom-sheet presentation on mobile for new/edited
  surfaces only where cheap; keep existing modals' logic.

## 17. Features that must NOT be broken (acceptance subset)

All 12 mandatory flows (play/pause/resume; search→play→back;
queue reorder; lyrics sync/seek; favorite persistence; playlist
create/add/reorder/persist; preferences volume/crossfade/RG persistence;
share valid/invalid; ingestion upload→review→approve; orientation
portrait/landscape; background tab return; multi-tab authority) plus:
desktop regression at 1280/1440/1920, all five gates green, no client
boundary violations, reduced-motion respected.

---

## Verdict

Duckroom's mobile experience today is a **desktop layout squeezed**, not a
mobile product: desktop-first player bar, right-drawer queue, hover-gated
actions, top-scroll pill nav, no safe areas, no touch reorder. The
architecture underneath (engine store, pure queue, external stores,
optimistic member flows, ingestion pipeline) is solid and fully reusable —
the mobile overhaul is a **presentation-layer + shell** project, not a
rebuild. The plan in `MOBILE_UI_ARCHITECTURE.md` is written accordingly.
