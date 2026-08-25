-- DUCKROOM MASTER DOMAIN V2
-- Canonical domain entities required by docs/DUCKROOM_MASTER_PLAN.md §5.
-- This migration is additive and keeps legacy columns during the transition.

CREATE TABLE IF NOT EXISTS public.artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  image_asset_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS artist_id TEXT REFERENCES public.artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS album_artist_id TEXT REFERENCES public.artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_year INTEGER,
  ADD COLUMN IF NOT EXISTS release_type TEXT,
  ADD COLUMN IF NOT EXISTS disc_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS cover_asset_id UUID;

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS primary_artist_id TEXT REFERENCES public.artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS album_artist_id TEXT REFERENCES public.artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_year INTEGER,
  ADD COLUMN IF NOT EXISTS genre TEXT,
  ADD COLUMN IF NOT EXISTS composer TEXT,
  ADD COLUMN IF NOT EXISTS copyright TEXT,
  ADD COLUMN IF NOT EXISTS isrc TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS cover_asset_id UUID;

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS artist_id TEXT REFERENCES public.artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS album_id TEXT REFERENCES public.albums(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS artwork_asset_id UUID;

CREATE TABLE IF NOT EXISTS public.track_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('master', 'derivative')) DEFAULT 'master',
  storage_key TEXT NOT NULL UNIQUE,
  storage_provider TEXT NOT NULL DEFAULT 's3',
  extension TEXT,
  container TEXT,
  codec TEXT,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  bitrate INTEGER,
  duration_seconds DOUBLE PRECISION,
  file_size_bytes BIGINT,
  sha256 TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_track_files_master_unique
  ON public.track_files(track_id)
  WHERE kind = 'master';

CREATE TABLE IF NOT EXISTS public.artwork_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_storage_key TEXT NOT NULL UNIQUE,
  display_256_key TEXT,
  display_512_key TEXT,
  display_1024_key TEXT,
  display_2048_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.albums
  ADD CONSTRAINT albums_cover_asset_fk
  FOREIGN KEY (cover_asset_id) REFERENCES public.artwork_assets(id) ON DELETE SET NULL;

ALTER TABLE public.tracks
  ADD CONSTRAINT tracks_cover_asset_fk
  FOREIGN KEY (cover_asset_id) REFERENCES public.artwork_assets(id) ON DELETE SET NULL;

ALTER TABLE public.videos
  ADD CONSTRAINT videos_artwork_asset_fk
  FOREIGN KEY (artwork_asset_id) REFERENCES public.artwork_assets(id) ON DELETE SET NULL;

ALTER TABLE public.artists
  ADD CONSTRAINT artists_image_asset_fk
  FOREIGN KEY (image_asset_id) REFERENCES public.artwork_assets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.lyrics_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'legacy',
  language TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('plain', 'synced')) DEFAULT 'plain',
  content TEXT NOT NULL,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(5,4),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lyrics_documents_track ON public.lyrics_documents(track_id);

CREATE TABLE IF NOT EXISTS public.video_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  container TEXT,
  codec TEXT,
  resolution TEXT,
  fps DOUBLE PRECISION,
  bitrate INTEGER,
  duration_seconds DOUBLE PRECISION,
  file_size_bytes BIGINT,
  sha256 TEXT,
  audio_codec TEXT,
  hdr BOOLEAN,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_files_master_unique
  ON public.video_files(video_id);

ALTER TABLE public.media_analysis_records
  ADD COLUMN IF NOT EXISTS track_file_id UUID REFERENCES public.track_files(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS video_file_id UUID REFERENCES public.video_files(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_media_analysis_track_file ON public.media_analysis_records(track_file_id);
CREATE INDEX IF NOT EXISTS idx_media_analysis_video_file ON public.media_analysis_records(video_file_id);

-- Backfill deterministic artist rows from the legacy string fields.
INSERT INTO public.artists (id, name, normalized_name)
SELECT DISTINCT
  md5('artist:' || lower(trim(name))),
  trim(name),
  lower(trim(name))
FROM (
  SELECT artist AS name FROM public.albums WHERE trim(artist) <> ''
  UNION
  SELECT artist AS name FROM public.tracks WHERE trim(artist) <> ''
  UNION
  SELECT artist AS name FROM public.videos WHERE trim(artist) <> ''
) source
ON CONFLICT (normalized_name) DO NOTHING;

-- Backfill artist relations.
UPDATE public.albums a
SET artist_id = ar.id,
    album_artist_id = ar.id,
    release_year = COALESCE(a.release_year, a.year)
FROM public.artists ar
WHERE lower(trim(a.artist)) = ar.normalized_name
  AND (a.artist_id IS NULL OR a.album_artist_id IS NULL);

UPDATE public.tracks t
SET primary_artist_id = ar.id,
    album_artist_id = ar.id,
    release_year = COALESCE(t.release_year, NULL)
FROM public.artists ar
WHERE lower(trim(t.artist)) = ar.normalized_name
  AND (t.primary_artist_id IS NULL OR t.album_artist_id IS NULL);

UPDATE public.videos v
SET artist_id = ar.id
FROM public.artists ar
WHERE lower(trim(v.artist)) = ar.normalized_name
  AND v.artist_id IS NULL;

-- Backfill master files without duplicating existing canonical rows.
INSERT INTO public.track_files (
  track_id, kind, storage_key, extension, container, codec, sample_rate,
  bit_depth, duration_seconds, file_size_bytes
)
SELECT
  t.id,
  'master',
  t.storage_key,
  lower(regexp_replace(t.storage_key, '^.*\\.', '')),
  upper(t.format),
  NULL,
  CASE WHEN t.sample_rate > 1000 THEN t.sample_rate ELSE t.sample_rate * 1000 END,
  t.bit_depth,
  t.duration_seconds,
  CASE WHEN t.size_mb > 0 THEN round(t.size_mb * 1024 * 1024)::BIGINT ELSE NULL END
FROM public.tracks t
WHERE t.storage_key IS NOT NULL
  AND trim(t.storage_key) <> ''
ON CONFLICT (storage_key) DO NOTHING;

-- Backfill one master video file per video.
INSERT INTO public.video_files (
  video_id, storage_key, container, codec, resolution,
  duration_seconds, file_size_bytes
)
SELECT
  v.id,
  v.storage_key,
  lower(regexp_replace(v.storage_key, '^.*\\.', '')),
  v.codec,
  v.resolution,
  v.duration_seconds,
  CASE WHEN v.size_mb > 0 THEN round(v.size_mb * 1024 * 1024)::BIGINT ELSE NULL END
FROM public.videos v
WHERE v.storage_key IS NOT NULL
  AND trim(v.storage_key) <> ''
ON CONFLICT (storage_key) DO NOTHING;

-- Backfill artwork assets and wire legacy cover keys to canonical artwork rows.
INSERT INTO public.artwork_assets (master_storage_key, display_256_key, display_512_key, display_1024_key, display_2048_key)
SELECT DISTINCT
  cover_storage_key,
  cover_storage_key,
  cover_storage_key,
  cover_storage_key,
  cover_storage_key
FROM public.albums
WHERE cover_storage_key IS NOT NULL
  AND trim(cover_storage_key) <> ''
ON CONFLICT (master_storage_key) DO NOTHING;

INSERT INTO public.artwork_assets (master_storage_key, display_256_key, display_512_key, display_1024_key, display_2048_key)
SELECT DISTINCT
  cover_storage_key,
  cover_storage_key,
  cover_storage_key,
  cover_storage_key,
  cover_storage_key
FROM public.tracks
WHERE cover_storage_key IS NOT NULL
  AND trim(cover_storage_key) <> ''
ON CONFLICT (master_storage_key) DO NOTHING;

UPDATE public.albums a
SET cover_asset_id = aa.id
FROM public.artwork_assets aa
WHERE a.cover_asset_id IS NULL
  AND a.cover_storage_key = aa.master_storage_key;

UPDATE public.tracks t
SET cover_asset_id = aa.id
FROM public.artwork_assets aa
WHERE t.cover_asset_id IS NULL
  AND t.cover_storage_key = aa.master_storage_key;

UPDATE public.videos v
SET artwork_asset_id = aa.id
FROM public.artwork_assets aa
WHERE v.artwork_asset_id IS NULL
  AND v.thumb_storage_key = aa.master_storage_key;

-- Backfill lyric documents from existing JSONB lyric arrays.
INSERT INTO public.lyrics_documents (track_id, source, kind, content, version)
SELECT
  t.id,
  'legacy-json',
  CASE
    WHEN jsonb_typeof(t.lyrics) = 'array' AND jsonb_array_length(t.lyrics) > 0 THEN 'synced'
    ELSE 'plain'
  END,
  t.lyrics::text,
  t.version
FROM public.tracks t
WHERE t.lyrics IS NOT NULL
  AND t.lyrics <> '[]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM public.lyrics_documents ld WHERE ld.track_id = t.id
  );

-- RLS for new canonical tables.
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lyrics_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read artists" ON public.artists;
CREATE POLICY "Public can read artists" ON public.artists FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read track files" ON public.track_files;
CREATE POLICY "Public can read track files" ON public.track_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = track_files.track_id AND COALESCE(t.visibility, 'public') = 'public')
  OR public.current_duckroom_role() = 'owner'
);

DROP POLICY IF EXISTS "Public can read artwork assets" ON public.artwork_assets;
CREATE POLICY "Public can read artwork assets" ON public.artwork_assets FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read lyrics documents" ON public.lyrics_documents;
CREATE POLICY "Public can read lyrics documents" ON public.lyrics_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = lyrics_documents.track_id AND COALESCE(t.visibility, 'public') = 'public')
  OR public.current_duckroom_role() = 'owner'
);

DROP POLICY IF EXISTS "Public can read video files" ON public.video_files;
CREATE POLICY "Public can read video files" ON public.video_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.videos v WHERE v.id = video_files.video_id AND COALESCE(v.visibility, 'public') = 'public')
  OR public.current_duckroom_role() = 'owner'
);

DROP POLICY IF EXISTS "Owners manage artists" ON public.artists;
CREATE POLICY "Owners manage artists" ON public.artists FOR ALL USING (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Owners manage track files" ON public.track_files;
CREATE POLICY "Owners manage track files" ON public.track_files FOR ALL USING (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Owners manage artwork assets" ON public.artwork_assets;
CREATE POLICY "Owners manage artwork assets" ON public.artwork_assets FOR ALL USING (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Owners manage lyrics documents" ON public.lyrics_documents;
CREATE POLICY "Owners manage lyrics documents" ON public.lyrics_documents FOR ALL USING (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Owners manage video files" ON public.video_files;
CREATE POLICY "Owners manage video files" ON public.video_files FOR ALL USING (public.current_duckroom_role() = 'owner');

COMMENT ON TABLE public.artists IS 'Canonical Duckroom Master Domain V2 artist entity.';
COMMENT ON TABLE public.track_files IS 'Canonical physical file metadata for tracks; master file has kind=master.';
COMMENT ON TABLE public.artwork_assets IS 'Canonical artwork asset and derivative keys.';
COMMENT ON TABLE public.lyrics_documents IS 'Canonical lyrics document versions.';
COMMENT ON TABLE public.video_files IS 'Canonical physical file metadata for videos.';
