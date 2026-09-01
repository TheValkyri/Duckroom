# MOBILE UI QA (2026-08-31)

> QA evidence for the mobile-first overhaul. Environment: `vite dev` @
> localhost:5173 (live Supabase + Pikamc S3 keys from local `.env` — 76
> real tracks, 4 albums, 1 video hydrated), Chrome 151 driven via CDP
> (dev-only driver `scripts/cdp-qa.mjs` + plans in `scripts/qa-plans/`).
> Method: DOM-geometry assertions (getBoundingClientRect + computed
> styles) + real input events where possible. Image-screenshot inspection
> was NOT possible in this environment (model cannot read images) — all
> verdicts below are grounded in measured geometry, not pixels.

## A. Gates (final, after last patch)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS 0 errors (fixed 4 pre-existing working-copy errors: TS7030×2, TS2345, TS2367 — see AD-M6) |
| `npx eslint .` | PASS 0 errors / 18 warnings (pre-existing 19 → 18; removed one via Lyrics.tsx memo fix) |
| `npm test` | PASS **310/310 across 26 files** (299 baseline + 11 new `mobile-ui-shell.test.ts`) |
| `npm run build` | PASS (Vite+Nitro, 1.22 MB gzip client) |
| `npm run scan:secrets` | CLEAN (70 client files) |

## B. SSR black-box (all routes)

`/, /library, /albums, /singles, /videos, /login, /my-library, /admin,
/upload, /s/<invalid>` → **all HTTP 200**. Invalid share token renders the
friendly "Liên kết không còn hiệu lực" page (not 500).

## C. Client module-graph check (AD-14, extended to new files)

Transformed modules contain no `node:` imports: `sharing.ts`, `TrackRow`,
`PlayerBar`, `TrackActionsSheet` (new), `MobileSheet` (new), `QueueSheet`
(new), `use-media-query` (new). `sharing.server.ts` → **403** from dev
origin. Production `dist/client/assets` bundle: **0** node:/smithy
references (grep-verified).

Known pre-existing dev-only noise: `node:http2` externalization warning in
`vite dev` (from a server-only dependency chain). It does NOT appear in
the production client bundle (verified above) and no page crashes —
tracked as P3 debt, out of mobile scope.

## D. Mandatory flow results

| # | Flow | Result | Evidence |
|---|---|---|---|
| 1 | home → play → mini → expand → pause → resume | PASS | p4/p6: play row 1/76, dock title updates; pause→"Phát"→resume; fullscreen h1 = track title; all controls present |
| 2 | search → play → back | PASS | p13 @360: enterkeyhint=search, h=42px; "MCK" filter 76→32 rows; clear button restores 76; no-result state + "Xóa bộ lọc" CTA; back from /library→/ works (p17) |
| 3 | queue → reorder → next/prev | PASS | p6: QueueSheet 76 rows; ↓ reorder 44×44 optimistic swap Elegie↔IDK visible before close; next ×6 spam → correct final track "Liệm" |
| 4 | lyrics → sync → seek → return | PASS | p9: 54 synced lines; tap line 8 → progress strip 20.1%; active-line highlight present; phone full-stage overlay + close button; desktop right-pane @844px landscape verified (p16) |
| 5 | member favorite persist | PARTIAL (env) | Guest auth-gate modal verified (p12). Member login with real creds not available in this QA env; optimistic+rollback covered by existing suite (member-data 13 tests) |
| 6 | playlist create/add/reorder/reload | PARTIAL (env) | Same reason; UI affordances verified visually at 360–430 (tabs, sticky create form 44px input); atomic reorder covered by member-reorder-preferences tests |
| 7 | preferences volume/crossfade/RG persist | PASS (covered by suite) | player-preferences-sync tests (6) + user_preferences authority untouched |
| 8 | share valid/invalid | PASS | invalid token → friendly page + CTA (B + p15); mint path covered by sharing tests (12) |
| 9 | ingestion upload→review→approve | PARTIAL (env) | Upload page UI verified (sticky approve bar, bulk targets 44px, separated destructive, duplicate block); owner login not available here; ingestion logic covered by 16 existing tests |
| 10 | orientation portrait→landscape→portrait | PASS | p14: landscape 844×390 no overflow; dock in viewport; artwork 140px un-clipped; portrait restores artwork 300px |
| 11 | background tab → return | PASS (by design) | library 15-min re-sync effect untouched; player audio continues (product requirement §PHASE5.7); no state loss observed across navigations |
| 12 | multi-tab authority | PASS (projection) | p27: Tab A sets track; Tab B (untouched) mirrors "Elegie" via BroadcastChannel STATE_SYNC. Audio start itself is browser-autoplay-gated in synthetic env (NotAllowedError observed once in dev log → engine recovered to paused, no crash) |

## E. Red-team results (all at 390×844)

- 8 rapid play clicks: dock alive, correct track, 0 console errors (p12)
- 6 rapid next: survived 5ms of dispatch; final track correct
- 10 play/pause spam: survived, dock stable
- Route nav + back: player persists across routes (mini visible after nav)
- Auth-gate dismissal ("Để sau") works
- Search no-result → clear-filter recovery works
- Keyboard focus states: hotkeys unchanged (desktop); mobile inputs use
  proper enterkeyhint/autocomplete (login: next/go)
- Long titles: all truncation paths verified by class (truncate) + live
  samples ("Wtf Bby I'm Lit" etc. render fully in rows)

## F. Safe areas & touch targets (measured)

| Surface | Requirement | Measured |
|---|---|---|
| Bottom nav tabs | ≥44px | **98×56px** each; aria-current works |
| Bottom nav dock | flush bottom + safe-area pad | fixed bottom-0 + pb-safe; main gets pb-[calc(9.75rem+safe)] |
| Mini-player dock | above nav, not overlapping | dock bottom 788 vs nav top 787 → shared 1px border edge only (strict overlap=false after fix) |
| Mini play/next | 44px | **44×44** |
| Fullscreen transport | 44px+ | play 4.5rem→64px (phone), side 48px |
| QueueSheet reorder | 44px | **44×44** |
| TrackRow more/favorite | 44px | **44×44** (fixed from 40 during QA) |
| Search input | ≥40px + enterkeyhint | 42px + search |
| `--safe-bottom` | defined | resolves `max(0px, 0px)` on no-notch dev box; real insets apply on device |
| viewport meta | viewport-fit=cover | set in __root (pinned by test) |

## G. Desktop regression (1440/1280/1920)

- Sidebar 256px, bottom nav + top bar display:none, desktop player bar
  visible (footer visibility asserted per-element).
- Mini-player footer display:none at 1440 (asserted).
- Phone-only "more" button does NOT render on desktop (asserted).
- Horizontal overflow: **none** at 1280 / 1440 / 1920 (and 360/375/390/412/430).

## H. Bugs found during QA → fixed in this run

1. **Mini-player overlapped bottom nav** — `bottom-safe` utility and
   `bottom-14` both set `bottom`; custom utility won → dock lifted wrong.
   Fixed with `bottom-[calc(3.5rem+var(--safe-bottom))]`; regression
   pinned in mobile-ui-shell.test.ts.
2. **Bottom nav lifted off screen edge** (same class collision,
   `bottom-safe`+`bottom-0`) → visible gap under nav. Fixed: nav flush
   `bottom-0` + internal `pb-safe`; test updated.
3. TrackRow more/favorite buttons 40px → 44px (measured, fixed).
4. `progress-strip` selector in an early plan was wrong (h-0\.5 escaping);
   confirmed working after correct selector (p4).
5. During bulk edit with PowerShell regex: reproduced the known B7
   UTF-8 corruption class → **reverted 6 files via git checkout and
   re-applied all patches with the edit tool**; final byte-level
   verification via Node UTF-8 decode = clean, git diff shows only
   intended changes. (PowerShell `Select-String` console output showed
   false-positive "mojibake" — verified false by Node decode.)
6. Test-file TS2532 in my own guard test (strict null) → fixed.
7. Pre-existing tsc errors (EditTrackModal/EditAlbumModal TS7030,
   admin.tsx TS2345/TS2367) — present in HEAD working copy despite
   CURRENT_VERIFICATION claiming 0; fixed minimally (behavior-identical).

## I. Not verified in this environment (honest list)

- Real audio start (browser autoplay policy blocks synthetic gestures;
  engine's NotAllowedError recovery observed — no crash, UI consistent).
- Member login/favorites/playlist persistence end-to-end with real
  credentials (no test account available; logic covered by unit suites).
- Physical notch/Dynamic Island insets (no physical device; safe-area
  CSS verified structurally + resolves to 0px in dev).
- Screenshot pixel review (model cannot read images; geometry checks used).
- On-device Safari/Firefox.
