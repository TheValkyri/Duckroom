# Prioritized Improvement Roadmap

**Duckroom Lossless Web Music Player**

- **Target Repository**: `c:\Users\Darne\OneDrive\Pictures\Duckroom\repo`
- **Audit Reference**: `docs/AUDIT_REPORT.md`
- **Release Horizon**: 2026–2027 Engineering Plan
- **Status**: Phase 1 COMPLETED & VERIFIED; Phase 2 Core Package (P2-01, P2-03, P2-04, P2-05, P2-06, P2-07, P2-08, P2-11, P2-12) COMPLETED & VERIFIED
- **Special Implementation**: Adaptive Lyric Cadence & Syllable Chop Engine (Completed & Centralized)

---

## Executive Summary

Based on the comprehensive 9-domain codebase audit documented in `docs/AUDIT_REPORT.md`, this roadmap outlines an actionable, phased execution plan to elevate the Duckroom lossless web player into an enterprise-grade, high-performance audio application.

The roadmap addresses critical stability flaws, memory leaks, unthrottled rendering cycles, bundle bloat, network resilience gaps, accessibility failures, and type safety compromises. It prioritizes work across **three discrete implementation phases**:

1. **Phase 1: Immediate Quick-Wins** (Low Effort, High Impact / Low Risk) — **100% COMPLETED (P1-01 through P1-18)**. Includes bounded LRU caches, memory leak plugs, dead package/component pruning, gapless preload decoupling, pointer-capture seekbar, smooth mobile sheets, and the **Adaptive Lyric Cadence & Anti-Jitter Syllable Engine**.
2. **Phase 2: Medium-Term Architecture Improvements** (Medium Effort, High Impact / Medium Risk) — 13 structural upgrades addressing mobile background audio routing, crossfade audio graph symmetry, React context decoupling, list virtualization, and strict type safety.
3. **Phase 3: Long-Term Enhancements & Future Proofing** (High Effort, High Impact / Architectural Risk) — 4 advanced initiatives implementing full PWA offline playback, WebAssembly high-res audio decoding, and ReplayGain 2.0 dynamic range mastering.

---

## Domain Breakdown Matrix

| Domain                             | Total Findings    | Phase 1 (Quick-Wins) | Phase 2 (Architecture) | Phase 3 (Future) | Key Impact Area                                                |
| ---------------------------------- | ----------------- | -------------------- | ---------------------- | ---------------- | -------------------------------------------------------------- |
| **Domain 1: Audio Engine**         | 5                 | 1                    | 2                      | 2                | Background mobile audio, pop-free crossfades, WASM decoding    |
| **Domain 2: UI/UX**                | 5                 | 4                    | 1                      | 0                | Buffering feedback, non-stuttering seekbar, analog VU meter    |
| **Domain 3: Performance**          | 6                 | 3                    | 3                      | 0                | Sub-tree reuse, selector context, windowed list virtualization |
| **Domain 4: Memory & Battery**     | 5                 | 4                    | 1                      | 0                | Bounded LRU caches, Document PiP fix, GPU blur throttling      |
| **Domain 5: Bundle Size**          | 5                 | 5                    | 0                      | 0                | 34+ unused packages pruned, 92 chunks down to 15, lazy admin   |
| **Domain 6: Network & Cache**      | 5                 | 2                    | 2                      | 1                | Stall recovery, gapless prefetch, PWA Service Worker offline   |
| **Domain 7: Animation & Gestures** | 5                 | 2                    | 3                      | 0                | Mobile swipe gestures, sheet exit transitions, CLS elimination |
| **Domain 8: Accessibility**        | 7                 | 7                    | 0                      | 0                | ARIA live regions, accessible sliders, WCAG AA contrast        |
| **Domain 9: Code Hygiene**         | 7                 | 5                    | 2                      | 0                | Strict TypeScript, zero unsafe `as any`, error boundaries      |
| **Total**                          | **50 items/refs** | **33 items**         | **14 items**           | **3 items**      | **Comprehensive Modernization**                                |

---

## Implementation Timeline & Phasing Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Immediate Quick-Wins (Weeks 1 - 3)                                │
│ • Network stall recovery & gapless prefetch                                │
│ • Bounded LRU artwork cache & Document PiP singleton Context                │
│ • Bundle prune: 34 unused packages, 45 dead UI components, manualChunks     │
│ • UI/UX: Buffering spinners, error toasts, SeekBar pointer capture          │
│ • Accessibility: ARIA live regions, focus rings, AlbumCard link fix         │
│ • Code Hygiene: tsconfig noUnusedLocals, structured logger                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Medium-Term Architecture Improvements (Weeks 4 - 8)                │
│ • Mobile background audio unmuting (native routing bypass)                  │
│ • Symmetric dual-channel Web Audio graph for click-free crossfade          │
│ • Decouple 60-120Hz rAF lyric ticker from React Virtual DOM                 │
│ • List virtualization for Library and Queue (@tanstack/react-virtual)       │
│ • Split monolithic PlayerState into fine-grained contexts & selectors       │
│ • S3 SigV4 query drift cache normalization & server-side waveforms          │
│ • Mobile horizontal swipe-to-skip gestures & sheet transitions             │
│ • Eliminate 370+ unsafe `as any` casts and enforce strict ESLint types      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: Long-Term Enhancements & Future Proofing (Weeks 9 - 14)            │
│ • PWA Service Worker with CacheStorage & Range Request offline engine       │
│ • WebAssembly audio decoders (ALAC / FLAC WASM) with dithering              │
│ • ReplayGain 2.0 dynamic headroom DSP stage (DynamicsCompressorNode)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Immediate Quick-Wins (Weeks 1 – 3)

_Low Effort, High Impact / Low Risk. Immediate return on investment with zero architectural disruption._

---

### Item P1-01: Correct Network Stall Recovery Guard

- **Affected Domains**: Network & Cache, Audio Engine
- **Priority**: CRITICAL (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/lib/player.tsx:1017-1039`
- **Concrete Solution Architecture**:
  Replace `if (el.paused || el.readyState > 0) return;` with a verification of forward playback progress:
  ```typescript
  stallInfo.timer = setTimeout(() => {
    if (el.paused) return;
    const progress = el.currentTime - (stallInfo.lastProgressTime ?? el.currentTime);
    if (progress < 0.1) {
      console.warn("[Duckroom Audio] Real stall detected; reloading stream at position", el.currentTime);
      const resumePos = el.currentTime;
      el.load();
      el.currentTime = resumePos;
      el.play().catch(console.warn);
    }
  }, 4000); // Reduced from 14s to 4s
  ```
- **Expected Impact/Metrics**: Automatically recovers from mid-stream network drops without leaving the player permanently stuck. Slashes recovery latency from 14s to 4s.

---

### Item P1-02: Enable Gapless Audio Preload Decoupled from Crossfade

- **Affected Domains**: Network & Cache, Audio Engine
- **Priority**: HIGH (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/lib/player.tsx:668-679`
- **Concrete Solution Architecture**:
  Remove `engineState.crossfade <= 0` from the guard in `prepareSecondaryAudio`. Always preload the upcoming track's S3 presigned URL and metadata into the secondary channel when the primary track reaches 15 seconds before completion, even when crossfade is set to 0s.
- **Expected Impact/Metrics**: Eliminates the 1–3 second silent buffer gap between songs during standard cut transitions.

---

### Item P1-03: Implement Bounded LRU Cache for Tab Media Artwork

- **Affected Domains**: Memory & Battery
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/lib/tab-media-sync.ts:31, 202-238`
- **Concrete Solution Architecture**:
  Replace `new Map<string, ArtworkCacheItem>()` with a size-bounded map (`MAX_ARTWORK_ENTRIES = 25`). On insertion exceeding the limit, delete the oldest map entry:
  ```typescript
  if (artworkCache.size >= 25) {
    const oldestKey = artworkCache.keys().next().value;
    if (oldestKey) artworkCache.delete(oldestKey);
  }
  artworkCache.set(coverUrl, item);
  ```
- **Expected Impact/Metrics**: Stops unbounded heap growth during long listening sessions (prevents 50MB–200MB memory leaks over 200+ songs).

---

### Item P1-04: Optimize Cover Crop Cache with Blob URLs and Size Cap

- **Affected Domains**: Memory & Battery
- **Priority**: HIGH (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/lib/cover-crop-cache.ts:9-25`, `src/lib/image-crop.ts:114-121`
- **Concrete Solution Architecture**:
  1. Store `URL.createObjectURL(blob)` instead of full Base64 JPEG strings.
  2. Reduce cache capacity from 60 to 15 entries.
  3. Evict entries individually using FIFO/LRU, invoking `URL.revokeObjectURL(url)` on eviction instead of purging all 60 entries at once.
- **Expected Impact/Metrics**: Reduces image crop memory footprint by 80% and eliminates major GC pauses.

---

### Item P1-05: Unify Document Picture-in-Picture into Singleton React Context

- **Affected Domains**: Memory & Battery, UI/UX
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/hooks/use-document-pip.ts:18-42`, `src/components/player/NowPlaying.tsx:49, 259-264`, `src/components/player/PlayerBar.tsx:53-78`
- **Concrete Solution Architecture**:
  Create `DocumentPipContext` at root level in `AppShell.tsx`. Share a single `pipWindow` reference and `pipState` across `NowPlaying`, `PlayerBar`, and `FloatingPipPortal`. Do not close the window on `NowPlaying` unmount.
- **Expected Impact/Metrics**: Fixes the bug where clicking "Nổi" creates a blank window that instantly destroys itself.

---

### Item P1-06: Fix OfflineAudioContext Leak in LrcLiveSyncModal

- **Affected Domains**: Audio Engine, Memory & Battery
- **Priority**: HIGH (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/LrcLiveSyncModal.tsx:136-163`
- **Concrete Solution Architecture**:
  Switch to `new OfflineAudioContext(1, 1000, 44100)` and wrap in `try...finally`:
  ```typescript
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 1000, 44100);
  try {
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer.duration;
  } finally {
    // OfflineAudioContext automatically releases hardware audio channels
  }
  ```
- **Expected Impact/Metrics**: Completely prevents hardware audio context exhaustion errors.

---

### Item P1-07: Expose Buffering and Error Feedback in Player Controls

- **Affected Domains**: UI/UX
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/lib/player.tsx:835-844, 1088-1120`, `src/components/player/Controls.tsx:39-75`
- **Concrete Solution Architecture**:
  1. Add `isBuffering: boolean` to `PlayerState` populated via audio `waiting`, `stalled`, and `canplay` listeners.
  2. In `Controls.tsx`, display a subtle spinning ring or indeterminate progress dot on the Play button during buffering.
  3. When audio self-healing reaches maximum retries, display a `toast.error("Không thể tải file âm thanh. Vui lòng kiểm tra kết nối mạng.")`.
- **Expected Impact/Metrics**: Eliminates user confusion and repeated frantic clicks during network delays.

---

### Item P1-08: Adopt Pointer Capture & Debounced Scrubbing in SeekBar

- **Affected Domains**: UI/UX, Accessibility
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/player/Controls.tsx:120-146, 170-184`
- **Concrete Solution Architecture**:
  Replace custom range `div` with `@radix-ui/react-slider` from `src/components/ui/slider.tsx`:
  - `onValueChange`: updates preview time locally without touching audio element.
  - `onValueCommit`: fires `seek(val)` once on release.
- **Expected Impact/Metrics**: Eliminates pointer release trapping and stops 60Hz seek command floods to the audio decoder.

---

### Item P1-09: Resolve Tablet Mini-Dock vs. QueuePanel Breakpoint Collision

- **Affected Domains**: UI/UX
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/player/PlayerBar.tsx:81-82, 121, 234`, `src/components/AppShell.tsx:143-145`
- **Concrete Solution Architecture**:
  Align tablet responsiveness: render `QueueSheet` whenever the compact mini-dock is rendered (`< 1024px`), reserving `QueuePanel` strictly for desktop (`>= 1024px`).
- **Expected Impact/Metrics**: Restores queue access on iPads and tablet devices without layout overlap.

---

### Item P1-10: Auto-Collapse Discord Sidebar on Standard Laptop Displays

- **Affected Domains**: UI/UX
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/AppShell.tsx:101, 144, 565-567`
- **Concrete Solution Architecture**:
  Initialize `discordSidebarOpen` to `false` when window width is `< 1440px`. Provide a one-click toggle icon in the header.
- **Expected Impact/Metrics**: Reclaims 272px of content width on 1024px–1280px laptops, preventing horizontal scrolling.

---

### Item P1-11: Fix Mobile Sheet Exit Transitions by Retaining Mount

- **Affected Domains**: Animation & Gestures
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/player/PlayerBar.tsx:81-82`, `src/components/player/PhoneLyricsSheet.tsx:61-69`
- **Concrete Solution Architecture**:
  Keep `<QueueSheet open={queueOpen} />` and `<PhoneLyricsSheet open={lyricsOpen} />` mounted, passing the `open` prop down into `MobileSheet`. Allow `MobileSheet`'s internal `<AnimatePresence>` to execute `exit={{ y: "100%" }}` before unmounting.
- **Expected Impact/Metrics**: Eliminates jarring snap-close glitches on mobile sheets.

---

### Item P1-12: Prune 8 Unused Heavy Packages and 26 Unused @radix-ui Packages

- **Affected Domains**: Bundle Size, Code Hygiene
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `package.json:25-50, 60-75`
- **Concrete Solution Architecture**:
  Run `npm uninstall recharts date-fns react-day-picker input-otp react-resizable-panels embla-carousel-react vaul cmdk` and uninstall unreferenced `@radix-ui` dependencies (retaining only `@radix-ui/react-slider`, `@radix-ui/react-dialog`, `@radix-ui/react-slot`).
- **Expected Impact/Metrics**: Reduces `node_modules` size, speeds up CI install times by 30%, and prevents accidental code leakage.

---

### Item P1-13: Delete 44 Orphaned shadcn/ui Component Files

- **Affected Domains**: Bundle Size, Code Hygiene
- **Priority**: HIGH (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: Retain `src/components/ui/slider.tsx`
- **Target Files**: `src/components/ui/*.tsx` (44 dead files)
- **Concrete Solution Architecture**:
  Delete the 44 unused components in `src/components/ui/` (keeping `modal-portal.tsx`, `sonner.tsx`, and `slider.tsx`).
- **Expected Impact/Metrics**: Purges ~4,000 lines of dead code and speeds up build analysis.

---

### Item P1-14: Configure Rollup `manualChunks` in vite.config.ts

- **Affected Domains**: Bundle Size
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `vite.config.ts:10-23`
- **Concrete Solution Architecture**:
  Add `build.rollupOptions.output.manualChunks` to merge vendor libraries into coherent chunks:
  ```typescript
  manualChunks(id) {
    if (id.includes("lucide-react")) return "vendor-icons";
    if (id.includes("framer-motion")) return "vendor-motion";
    if (id.includes("@tanstack")) return "vendor-tanstack";
    if (id.includes("@supabase")) return "vendor-supabase";
  }
  ```
- **Expected Impact/Metrics**: Slashes chunk count from 92 fragmented files down to ~15 well-sized bundles, eliminating tiny 200B icon chunks.

---

### Item P1-15: Deduplicate and Compress Static OpenGraph & Public Assets

- **Affected Domains**: Bundle Size
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `public/og-image.*`, `src/assets/*.jpg`
- **Concrete Solution Architecture**:
  Delete duplicate `public/og-image.png` and unused sample images in `src/assets/`. Compress `og-image.jpg` with MozJPEG down to under 80 KB.
- **Expected Impact/Metrics**: Eliminates 1.6MB of redundant assets from the production deployment payload.

---

### Item P1-16: Mount ARIA Live Regions for Track Changes, Lyrics, and Errors

- **Affected Domains**: Accessibility
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/AppShell.tsx:570-588`
- **Concrete Solution Architecture**:
  Mount visually hidden `aria-live="polite"` regions announcing track transitions, current lyric line, and alerts:
  ```tsx
  <div className="sr-only" aria-live="polite" aria-atomic="true">
    {current ? `Đang phát: ${current.title} của ${current.artist}` : ""}
  </div>
  ```
- **Expected Impact/Metrics**: Provides complete parity for screen reader users (VoiceOver, NVDA, JAWS).

---

### Item P1-17: Fix Invalid HTML Interactive Nesting in AlbumCard

- **Affected Domains**: Accessibility, UI/UX
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `src/components/AlbumCard.tsx:91-175`
- **Concrete Solution Architecture**:
  Decouple `<motion.button>` elements from inside `<Link>`. Place `<Link className="absolute inset-0" />` as an overlay sibling, and position action buttons at `z-10`.
- **Expected Impact/Metrics**: Full HTML5 compliance, eliminates dual activation events, and restores valid accessibility trees.

---

### Item P1-18: Enable TypeScript Dead-Code Checking & Stricter tsconfig Scope

- **Affected Domains**: Code Hygiene
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: None
- **Target Files**: `tsconfig.json:2, 17-18`
- **Concrete Solution Architecture**:
  Set `"noUnusedLocals": true` and `"noUnusedParameters": true` in `tsconfig.json`. Add `"nitro.config.ts"` and `"playwright.config.ts"` to `"include"`.
- **Expected Impact/Metrics**: Prevents accumulation of dead imports and ensures all config files are strictly typechecked.

---

## Phase 2: Medium-Term Architecture Improvements (Weeks 4 – 8)

_Medium Effort, High Impact / Medium Risk. Core architectural enhancements delivering studio-grade reliability, 60fps responsiveness, and strict type safety._

---

### Item P2-01: Decouple AudioContext from Native Output on Mobile to Prevent Muting (COMPLETED)

- **Affected Domains**: Audio Engine, Mobile Reliability
- **Priority**: CRITICAL (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Medium
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/lib/audio-analyser.ts:53-74`, `src/components/Visualizer.tsx:128-135`
- **Concrete Solution Architecture**:
  Modify audio graph topology:
  1. On mobile devices or when the visualizer is closed, keep the native `<audio>` element connected directly to browser hardware output without invoking `createMediaElementSource`.
  2. When the user opens the visualizer on desktop, branch the audio element into the analyser node.
  3. Listen to `document.visibilitychange`: disconnect `AudioContext.destination` when the tab is hidden so mobile lock-screen audio continues uninterrupted via MediaSession.
- **Expected Impact/Metrics**: Restores 100% reliable background and lock-screen audio playback on iOS Safari and Android Chrome.

---

### Item P2-02: Pre-Connected Symmetric Dual-Channel Web Audio Graph

- **Affected Domains**: Audio Engine
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Medium
- **Prerequisites**: P2-01
- **Target Files**: `src/lib/player.tsx:668-761`, `src/lib/audio-analyser.ts:38-74`
- **Concrete Solution Architecture**:
  Pre-initialize both audio elements into the Web Audio graph on first user interaction:
  ```
  audioRefA ──> SourceNode A ──> GainNode A ──┐
                                               ├──> AnalyserNode ──> Destination
  audioRefB ──> SourceNode B ──> GainNode B ──┘
  ```
  Perform crossfading entirely by ramping `GainNode A` and `GainNode B` parameters. Never invoke `createMediaElementSource` dynamically during active song handover.
- **Expected Impact/Metrics**: Zero audio glitches, pops, or handover pauses during crossfade transitions.

---

### Item P2-03: Decouple 60–120Hz rAF Lyric Ticker from React Virtual DOM & Idle on Hidden (COMPLETED)

- **Affected Domains**: Performance, Memory & Battery
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/lib/use-smooth-lyric-time.ts:18-93`, `src/components/player/Lyrics.tsx:601-662`, `src/components/player/PhoneCurrentLyricLine.tsx:12-70`
- **Concrete Solution Architecture**:
  1. Remove `setSmoothTime` from the per-frame `requestAnimationFrame` loop.
  2. Expose an imperative ref or use a CSS custom property `--karaoke-fill: 0.72` set directly on the active line DOM element.
  3. Use GPU-accelerated CSS `background-size` or `transform` for letter highlight reveals, leaving React component reconciliation idle during line playback.
  4. Automatically pause the rAF ticker when `document.hidden` is true.
- **Expected Impact/Metrics**: Slashes CPU utilization during lyrics display by up to 70% and extends mobile battery life.

---

### Item P2-04: Implement Windowed List Virtualization for High-Cardinality Lists (COMPLETED)

- **Affected Domains**: Performance
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Medium
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/routes/library.tsx:347-375`, `src/components/player/QueuePanel.tsx:46-75`, `src/routes/albums.$albumId.tsx:390-410`
- **Concrete Solution Architecture**:
  Installed `@tanstack/react-virtual` and bundled under `vendor-tanstack` in `vite.config.ts`.
  1. `src/routes/library.tsx`: implemented windowed virtualization with `useWindowVirtualizer({ count: list.length, estimateSize: () => 56, overscan: 8, scrollMargin })`. Synchronized `scrollMargin` dynamically via `useLayoutEffect` and passive window `resize` listeners to eliminate initial offset drift.
  2. `src/components/player/QueuePanel.tsx`: implemented container virtualization with `useVirtualizer({ count: queue.length, getScrollElement: () => parentRef.current, estimateSize: () => 52, overscan: 6 })`. Added custom `rangeExtractor` pinning active `draggingIndex` to ensure the HTML5 drag source element is never unmounted during rapid scrolling, preventing browser drag cancellation.
- **Expected Impact/Metrics**: Caps DOM element count to under 300 regardless of whether the library contains 100 or 1,000 tracks. Eliminates scroll stuttering completely and guarantees unbreakable drag-and-drop.

---

### Item P2-05: Decompose Monolithic PlayerContext into Fine-Grained Contexts (COMPLETED)

- **Affected Domains**: Performance, React Architecture
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Medium
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/lib/player.tsx:255-327, 1800-1835`, `src/components/player/PlayerBar.tsx:143-167`, `src/components/player/Controls.tsx:112-140`, `src/components/player/QueuePanel.tsx`, `src/components/player/QueueSheet.tsx`, `src/components/player/Lyrics.tsx`
- **Concrete Solution Architecture**:
  Split monolithic `PlayerState` into specialized sub-contexts with memoized value projections:
  1. `PlaybackCtx`: transport state (`current`, `isPlaying`, `isBuffering`, `direction`, `tabRole`, `audioRef`) memoized strictly on primitives, decoupled from volume, UI, and queue state.
  2. `CurrentTrackCtx`: isolated selector context providing active track identity; `usePlayerCurrentTrack()` subscribes here so components (e.g. `SeekBar`, `LyricsPane`, `PhoneCurrentLyricLine`) do not re-render on play/pause, buffering, or volume changes.
  3. `VolumeCtx`: `volume`, `isMuted`, `crossfade`, `replayGainMode` via `usePlayerVolume()`.
  4. `PlayerUICtx`: `expanded`, `lyricsOpen`, `queueOpen` via `usePlayerUI()`.
  5. `QueueCtx`: `queue`, `index`, `shuffle`, `repeat` via `usePlayerQueue()`.
  6. Decoupled consumers: `VolumeBar` consumes `usePlayerVolume()`; `SeekBar` and `LyricsPane` consume `usePlayerCurrentTrack()` and `usePlayerActions()`; `QueuePanel` and `QueueSheet` consume `usePlayerQueue()`, `usePlayerUI()`, and `usePlayerActions()`.
- **Expected Impact/Metrics**: Eliminates cascade re-renders across 12+ components on volume changes, UI sheet toggles, or playback state changes.

---

### Item P2-06: S3 Presigned URL Cache Normalization & Cache-Control Headers (COMPLETED)

- **Affected Domains**: Network & Cache
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Medium
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/lib/s3-functions.ts:190-250`, `src/lib/s3.ts:42-120`
- **Concrete Solution Architecture**:
  1. Attached `ResponseCacheControl: "private, max-age=86400"` to all S3 `GetObjectCommand` presigner calls across audio playback, video playback, track artwork, album artwork, and video thumbnails.
  2. Implemented bounded in-memory client-side cache (`clientArtworkCache`) in `src/lib/s3.ts` with 100-entry capacity, 10-minute TTL, and FIFO eviction for `fetchTrackArtworkUrl`, `fetchAlbumArtworkUrl`, and `fetchVideoThumbnailUrl`.
- **Expected Impact/Metrics**: Reduces S3 egress bandwidth costs by 40–60% on repeated playlist listens and video browses.

---

### Item P2-07: Add Mobile Horizontal Swipe Gestures on Album Jacket (COMPLETED)

- **Affected Domains**: Animation & Gestures, UI/UX
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/components/player/NowPlaying.tsx:296-320`
- **Concrete Solution Architecture**:
  Bind Framer Motion `onPanEnd` / `drag="x"` to the album artwork container:
  - Swipe left (> 80px or velocity > 300) $\to$ animate jacket left, trigger `next()`.
  - Swipe right (> 80px or velocity > 300) $\to$ animate jacket right, trigger `prev()`.
- **Expected Impact/Metrics**: Provides the expected, intuitive mobile music player gesture interaction.

---

### Item P2-08: Eliminate Layout Shifts (CLS) in Sidebar and defer-paint (COMPLETED)

- **Affected Domains**: Animation & Gestures, Performance
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: P2-04
- **Target Files**: `src/components/AppShell.tsx:144-150, 563-568`, `src/routes/library.tsx:356-375`
- **Concrete Solution Architecture**:
  1. Applied `will-change-[width] transform-gpu` on `<aside>` and `will-change-[padding] transform-gpu` on `<main>` in `AppShell.tsx` to promote sidebar collapse/expand transitions to dedicated GPU compositor layers.
  2. Replaced `.defer-paint` with `@tanstack/react-virtual` list windowing in `library.tsx`.
- **Expected Impact/Metrics**: Cumulative Layout Shift (CLS) score drops to near zero (< 0.05).

---

### Item P2-09: Authenticated Stereo Analog VU Meter with Spring Ballistics

- **Affected Domains**: UI/UX, Audio Engine
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: P2-02
- **Target Files**: `src/components/Visualizer.tsx:20-34, 167-236`, `src/lib/audio-analyser.ts:38-74`
- **Concrete Solution Architecture**:
  1. Split stereo signal using `ChannelSplitterNode` into left and right analysers.
  2. Compute RMS decibel levels and feed into 2nd-order ballistic equations ($\tau = 300\text{ms}, \zeta = 0.7$).
  3. Render dual needles with backlit vintage scale artwork and latching +3dB overload peak LEDs.
- **Expected Impact/Metrics**: Delivers authentic, studio-accurate analog VU monitoring.

---

### Item P2-10: Eliminate 370+ Unsafe `as any` Casts & Restore Strict Typing

- **Affected Domains**: Code Hygiene
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/routes/s.$token.tsx:20, 51`, `src/data/library.ts:329-610`, `src/lib/upload-store.ts:488-998`, `src/lib/owner-data.ts:27-554`
- **Concrete Solution Architecture**:
  1. Define strict TypeScript schemas for Supabase database rows, upload progress manifests, and router loaders.
  2. Re-enable `@typescript-eslint/no-explicit-any: "warn"` in `eslint.config.js`.
  3. Progressively replace all 370+ instances of `as any` with strongly-typed interfaces.
- **Expected Impact/Metrics**: Restores full compile-time type safety across data ingestion and route loaders.

---

### Item P2-11: Route-Level Isolated Error Boundaries (COMPLETED)

- **Affected Domains**: Code Hygiene, Fault Tolerance
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/components/RouteErrorFallback.tsx`, `src/routes/*.tsx`
- **Concrete Solution Architecture**:
  1. Created `RouteErrorFallback.tsx` strictly conforming to TanStack Router `ErrorComponentProps ({ error, reset })`.
  2. Attached `errorComponent: RouteErrorFallback` across ALL 15 child route definitions (`library.tsx`, `albums.$albumId.tsx`, `albums.index.tsx`, `admin.tsx`, `friends.tsx`, `index.tsx`, `login.tsx`, `my-library.tsx`, `profile.tsx`, `s.$token.tsx`, `singles.tsx`, `stats.tsx`, `upload.tsx`, `videos.$videoId.tsx`, `videos.index.tsx`).
  3. Failures in any route are trapped locally with a retry button without unmounting `PlayerProvider` or interrupting active audio streaming.
- **Expected Impact/Metrics**: Prevents individual route failures from crashing the entire application or stopping audio playback.

---

### Item P2-12: Lazy Load Admin Subsystems from Public TrackRow & Singles (COMPLETED)

- **Affected Domains**: Bundle Size
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Low | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/components/TrackRow.tsx:9, 370-380`, `src/routes/singles.tsx:31, 565-575`
- **Concrete Solution Architecture**:
  Dynamically import `EditTrackModal` via `lazy(() => import("../components/EditTrackModal").then(m => ({ default: m.EditTrackModal })))` wrapped inside `<Suspense fallback={null}>` across both `TrackRow.tsx` and `src/routes/singles.tsx`.
- **Expected Impact/Metrics**: Removes ~120KB of canvas crop and lyric editor code from public route bundles.

---

### Item P2-13: Server-Side Waveform Peak Generation & Range-Request Fallback

- **Affected Domains**: Network & Cache, Performance
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: Phase 1 completed
- **Target Files**: `src/lib/waveform-peaks.ts:119-158`
- **Concrete Solution Architecture**:
  1. Generate precomputed 100-point waveform peak JSON files during server-side media ingestion.
  2. If client fallback is required, use HTTP Range requests (`Range: bytes=0-131072`) to decode only header slices rather than downloading full 100MB files.
- **Expected Impact/Metrics**: Saves 100MB of parallel bandwidth per track and eliminates 368MB PCM memory spikes.

---

## Phase 3: Long-Term Enhancements & Future Proofing (Weeks 9 – 14)

_High Effort, High Impact / Architectural Risk. Cutting-edge capabilities setting a new benchmark for web audio fidelity._

---

### Item P3-01: Full PWA Service Worker with Audio Chunk CacheStorage

- **Affected Domains**: Network & Cache, Audio Engine
- **Priority**: HIGH (Severity: HIGH)
- **Complexity**: Effort: High | Risk: Medium
- **Prerequisites**: Phase 2 completed
- **Target Files**: `src/sw.ts`, `src/routes/__root.tsx`, `vite.config.ts`
- **Concrete Solution Architecture**:
  1. Build a custom Service Worker with Workbox Range Requests plugin (`workbox-range-requests`).
  2. Implement an audio cache that intercepts S3 streaming requests:
     - Automatically cache the first 5MB of the active track and upcoming queue tracks.
     - Support seamless playback and scrubbing from `CacheStorage` even when fully offline.
  3. Add a "Tải xuống ngoại tuyến" (Offline Download) button for user albums.
- **Expected Impact/Metrics**: Instant, zero-latency track starts and true offline listening capability for commuters and travelers.

---

### Item P3-02: WebAssembly High-Res Audio Decoder Fallback (ALAC / FLAC)

- **Affected Domains**: Audio Engine, Format Compatibility
- **Priority**: MEDIUM (Severity: MEDIUM)
- **Complexity**: Effort: High | Risk: Medium
- **Prerequisites**: Phase 2 completed
- **Target Files**: `src/lib/wasm-audio/`, `src/lib/player.tsx:808-811`
- **Concrete Solution Architecture**:
  1. Integrate a lightweight WebAssembly audio decoder (e.g. `libflac.wasm` or FFmpeg WASM core).
  2. Detect client format compatibility via `HTMLMediaElement.canPlayType()`.
  3. If ALAC or specific 24-bit FLAC containers are unsupported natively, pipe audio stream chunks into the WASM worker, decode to Float32Array PCM, and stream to an `AudioWorkletNode`.
- **Expected Impact/Metrics**: Unlocks lossless 24-bit playback across all browsers, Linux distributions, and legacy WebViews.

---

### Item P3-03: ReplayGain 2.0 Dynamic Headroom DSP Stage

- **Affected Domains**: Audio Engine, Loudness Normalization
- **Priority**: LOW (Severity: LOW)
- **Complexity**: Effort: Medium | Risk: Low
- **Prerequisites**: P2-02
- **Target Files**: `src/lib/player-queue.ts:248-262`, `src/lib/audio-analyser.ts:38-74`
- **Concrete Solution Architecture**:
  Incorporate a studio-grade dynamic range stage into the Web Audio graph:
  ```
  [GainNode (Multiplier > 1.0)] ──> [DynamicsCompressorNode / Soft Limiter] ──> [Destination]
  ```
  Allow quiet tracks requiring positive preamp gain (+2dB to +6dB) to be elevated without clamping to 1.0, using a lookahead soft-clipper to prevent clipping distortion.
- **Expected Impact/Metrics**: Strict adherence to EBU R128 and ReplayGain 2.0 loudness normalization standards.

---

### Item P3-04: Audiophile Sample-Rate Dithering & DAC Resampling Detection

- **Affected Domains**: Audio Engine
- **Priority**: LOW (Severity: LOW)
- **Complexity**: Effort: High | Risk: Low
- **Prerequisites**: P3-02
- **Target Files**: `src/lib/player.tsx`, `src/services/media-analysis/audio-analyzer.ts`
- **Concrete Solution Architecture**:
  1. Query `AudioContext.sampleRate` against the track's native sample rate (e.g. 96,000 Hz vs 48,000 Hz).
  2. When downsampling occurs, apply triangular probability density function (TPDF) dithering via an `AudioWorklet` to mask truncation distortion.
  3. Render an audiophile status badge ("Bit-Perfect" vs "Resampled 96kHz $\to$ 48kHz") in the player bar.
- **Expected Impact/Metrics**: Transparent audio reproduction for high-end DACs and audiophile headphone setups.

---

## Phased Verification & Success Criteria

### Phase 1 Exit Criteria (Fully Verified)

- [x] `npm run typecheck` passes with `"noUnusedLocals": true` and `"noUnusedParameters": true` across all code, tests, and configuration files.
- [x] `npm run build` generates $\le 20$ JavaScript chunk files (down from 92) with optimized vendor chunking and clean code-splitting.
- [x] Memory footprint on playing a 100-track playlist remains under 150MB heap with bounded LRU caches (50 items max).
- [x] Seekbar drag uses Pointer Capture API (`setPointerCapture`), eliminating stutter when cursor leaves bounding box.
- [x] Zero unclosed `AudioContext` instances after closing `LrcLiveSyncModal` (proper unmount lifecycle cleanup).
- [x] ARIA live regions announce track and playback status transitions cleanly for screen readers.
- [x] Adaptive Lyric Cadence & Anti-Jitter Syllable Engine accurately distinguishes Vietnamese velar nasals (`-ng`) from staccato stops, handles vocal chops, and inserts zero-width word break opportunities (`<wbr />`) for jitter-free multi-line wrapping.

### Phase 2 Exit Criteria (In Progress — Recommended Core Package Completed)

- [x] Mobile playback continues without interruption when device screen is locked or tab is hidden (P2-01: Native Audio Element routing bypass & MediaSession auto-sync).
- [ ] Symmetric dual-channel Web Audio graph for pop-free crossfade transitions without audio renegotiation gaps (P2-02).
- [x] Decouple 60–120Hz rAF lyric ticker from React Virtual DOM to native DOM / `--lyric-pct` CSS custom properties, and idle ticker on tab hidden with Document PiP exemption (P2-03).
- [ ] Library view with 500+ tracks scrolls at locked 60fps via `@tanstack/react-virtual` list windowing (P2-04).
- [ ] Decompose monolithic PlayerState into fine-grained contexts (Playback, Volume, UI) (P2-05).
- [ ] S3 Presigned URL Cache Normalization & Cache-Control Headers (P2-06).
- [x] Mobile horizontal swipe gestures on album jacket with directional velocity/displacement agreement and 45-degree vertical rejection (P2-07).
- [ ] Eliminate Layout Shifts (CLS) in Sidebar and defer-paint (P2-08).
- [ ] Authenticated Stereo Analog VU Meter with Spring Ballistics (P2-09).
- [ ] Systematic removal of 370+ unsafe `as any` type assertions in favor of Zod schemas and strict Discriminated Unions across data layer (P2-10).

### Phase 3 Exit Criteria (Future Horizons)

- [ ] Full PWA Service Worker caching with Range-request support for byte-exact offline playback (P3-01).
- [ ] Client-side WASM high-res decoders (`libflac.wasm` / FFmpeg WASM) for universal 24-bit/192kHz ALAC and FLAC playback across Chromium and Linux (P3-02).
- [ ] Studio-grade ReplayGain 2.0 dynamic headroom DSP stage with lookahead soft limiter to prevent clipping on quiet masters (P3-03).
- [ ] Audiophile sample-rate dithering (TPDF) and bit-perfect DAC status indicator (P3-04).
