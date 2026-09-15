-- ============================================================================
-- DUCKROOM V1 LEGACY BASELINE DDL (AD-16)
-- Canonical initial tables for albums, tracks, and videos.
-- Resolves the "phantom baseline" gap for fresh database bootstraps.
-- ============================================================================

-- Core Table: albums
CREATE TABLE IF NOT EXISTS public.albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  cover_storage_key TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'oklch(0.72 0.15 62)',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core Table: tracks
CREATE TABLE IF NOT EXISTS public.tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES public.albums(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  track_no INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'UNKNOWN',
  bit_depth INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 0,
  size_mb NUMERIC NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL DEFAULT '',
  lyrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core Table: videos
CREATE TABLE IF NOT EXISTS public.videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  thumb_storage_key TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  resolution TEXT NOT NULL DEFAULT 'UNKNOWN',
  codec TEXT NOT NULL DEFAULT 'UNKNOWN',
  bitrate TEXT NOT NULL DEFAULT 'UNKNOWN',
  size_mb NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
