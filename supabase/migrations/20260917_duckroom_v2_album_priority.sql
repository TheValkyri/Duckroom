-- ============================================================================
-- Duckroom v2 Migration: Database-Driven Album Display Priority (Phase 3.1)
-- Eliminates hardcoded client & server string-matching priority heuristics.
-- ============================================================================

ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS display_priority INTEGER NOT NULL DEFAULT 999;

-- Index for ordering albums deterministically by display priority
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

-- 4. Trái Tim Băng Bổ / Trái Tim Băng Bó (Dangrangto)
UPDATE public.albums
SET display_priority = 4
WHERE lower(trim(title)) LIKE '%trái tim%'
   OR lower(trim(title)) LIKE '%trai tim%'
   OR lower(trim(title)) LIKE '%băng b%'
   OR lower(trim(title)) LIKE '%bang b%'
   OR lower(id) LIKE '%trai-tim%';
