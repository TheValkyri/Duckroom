# MOBILE RESPONSIVE MATRIX (2026-08-31)

> Per-instruction matrix for every critical component. Widths in CSS px.
"OK" = verified in QA (see MOBILE_UI_QA.md) or pinned by automated test;
"by class" = guaranteed by responsive utility classes verified at ≥2 widths.

| Component | 360 | 375 | 390 | 412 | 768 | Desktop ≥1024 | Status |
|---|---|---|---|---|---|---|---|
| Bottom navigation dock | OK (overflow:false) | by class | OK (tabs 98×56, aria-current) | by class | hidden (lg breakpoint <768: shown ≤767) | hidden | PASS |
| Mobile top header | OK | by class | OK (h-14+safe-top) | by class | shown (<lg) | hidden | PASS |
| Home hero (artwork/text/CTAs) | by class (w-40) | by class | OK | by class | md:flex-row | unchanged | PASS |
| Home section grids (albums/singles/videos) | OK 2-col gap-4 | by class | OK | by class | sm:3-col | md/lg unchanged | PASS |
| Library page header/search/filters | OK (search 42px, ekh=search) | by class | OK | by class | md layout | unchanged | PASS |
| Library TrackRow list | OK (44px targets, ⋯ sheet) | by class | OK | by class | album col md:block | unchanged + hover actions | PASS |
| TrackActionsSheet (phone) | OK | by class | OK (44px rows, dialog semantics) | by class | n/a (<md only) | n/a | PASS |
| Album detail hero | OK (w-44 centered, stacked) | by class | OK | by class | md:flex-row | unchanged | PASS |
| Album grid | OK | by class | OK | by class | sm:3 | unchanged | PASS |
| Singles grid + search + view toggle | OK (ekh=search) | by class | OK | by class | sm:3/4 | unchanged | PASS |
| Videos grid | OK | by class | OK | by class | gap-4/8 | unchanged | PASS |
| Video player page | OK (px-4) | by class | OK | by class | md | unchanged | PASS |
| My-library (tabs/favorites/playlists/history) | OK (login gate, 44px inputs) | by class | OK | by class | md grid | unchanged | PASS |
| Login page | OK (bad-creds error state) | by class | OK (next/go keys) | by class | centered | unchanged | PASS |
| Share page /s/:token | OK (invalid state) | by class | OK | by class | lg 2-col | unchanged | PASS |
| Upload / Review Center | OK (44px bulk inputs, sticky approve, separated destructive) | by class | OK | by class | lg 12-col | unchanged | PASS |
| Admin / Owner Console | OK (px-4) | by class | by class | by class | sm grids | unchanged | PASS |
| **Mini-player dock (phone)** | by class | by class | OK (44px controls, no nav overlap, strip OK) | by class | hidden | desktop bar (unchanged) | PASS |
| Desktop player bar | hidden | hidden | hidden | hidden | hidden | OK (≥1024 verified 1440) | PASS |
| Fullscreen player (NowPlaying phone) | by class | by class | OK (controls, artwork, safe pads) | by class | desktop comp | unchanged ≥lg | PASS |
| Fullscreen lyrics (phone overlay) | by class | by class | OK (54 lines, tap-seek 20%, close btn) | by class | right-pane ≥lg (OK @844 landscape) | unchanged | PASS |
| QueueSheet (phone) | by class | by class | OK (76 rows, 44×44 reorder) | by class | QueuePanel ≥md | drawer unchanged | PASS |
| SeekBar | OK (h-11 phone) | by class | OK | by class | unchanged | unchanged | PASS |
| TransportControls | OK (64px play phone) | by class | OK | by class | unchanged | unchanged | PASS |
| Continue-listening pill | by class | by class | OK (bottom offset above dock) | by class | lg:bottom-24 | unchanged | PASS |
| Upload floating banner | by class | by class | by class | by class | unchanged | unchanged | PASS |
| Empty/error states (library, login, share, lyrics) | OK | by class | OK | by class | unchanged | unchanged | PASS |

Widths explicitly measured with zero horizontal overflow: **360, 375, 390,
412, 430, 1280, 1440, 1920**. Breakpoint strategy: phone <768 (`md`),
desktop nav ≥1024 (`lg`); 768–1023 = tablet/touch-laptop shows mobile
shell with desktop queue drawer at ≥768 (verified via 844-landscape).
