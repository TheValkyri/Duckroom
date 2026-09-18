-- ============================================================================
-- DUCKROOM — APPLY LATEST HARDENING MIGRATIONS (2026-09-11 to 2026-09-17)
-- Bao gồm:
--   1. 20260911: Enable RLS trên core tables (tracks/albums/videos) + RLS policies
--   2. 20260916: Waveform peaks column trên track_files (Phase 2)
--   3. 20260917: Database-driven album display priority trên albums (Phase 3)
--
-- 100% IDEMPOTENT: An toàn khi chạy nhiều lần (tự no-op nếu đã tồn tại).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY TRÊN TRACKS / ALBUMS / VIDEOS
-- ----------------------------------------------------------------------------
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. RLS POLICIES CHO ALBUMS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can read active public albums" ON public.albums;
CREATE POLICY "Public can read active public albums" ON public.albums
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage albums" ON public.albums;
CREATE POLICY "Owners can manage albums" ON public.albums
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- ----------------------------------------------------------------------------
-- 3. RLS POLICIES CHO TRACKS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can read active public tracks" ON public.tracks;
CREATE POLICY "Public can read active public tracks" ON public.tracks
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage tracks" ON public.tracks;
CREATE POLICY "Owners can manage tracks" ON public.tracks
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- ----------------------------------------------------------------------------
-- 4. RLS POLICIES CHO VIDEOS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can read active public videos" ON public.videos;
CREATE POLICY "Public can read active public videos" ON public.videos
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage videos" ON public.videos;
CREATE POLICY "Owners can manage videos" ON public.videos
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- ----------------------------------------------------------------------------
-- 5. WAVEFORM PEAKS TRÊN TRACK_FILES (PHASE 2 MEDIA PERFORMANCE)
-- ----------------------------------------------------------------------------
ALTER TABLE public.track_files
  ADD COLUMN IF NOT EXISTS waveform_peaks SMALLINT[];

COMMENT ON COLUMN public.track_files.waveform_peaks IS 'Precomputed 128-point waveform peaks (0-255) for instant seekbar waveform rendering; NULL = not precomputed.';

-- ----------------------------------------------------------------------------
-- 6. ALBUM DISPLAY PRIORITY (PHASE 3 ARCHITECTURE SUSTAINABILITY)
-- ----------------------------------------------------------------------------
ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS display_priority INTEGER NOT NULL DEFAULT 999;

CREATE INDEX IF NOT EXISTS idx_albums_display_priority_year
  ON public.albums (display_priority ASC, year DESC);

-- Update seed priorities for initial core albums:
-- 1. HVL (MCK)
UPDATE public.albums
SET display_priority = 1
WHERE lower(trim(title)) = 'hvl'
   OR lower(trim(title)) LIKE '%hvl%'
   OR lower(id) LIKE '%hvl%';

-- 2. Đánh Đổi (Obito)
UPDATE public.albums
SET display_priority = 2
WHERE lower(trim(title)) = 'đánh đổi'
   OR lower(trim(title)) = 'danh doi'
   OR lower(trim(title)) LIKE '%đánh đổi%'
   OR lower(trim(title)) LIKE '%danh doi%'
   OR lower(id) LIKE '%danh-doi%';

-- 3. Bảy (HAZEL)
UPDATE public.albums
SET display_priority = 3
WHERE lower(trim(title)) = 'bảy'
   OR lower(trim(title)) = 'bay'
   OR lower(trim(title)) LIKE '%bảy%'
   OR lower(trim(title)) LIKE '%bay%'
   OR lower(id) LIKE '%bay%';

-- 4. Trái Tim Băng Bó (Dangrangto)
UPDATE public.albums
SET display_priority = 4
WHERE lower(trim(title)) LIKE '%trái tim%'
   OR lower(trim(title)) LIKE '%trai tim%'
   OR lower(trim(title)) LIKE '%băng b%'
   OR lower(trim(title)) LIKE '%bang b%'
   OR lower(id) LIKE '%trai-tim%';
