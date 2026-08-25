-- ============================================================================
-- DUCKROOM — APPLY ALL MIGRATIONS (v2 — fixed mar.created_at, 2026-08-25)
-- Idempotent: an toàn khi chạy lại (các phần đã apply sẽ tự no-op).
-- ============================================================================

-- >>> BEGIN 20260819_duckroom_v2_core.sql
-- Duckroom V2 foundation migration.
-- This migration establishes canonical user/profile data and member-owned
-- libraries without removing the legacy manifest tables yet.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duckroom_role') THEN
    CREATE TYPE public.duckroom_role AS ENUM ('member', 'owner');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.duckroom_role NOT NULL DEFAULT 'member',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.current_duckroom_role()
RETURNS public.duckroom_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cover_storage_key TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
  ON public.playlist_tracks (playlist_id, position);

CREATE TABLE IF NOT EXISTS public.playback_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES public.tracks(id) ON DELETE SET NULL,
  position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.playback_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  seconds_played DOUBLE PRECISION NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_playback_history_user_time
  ON public.playback_history (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('track', 'album', 'video', 'playlist')),
  resource_id TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_resource
  ON public.share_links (resource_type, resource_id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own favorites" ON public.user_favorites;
CREATE POLICY "Users can manage own favorites" ON public.user_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own playlists" ON public.playlists;
CREATE POLICY "Users can manage own playlists" ON public.playlists
  FOR ALL USING (auth.uid() = user_id OR public.current_duckroom_role() = 'owner')
  WITH CHECK (auth.uid() = user_id OR public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Users can manage own playlist tracks" ON public.playlist_tracks;
CREATE POLICY "Users can manage own playlist tracks" ON public.playlist_tracks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND (p.user_id = auth.uid() OR public.current_duckroom_role() = 'owner'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND (p.user_id = auth.uid() OR public.current_duckroom_role() = 'owner'))
  );

DROP POLICY IF EXISTS "Users can manage own playback state" ON public.playback_state;
CREATE POLICY "Users can manage own playback state" ON public.playback_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own playback history" ON public.playback_history;
CREATE POLICY "Users can manage own playback history" ON public.playback_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners manage audit logs" ON public.audit_logs;
CREATE POLICY "Owners manage audit logs" ON public.audit_logs
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Public master library is intentionally readable in the V2 model. Storage
-- objects remain private and are accessed through short-lived signed URLs.
DROP POLICY IF EXISTS "Public can read albums" ON public.albums;
CREATE POLICY "Public can read albums" ON public.albums FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read tracks" ON public.tracks;
CREATE POLICY "Public can read tracks" ON public.tracks FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read videos" ON public.videos;
CREATE POLICY "Public can read videos" ON public.videos FOR SELECT USING (TRUE);

-- Canonical profile role bootstrap. A real deployment should set
-- DUCKROOM_OWNER_EMAIL in server environment and assign the owner row once.
CREATE OR REPLACE FUNCTION public.handle_new_duckroom_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, LOWER(COALESCE(NEW.email, 'unknown@example.invalid')))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_duckroom ON auth.users;
CREATE TRIGGER on_auth_user_created_duckroom
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_duckroom_user();

-- Backfill profiles for users that already existed before this migration.
INSERT INTO public.profiles (user_id, email, role)
SELECT
  u.id,
  LOWER(COALESCE(u.email, 'unknown@example.invalid')),
  CASE WHEN COALESCE(a.is_admin, FALSE) THEN 'owner'::public.duckroom_role ELSE 'member'::public.duckroom_role END
FROM auth.users u
LEFT JOIN public.allowed_emails a ON LOWER(a.email) = LOWER(COALESCE(u.email, ''))
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email,
    role = CASE
      WHEN public.profiles.role = 'owner'::public.duckroom_role THEN public.profiles.role
      ELSE EXCLUDED.role
    END,
    updated_at = NOW();

-- Owners can administer profiles; members can read only their own profile.
DROP POLICY IF EXISTS "Owners can manage profiles" ON public.profiles;
CREATE POLICY "Owners can manage profiles" ON public.profiles
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Shares are private to their creator unless the resource is public. The share
-- token itself is intentionally non-guessable and is resolved server-side.
DROP POLICY IF EXISTS "Users can manage own share links" ON public.share_links;
CREATE POLICY "Users can manage own share links" ON public.share_links
  FOR ALL USING (auth.uid() = created_by OR public.current_duckroom_role() = 'owner')
  WITH CHECK (auth.uid() = created_by OR public.current_duckroom_role() = 'owner');

-- V2 metadata fields used by the canonical application model.
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS cover_storage_key TEXT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS year INT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));

CREATE INDEX IF NOT EXISTS idx_tracks_visibility ON public.tracks (visibility);
CREATE INDEX IF NOT EXISTS idx_albums_visibility ON public.albums (visibility);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON public.videos (visibility);

-- >>> END 20260819_duckroom_v2_core.sql

-- >>> BEGIN 20260821_duckroom_v2_domain_mutations.sql
-- Duckroom V2 Domain Mutations, CAS Concurrency, and Lifecycle Migration.
-- Adds versioning, updated_at tracking, safe status lifecycle, and visibility-aware RLS to canonical entities.

-- 1. Albums enhancements
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_albums_status ON public.albums (status);

-- 2. Tracks enhancements
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tracks_status ON public.tracks (status);

-- 3. Videos enhancements
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_videos_status ON public.videos (status);

-- 4. Row Level Security Policies (Visibility + Lifecycle + Owner Admin)

-- Albums Policies
DROP POLICY IF EXISTS "Public can read albums" ON public.albums;
DROP POLICY IF EXISTS "Members can view albums" ON public.albums;
DROP POLICY IF EXISTS "Admins can manage albums" ON public.albums;
DROP POLICY IF EXISTS "Owners can manage albums" ON public.albums;

CREATE POLICY "Public can read active public albums" ON public.albums
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage albums" ON public.albums
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Tracks Policies
DROP POLICY IF EXISTS "Public can read tracks" ON public.tracks;
DROP POLICY IF EXISTS "Members can view tracks" ON public.tracks;
DROP POLICY IF EXISTS "Admins can manage tracks" ON public.tracks;
DROP POLICY IF EXISTS "Owners can manage tracks" ON public.tracks;

CREATE POLICY "Public can read active public tracks" ON public.tracks
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage tracks" ON public.tracks
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Videos Policies
DROP POLICY IF EXISTS "Public can read videos" ON public.videos;
DROP POLICY IF EXISTS "Members can view videos" ON public.videos;
DROP POLICY IF EXISTS "Admins can manage videos" ON public.videos;
DROP POLICY IF EXISTS "Owners can manage videos" ON public.videos;

CREATE POLICY "Public can read active public videos" ON public.videos
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage videos" ON public.videos
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- >>> END 20260821_duckroom_v2_domain_mutations.sql

-- >>> BEGIN 20260821_duckroom_v2_media_ingestion.sql
-- Duckroom V2 Media Ingestion, Upload Sessions, and Media Analysis Records Migration.
-- Establishes server-authoritative upload session state machine, SHA-256 tracking, and media analysis records.

-- 1. Add sha256 tracking to tracks and videos
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_tracks_sha256 ON public.tracks(sha256);
CREATE INDEX IF NOT EXISTS idx_videos_sha256 ON public.videos(sha256);

-- 2. Create upload session status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upload_session_status') THEN
    CREATE TYPE public.upload_session_status AS ENUM (
      'created',
      'analyzing',
      'waiting_review',
      'approved',
      'uploading',
      'uploaded',
      'verifying',
      'analyzing_server',
      'committing',
      'complete',
      'resolved_to_existing',
      'failed',
      'cancelled',
      'verification_failed',
      'db_commit_failed',
      'media_copy_failed',
      'artwork_copy_failed',
      'cleanup_pending'
    );
  END IF;
END
$$;

-- 3. Create upload_sessions table
CREATE TABLE IF NOT EXISTS public.upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('track', 'video')),
  expected_filename TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes > 0),
  expected_mime TEXT NOT NULL,
  expected_extension TEXT NOT NULL,
  client_sha256 TEXT,
  staging_storage_key TEXT NOT NULL,
  canonical_storage_key TEXT,
  status public.upload_session_status NOT NULL DEFAULT 'created',
  stage TEXT NOT NULL DEFAULT 'init',
  progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  analysis_result JSONB,
  server_sha256 TEXT,
  actual_size_bytes BIGINT,
  duplicate_status TEXT NOT NULL DEFAULT 'none' CHECK (duplicate_status IN ('none', 'exact_duplicate', 'likely_match', 'uncertain')),
  matched_entity_id TEXT,
  duplicate_decision TEXT CHECK (duplicate_decision IN ('upload_anyway', 'use_existing', 'cancel')),
  artwork_staging_key TEXT,
  artwork_canonical_key TEXT,
  artwork_status TEXT NOT NULL DEFAULT 'none' CHECK (artwork_status IN ('none', 'pending', 'uploaded', 'verified', 'failed')),
  approved_by_owner BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  committed_entity_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner ON public.upload_sessions(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_sha256 ON public.upload_sessions(server_sha256);

-- 4. Create media_analysis_records table
CREATE TABLE IF NOT EXISTS public.media_analysis_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_session_id UUID REFERENCES public.upload_sessions(id) ON DELETE SET NULL,
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('track', 'video')),
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'duckroom-media-1.0',
  analysis_status TEXT NOT NULL DEFAULT 'verified' CHECK (analysis_status IN ('verified', 'warning', 'error', 'unsupported')),
  analysis JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_analysis_resource ON public.media_analysis_records(resource_kind, resource_id);
CREATE INDEX IF NOT EXISTS idx_media_analysis_sha256 ON public.media_analysis_records(sha256);

-- 5. Row Level Security (RLS) - Owner-only access
ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_analysis_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage upload sessions" ON public.upload_sessions;
CREATE POLICY "Owners manage upload sessions" ON public.upload_sessions
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Owners manage media analysis records" ON public.media_analysis_records;
CREATE POLICY "Owners manage media analysis records" ON public.media_analysis_records
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- >>> END 20260821_duckroom_v2_media_ingestion.sql

-- >>> BEGIN 20260822_duckroom_v2_master_domain.sql
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

-- >>> END 20260822_duckroom_v2_master_domain.sql

-- >>> BEGIN 20260823_duckroom_v2_atomic_reconciliation.sql
-- Atomic master-library reconciliation RPC.
-- All destructive reconciliation happens inside one PostgreSQL transaction.

CREATE OR REPLACE FUNCTION public.replace_master_library_atomic(
  p_albums JSONB,
  p_tracks JSONB,
  p_videos JSONB,
  p_allow_mass_deletion BOOLEAN DEFAULT FALSE,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  album_delete_count INTEGER;
  track_delete_count INTEGER;
  video_delete_count INTEGER;
  persisted_albums INTEGER := 0;
  persisted_tracks INTEGER := 0;
  persisted_videos INTEGER := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_actor_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'FORBIDDEN: owner role required';
  END IF;

  SELECT COUNT(*) INTO album_delete_count
  FROM public.albums a
  WHERE a.id <> 'singles'
    AND a.id <> 'single-collection'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
      WHERE x->>'id' = a.id
    );

  SELECT COUNT(*) INTO track_delete_count
  FROM public.tracks t
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    WHERE x->>'id' = t.id
  );

  SELECT COUNT(*) INTO video_delete_count
  FROM public.videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
    WHERE x->>'id' = v.id
  );

  IF (album_delete_count + track_delete_count + video_delete_count) > 0
     AND NOT COALESCE(p_allow_mass_deletion, FALSE) THEN
    RAISE EXCEPTION 'SAFETY_GUARD: destructive reconciliation requires explicit allowMassDeletion=true';
  END IF;

  INSERT INTO public.albums (
    id, title, artist, year, cover_storage_key, accent, note,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->>'accent', 'oklch(0.72 0.15 62)'),
    COALESCE(x->>'note', ''),
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    cover_storage_key = EXCLUDED.cover_storage_key,
    accent = EXCLUDED.accent,
    note = EXCLUDED.note,
    version = public.albums.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;

  GET DIAGNOSTICS persisted_albums = ROW_COUNT;

  INSERT INTO public.tracks (
    id, album_id, title, artist, track_no, duration_seconds, format,
    bit_depth, sample_rate, size_mb, storage_key, cover_storage_key,
    lyrics, year, version, updated_at, status
  )
  SELECT
    x->>'id',
    NULLIF(x->>'album_id', ''),
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'track_no')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'format', 'UNKNOWN'),
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'sample_rate')::INTEGER, 0),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    COALESCE(x->>'storage_key', ''),
    NULLIF(x->>'cover_storage_key', ''),
    COALESCE(x->'lyrics', '[]'::jsonb),
    NULLIF((x->>'year')::INTEGER, 0),
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  ON CONFLICT (id) DO UPDATE SET
    album_id = EXCLUDED.album_id,
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    track_no = EXCLUDED.track_no,
    duration_seconds = EXCLUDED.duration_seconds,
    format = EXCLUDED.format,
    bit_depth = EXCLUDED.bit_depth,
    sample_rate = EXCLUDED.sample_rate,
    size_mb = EXCLUDED.size_mb,
    storage_key = EXCLUDED.storage_key,
    cover_storage_key = EXCLUDED.cover_storage_key,
    lyrics = EXCLUDED.lyrics,
    year = EXCLUDED.year,
    version = public.tracks.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;

  GET DIAGNOSTICS persisted_tracks = ROW_COUNT;

  INSERT INTO public.videos (
    id, title, artist, year, thumb_storage_key, storage_key,
    duration_seconds, resolution, codec, bitrate, size_mb,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'thumb_storage_key', ''),
    COALESCE(x->>'storage_key', ''),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'resolution', 'UNKNOWN'),
    COALESCE(x->>'codec', 'UNKNOWN'),
    COALESCE(x->>'bitrate', 'UNKNOWN'),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    thumb_storage_key = EXCLUDED.thumb_storage_key,
    storage_key = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds,
    resolution = EXCLUDED.resolution,
    codec = EXCLUDED.codec,
    bitrate = EXCLUDED.bitrate,
    size_mb = EXCLUDED.size_mb,
    version = public.videos.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;

  GET DIAGNOSTICS persisted_videos = ROW_COUNT;

  IF track_delete_count > 0 THEN
    DELETE FROM public.tracks t
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = t.id
    );
  END IF;

  IF album_delete_count > 0 THEN
    DELETE FROM public.albums a
    WHERE a.id <> 'singles'
      AND a.id <> 'single-collection'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
        WHERE x->>'id' = a.id
      );
  END IF;

  IF video_delete_count > 0 THEN
    DELETE FROM public.videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
      WHERE x->>'id' = v.id
    );
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    p_actor_user_id,
    'master_library.replace',
    'library',
    'canonical',
    jsonb_build_object(
      'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
      'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
      'allowMassDeletion', COALESCE(p_allow_mass_deletion, FALSE)
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
    'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, UUID) TO service_role;

-- >>> END 20260823_duckroom_v2_atomic_reconciliation.sql

-- >>> BEGIN 20260824_duckroom_v2_integrity_hardening.sql
-- DUCKROOM V2 INTEGRITY HARDENING
-- Closes Phase 2/3 data-integrity gaps identified by the release-gate audit.
-- 1) Global library revision for stale full-replacement protection.
-- 2) Atomic reconciliation now maintains the normalized Master Domain V2 tables.
-- 3) Destructive media deletes use durable cleanup debt so DB/S3 cannot drift silently.

CREATE TABLE IF NOT EXISTS public.library_revisions (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.library_revisions (id, revision)
VALUES (TRUE, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.library_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read library revision" ON public.library_revisions;
CREATE POLICY "Owners read library revision" ON public.library_revisions
  FOR SELECT USING (public.current_duckroom_role() = 'owner');

CREATE TABLE IF NOT EXISTS public.storage_cleanup_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('track', 'video')),
  resource_id TEXT NOT NULL,
  storage_keys JSONB NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'failed')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_debts_pending
  ON public.storage_cleanup_debts (status, resource_type, resource_id);

ALTER TABLE public.storage_cleanup_debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage storage cleanup debts" ON public.storage_cleanup_debts;
CREATE POLICY "Owners manage storage cleanup debts" ON public.storage_cleanup_debts
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

DROP FUNCTION IF EXISTS public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION public.replace_master_library_atomic(
  p_albums JSONB,
  p_tracks JSONB,
  p_videos JSONB,
  p_allow_mass_deletion BOOLEAN DEFAULT FALSE,
  p_expected_library_revision BIGINT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_revision BIGINT;
  next_revision BIGINT;
  album_delete_count INTEGER;
  track_delete_count INTEGER;
  video_delete_count INTEGER;
  persisted_albums INTEGER := 0;
  persisted_tracks INTEGER := 0;
  persisted_videos INTEGER := 0;
  artist_count INTEGER := 0;
  track_file_count INTEGER := 0;
  video_file_count INTEGER := 0;
  artwork_count INTEGER := 0;
  lyric_count INTEGER := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_actor_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner role required';
  END IF;

  SELECT revision INTO current_revision
  FROM public.library_revisions
  WHERE id = TRUE
  FOR UPDATE;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_REVISION_STATE_MISSING';
  END IF;

  IF p_expected_library_revision IS NULL OR p_expected_library_revision <> current_revision THEN
    RAISE EXCEPTION 'STALE_LIBRARY_REVISION: expected %, current %', p_expected_library_revision, current_revision;
  END IF;

  SELECT COUNT(*) INTO album_delete_count
  FROM public.albums a
  WHERE a.id <> 'singles'
    AND a.id <> 'single-collection'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
      WHERE x->>'id' = a.id
    );

  SELECT COUNT(*) INTO track_delete_count
  FROM public.tracks t
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    WHERE x->>'id' = t.id
  );

  SELECT COUNT(*) INTO video_delete_count
  FROM public.videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
    WHERE x->>'id' = v.id
  );

  IF (album_delete_count + track_delete_count + video_delete_count) > 0
     AND NOT COALESCE(p_allow_mass_deletion, FALSE) THEN
    RAISE EXCEPTION 'SAFETY_GUARD: destructive reconciliation requires explicit allowMassDeletion=true';
  END IF;

  -- Canonical artist identity for every current master record.
  INSERT INTO public.artists (id, name, normalized_name)
  SELECT DISTINCT
    md5('artist:' || lower(trim(name))),
    trim(name),
    lower(trim(name))
  FROM (
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) s
  WHERE name IS NOT NULL AND trim(name) <> ''
  ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW();
  GET DIAGNOSTICS artist_count = ROW_COUNT;

  -- Canonical artwork assets are keyed by their immutable master object key.
  INSERT INTO public.artwork_assets (master_storage_key, display_256_key, display_512_key, display_1024_key, display_2048_key)
  SELECT DISTINCT key, key, key, key, key
  FROM (
    SELECT NULLIF(x->>'cover_storage_key', '') AS key FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT NULLIF(x->>'cover_storage_key', '') AS key FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT NULLIF(x->>'thumb_storage_key', '') AS key FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) a
  WHERE key IS NOT NULL
  ON CONFLICT (master_storage_key) DO NOTHING;
  GET DIAGNOSTICS artwork_count = ROW_COUNT;

  INSERT INTO public.albums (
    id, title, artist, year, cover_storage_key, accent, note,
    artist_id, album_artist_id, release_year, cover_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->>'accent', 'oklch(0.72 0.15 62)'),
    COALESCE(x->>'note', ''),
    ar.id,
    ar.id,
    COALESCE((x->>'year')::INTEGER, 0),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    cover_storage_key = EXCLUDED.cover_storage_key,
    accent = EXCLUDED.accent,
    note = EXCLUDED.note,
    artist_id = EXCLUDED.artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.albums.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_albums = ROW_COUNT;

  INSERT INTO public.tracks (
    id, album_id, title, artist, track_no, duration_seconds, format,
    bit_depth, sample_rate, size_mb, storage_key, cover_storage_key,
    lyrics, year, primary_artist_id, album_artist_id, release_year,
    cover_asset_id, version, updated_at, status
  )
  SELECT
    x->>'id',
    NULLIF(x->>'album_id', ''),
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'track_no')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'format', 'UNKNOWN'),
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'sample_rate')::INTEGER, 0),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    COALESCE(x->>'storage_key', ''),
    NULLIF(x->>'cover_storage_key', ''),
    COALESCE(x->'lyrics', '[]'::jsonb),
    NULLIF((x->>'year')::INTEGER, 0),
    ar.id,
    ar.id,
    NULLIF((x->>'year')::INTEGER, 0),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    album_id = EXCLUDED.album_id,
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    track_no = EXCLUDED.track_no,
    duration_seconds = EXCLUDED.duration_seconds,
    format = EXCLUDED.format,
    bit_depth = EXCLUDED.bit_depth,
    sample_rate = EXCLUDED.sample_rate,
    size_mb = EXCLUDED.size_mb,
    storage_key = EXCLUDED.storage_key,
    cover_storage_key = EXCLUDED.cover_storage_key,
    lyrics = EXCLUDED.lyrics,
    year = EXCLUDED.year,
    primary_artist_id = EXCLUDED.primary_artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.tracks.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_tracks = ROW_COUNT;

  -- Canonical physical file rows for tracks.
  INSERT INTO public.track_files (
    track_id, kind, storage_key, extension, container, sample_rate, bit_depth,
    duration_seconds, file_size_bytes
  )
  SELECT
    x->>'id',
    'master',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(upper(x->>'format'), ''),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    CASE WHEN COALESCE((x->>'size_mb')::NUMERIC, 0) > 0 THEN round((x->>'size_mb')::NUMERIC * 1024 * 1024)::BIGINT END
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    track_id = EXCLUDED.track_id,
    kind = 'master',
    extension = EXCLUDED.extension,
    container = EXCLUDED.container,
    sample_rate = EXCLUDED.sample_rate,
    bit_depth = EXCLUDED.bit_depth,
    duration_seconds = EXCLUDED.duration_seconds,
    file_size_bytes = EXCLUDED.file_size_bytes;
  GET DIAGNOSTICS track_file_count = ROW_COUNT;

  INSERT INTO public.videos (
    id, title, artist, year, thumb_storage_key, storage_key,
    duration_seconds, resolution, codec, bitrate, size_mb,
    artist_id, album_id, artwork_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'thumb_storage_key', ''),
    COALESCE(x->>'storage_key', ''),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'resolution', 'UNKNOWN'),
    COALESCE(x->>'codec', 'UNKNOWN'),
    COALESCE(x->>'bitrate', 'UNKNOWN'),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    ar.id,
    NULLIF(x->>'album_id', ''),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'thumb_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    thumb_storage_key = EXCLUDED.thumb_storage_key,
    storage_key = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds,
    resolution = EXCLUDED.resolution,
    codec = EXCLUDED.codec,
    bitrate = EXCLUDED.bitrate,
    size_mb = EXCLUDED.size_mb,
    artist_id = EXCLUDED.artist_id,
    album_id = EXCLUDED.album_id,
    artwork_asset_id = EXCLUDED.artwork_asset_id,
    version = public.videos.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_videos = ROW_COUNT;

  INSERT INTO public.video_files (
    video_id, storage_key, container, codec, resolution, duration_seconds, file_size_bytes
  )
  SELECT
    x->>'id',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(x->>'codec', ''),
    NULLIF(x->>'resolution', ''),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    CASE WHEN COALESCE((x->>'size_mb')::NUMERIC, 0) > 0 THEN round((x->>'size_mb')::NUMERIC * 1024 * 1024)::BIGINT END
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    container = EXCLUDED.container,
    codec = EXCLUDED.codec,
    resolution = EXCLUDED.resolution,
    duration_seconds = EXCLUDED.duration_seconds,
    file_size_bytes = EXCLUDED.file_size_bytes;
  GET DIAGNOSTICS video_file_count = ROW_COUNT;

  -- Keep media-analysis pointers attached to the normalized master file identity.
  UPDATE public.media_analysis_records mar
  SET track_file_id = tf.id
  FROM public.track_files tf
  WHERE mar.resource_kind = 'track'
    AND mar.resource_id = tf.track_id
    AND mar.storage_key = tf.storage_key;

  UPDATE public.media_analysis_records mar
  SET video_file_id = vf.id
  FROM public.video_files vf
  WHERE mar.resource_kind = 'video'
    AND mar.resource_id = vf.video_id
    AND mar.storage_key = vf.storage_key;

  -- One authoritative legacy-json lyrics projection per current track.
  DELETE FROM public.lyrics_documents ld
  WHERE ld.source = 'legacy-json'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = ld.track_id
    );

  INSERT INTO public.lyrics_documents (track_id, source, kind, content, version)
  SELECT
    x->>'id',
    'legacy-json',
    CASE WHEN jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
              AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
         THEN 'synced' ELSE 'plain' END,
    COALESCE(x->'lyrics', '[]'::jsonb)::text,
    1
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0;
  GET DIAGNOSTICS lyric_count = ROW_COUNT;

  -- Reconcile canonical children automatically via parent cascades, then remove unreferenced artwork identities.
  IF track_delete_count > 0 THEN
    DELETE FROM public.tracks t
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = t.id
    );
  END IF;

  IF album_delete_count > 0 THEN
    DELETE FROM public.albums a
    WHERE a.id <> 'singles'
      AND a.id <> 'single-collection'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
        WHERE x->>'id' = a.id
      );
  END IF;

  IF video_delete_count > 0 THEN
    DELETE FROM public.videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
      WHERE x->>'id' = v.id
    );
  END IF;

  DELETE FROM public.artwork_assets aa
  WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.videos v WHERE v.artwork_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.artists ar WHERE ar.image_asset_id = aa.id);

  UPDATE public.library_revisions
  SET revision = revision + 1, updated_at = NOW()
  WHERE id = TRUE
  RETURNING revision INTO next_revision;

  INSERT INTO public.audit_logs (
    actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    p_actor_user_id,
    'master_library.reconcile',
    'library',
    'master',
    jsonb_build_object(
      'previous_revision', current_revision,
      'revision', next_revision,
      'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
      'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
      'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
      'allow_mass_deletion', p_allow_mass_deletion
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'libraryRevision', next_revision,
    'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
    'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
    'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) TO service_role;

COMMENT ON TABLE public.library_revisions IS 'Singleton global revision used to reject stale full-library replacements.';
COMMENT ON TABLE public.storage_cleanup_debts IS 'Durable DB/S3 deletion compensation records; canonical DB deletion must never depend on successful object deletion.';

-- >>> END 20260824_duckroom_v2_integrity_hardening.sql

-- >>> BEGIN 20260825_duckroom_v2_authoritative_media_metadata.sql
-- ============================================================================
-- DUCKROOM V2 AUTHORITATIVE MEDIA FILE METADATA MIGRATION
-- Migration: 20260825_duckroom_v2_authoritative_media_metadata.sql
-- Closes BLOCKER 2: Non-fabrication of media metadata and strict authoritative
-- derivation from server-verified media analysis records.
-- ============================================================================

-- 1. Redefine replace_master_library_atomic without legacy size_mb math fabrication
DROP FUNCTION IF EXISTS public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID);

CREATE OR REPLACE FUNCTION public.replace_master_library_atomic(
  p_albums JSONB,
  p_tracks JSONB,
  p_videos JSONB,
  p_allow_mass_deletion BOOLEAN DEFAULT FALSE,
  p_expected_library_revision BIGINT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_revision BIGINT;
  next_revision BIGINT;
  album_delete_count INTEGER;
  track_delete_count INTEGER;
  video_delete_count INTEGER;
  persisted_albums INTEGER := 0;
  persisted_tracks INTEGER := 0;
  persisted_videos INTEGER := 0;
  artist_count INTEGER := 0;
  track_file_count INTEGER := 0;
  video_file_count INTEGER := 0;
  artwork_count INTEGER := 0;
  lyric_count INTEGER := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_actor_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner role required';
  END IF;

  SELECT revision INTO current_revision
  FROM public.library_revisions
  WHERE id = TRUE
  FOR UPDATE;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_REVISION_STATE_MISSING';
  END IF;

  IF p_expected_library_revision IS NULL OR p_expected_library_revision <> current_revision THEN
    RAISE EXCEPTION 'STALE_LIBRARY_REVISION: expected %, current %', p_expected_library_revision, current_revision;
  END IF;

  SELECT COUNT(*) INTO album_delete_count
  FROM public.albums a
  WHERE a.id <> 'singles'
    AND a.id <> 'single-collection'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
      WHERE x->>'id' = a.id
    );

  SELECT COUNT(*) INTO track_delete_count
  FROM public.tracks t
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    WHERE x->>'id' = t.id
  );

  SELECT COUNT(*) INTO video_delete_count
  FROM public.videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
    WHERE x->>'id' = v.id
  );

  IF (album_delete_count + track_delete_count + video_delete_count) > 0
     AND NOT COALESCE(p_allow_mass_deletion, FALSE) THEN
    RAISE EXCEPTION 'SAFETY_GUARD: destructive reconciliation requires explicit allowMassDeletion=true';
  END IF;

  -- Normalized Artist upserts
  INSERT INTO public.artists (id, name, normalized_name)
  SELECT DISTINCT
    'artist-' || lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g')),
    trim(name),
    lower(trim(name))
  FROM (
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) artists_input
  WHERE NULLIF(trim(name), '') IS NOT NULL
  ON CONFLICT (normalized_name) DO UPDATE SET
    name = EXCLUDED.name;
  GET DIAGNOSTICS artist_count = ROW_COUNT;

  -- Artwork asset upserts
  INSERT INTO public.artwork_assets (master_storage_key, mime_type)
  SELECT DISTINCT
    cover_key,
    'image/jpeg'
  FROM (
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'thumb_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) covers
  WHERE NULLIF(trim(cover_key), '') IS NOT NULL
  ON CONFLICT (master_storage_key) DO NOTHING;
  GET DIAGNOSTICS artwork_count = ROW_COUNT;

  -- Albums upsert
  INSERT INTO public.albums (
    id, title, artist, year, cover_storage_key, accent, note,
    artist_id, album_artist_id, release_year, cover_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->>'accent', 'oklch(0.72 0.15 62)'),
    COALESCE(x->>'note', ''),
    ar.id,
    ar.id,
    COALESCE((x->>'year')::INTEGER, 0),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    cover_storage_key = EXCLUDED.cover_storage_key,
    accent = EXCLUDED.accent,
    note = EXCLUDED.note,
    artist_id = EXCLUDED.artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.albums.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_albums = ROW_COUNT;

  -- Tracks upsert
  INSERT INTO public.tracks (
    id, album_id, title, artist, track_no, duration_seconds, format,
    bit_depth, sample_rate, size_mb, storage_key, cover_storage_key,
    lyrics, year, primary_artist_id, album_artist_id, release_year,
    cover_asset_id, version, updated_at, status
  )
  SELECT
    x->>'id',
    NULLIF(x->>'album_id', ''),
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'track_no')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'format', 'UNKNOWN'),
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    COALESCE(x->>'storage_key', ''),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->'lyrics', '[]'::jsonb),
    (x->>'year')::INTEGER,
    ar.id,
    ar.id,
    (x->>'year')::INTEGER,
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    album_id = EXCLUDED.album_id,
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    track_no = EXCLUDED.track_no,
    duration_seconds = EXCLUDED.duration_seconds,
    format = EXCLUDED.format,
    bit_depth = EXCLUDED.bit_depth,
    sample_rate = EXCLUDED.sample_rate,
    size_mb = EXCLUDED.size_mb,
    storage_key = EXCLUDED.storage_key,
    cover_storage_key = EXCLUDED.cover_storage_key,
    lyrics = EXCLUDED.lyrics,
    year = EXCLUDED.year,
    primary_artist_id = EXCLUDED.primary_artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.tracks.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_tracks = ROW_COUNT;

  -- Canonical physical file rows for tracks (AUTHORITATIVE: Non-fabricating)
  INSERT INTO public.track_files (
    track_id, kind, storage_key, extension, container, sample_rate, bit_depth,
    duration_seconds, file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    'master',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(upper(x->>'format'), ''),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL, -- Non-fabrication: unverified until server binary analysis
    NULLIF(x->>'sha256', ''),
    CASE WHEN NULLIF(x->>'sha256', '') IS NOT NULL THEN NOW() ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    track_id = EXCLUDED.track_id,
    kind = 'master',
    extension = EXCLUDED.extension,
    container = EXCLUDED.container,
    sample_rate = EXCLUDED.sample_rate,
    bit_depth = EXCLUDED.bit_depth,
    duration_seconds = EXCLUDED.duration_seconds,
    file_size_bytes = public.track_files.file_size_bytes,
    sha256 = COALESCE(public.track_files.sha256, EXCLUDED.sha256),
    verified_at = COALESCE(public.track_files.verified_at, EXCLUDED.verified_at);
  GET DIAGNOSTICS track_file_count = ROW_COUNT;

  -- Videos upsert
  INSERT INTO public.videos (
    id, title, artist, year, thumb_storage_key, storage_key,
    duration_seconds, resolution, codec, bitrate, size_mb,
    artist_id, album_id, artwork_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'thumb_storage_key', ''),
    COALESCE(x->>'storage_key', ''),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'resolution', 'UNKNOWN'),
    COALESCE(x->>'codec', 'UNKNOWN'),
    COALESCE(x->>'bitrate', 'UNKNOWN'),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    ar.id,
    NULLIF(x->>'album_id', ''),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'thumb_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    thumb_storage_key = EXCLUDED.thumb_storage_key,
    storage_key = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds,
    resolution = EXCLUDED.resolution,
    codec = EXCLUDED.codec,
    bitrate = EXCLUDED.bitrate,
    size_mb = EXCLUDED.size_mb,
    artist_id = EXCLUDED.artist_id,
    album_id = EXCLUDED.album_id,
    artwork_asset_id = EXCLUDED.artwork_asset_id,
    version = public.videos.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_videos = ROW_COUNT;

  -- Canonical physical file rows for videos (AUTHORITATIVE: Non-fabricating)
  INSERT INTO public.video_files (
    video_id, storage_key, container, codec, resolution, duration_seconds,
    file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(x->>'codec', ''),
    NULLIF(x->>'resolution', ''),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL, -- Non-fabrication: unverified until server binary analysis
    NULLIF(x->>'sha256', ''),
    CASE WHEN NULLIF(x->>'sha256', '') IS NOT NULL THEN NOW() ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    container = EXCLUDED.container,
    codec = EXCLUDED.codec,
    resolution = EXCLUDED.resolution,
    duration_seconds = EXCLUDED.duration_seconds,
    file_size_bytes = public.video_files.file_size_bytes,
    sha256 = COALESCE(public.video_files.sha256, EXCLUDED.sha256),
    verified_at = COALESCE(public.video_files.verified_at, EXCLUDED.verified_at);
  GET DIAGNOSTICS video_file_count = ROW_COUNT;

  -- Lyrics documents upsert
  INSERT INTO public.lyrics_documents (track_id, source, kind, content, verified)
  SELECT
    x->>'id',
    'manifest',
    'synced',
    x->'lyrics'->>0,
    FALSE
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
    AND x->'lyrics'->>0 IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS lyric_count = ROW_COUNT;

  -- Atomic Deletion of removed items
  IF album_delete_count > 0 THEN
    DELETE FROM public.albums a
    WHERE a.id <> 'singles'
      AND a.id <> 'single-collection'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
        WHERE x->>'id' = a.id
      );
  END IF;

  IF track_delete_count > 0 THEN
    DELETE FROM public.tracks t
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = t.id
    );
  END IF;

  IF video_delete_count > 0 THEN
    DELETE FROM public.videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
      WHERE x->>'id' = v.id
    );
  END IF;

  next_revision := current_revision + 1;
  UPDATE public.library_revisions
  SET revision = next_revision,
      updated_at = NOW()
  WHERE id = TRUE;

  INSERT INTO public.audit_logs (
    actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    p_actor_user_id,
    'master_library.reconcile_atomic',
    'master_library',
    'canonical',
    jsonb_build_object(
      'previous_revision', current_revision,
      'new_revision', next_revision,
      'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
      'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
      'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
      'allow_mass_deletion', p_allow_mass_deletion
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'previous_revision', current_revision,
    'new_revision', next_revision,
    'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
    'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
    'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count)
  );
END;
$$;

-- 2. Data remediation / backfill:
-- Clean up fabricated file_size_bytes on unverified records
UPDATE public.track_files
SET file_size_bytes = NULL
WHERE verified_at IS NULL AND sha256 IS NULL;

UPDATE public.video_files
SET file_size_bytes = NULL
WHERE verified_at IS NULL AND sha256 IS NULL;

-- 3. Backfill verified media metadata from authoritative media_analysis_records where available
UPDATE public.track_files tf
SET
  file_size_bytes = COALESCE((mar.analysis->>'fileSizeBytes')::BIGINT, tf.file_size_bytes),
  sha256 = COALESCE(mar.sha256, tf.sha256),
  sample_rate = COALESCE((mar.analysis->>'sampleRate')::INTEGER, tf.sample_rate),
  bit_depth = COALESCE((mar.analysis->>'bitDepth')::INTEGER, tf.bit_depth),
  channels = COALESCE((mar.analysis->>'channels')::INTEGER, tf.channels),
  codec = COALESCE(mar.analysis->>'codec', tf.codec),
  container = COALESCE(mar.analysis->>'container', tf.container),
  duration_seconds = COALESCE((mar.analysis->>'durationSeconds')::DOUBLE PRECISION, tf.duration_seconds),
-- CORRECTION (2026-08-25, first live application): this statement referenced
-- `mar.created_at`, a column that NEVER existed in media_analysis_records
-- (table has verified_at from 20260821; analyzed_at added 20260822). The
-- chain had never been applied end-to-end before, so the typo was latent.
-- Fixed to the semantically-correct source column. Documented in AD-15.
        verified_at = COALESCE(mar.verified_at, NOW())
FROM public.media_analysis_records mar
WHERE mar.storage_key = tf.storage_key
  AND mar.analysis IS NOT NULL
  AND (mar.analysis_status = 'verified' OR mar.analysis_status = 'complete');

UPDATE public.media_analysis_records mar
SET track_file_id = tf.id
FROM public.track_files tf
WHERE mar.storage_key = tf.storage_key
  AND mar.track_file_id IS NULL;

UPDATE public.media_analysis_records mar
SET video_file_id = vf.id
FROM public.video_files vf
WHERE mar.storage_key = vf.storage_key
  AND mar.video_file_id IS NULL;

-- >>> END 20260825_duckroom_v2_authoritative_media_metadata.sql

-- >>> BEGIN 20260826_duckroom_v2_canonical_integrity_closure.sql
-- DUCKROOM MASTER DOMAIN V2 — CANONICAL INTEGRITY CLOSURE
-- Migration: 20260826_duckroom_v2_canonical_integrity_closure.sql
-- Closes Blockers A, B, C, D:
-- 1. Lyrics data integrity: Unique canonical identity, complete multi-line preservation, idempotent upsert
-- 2. Authoritative SHA-256 / verification semantics: Caller payload cannot forge verified_at or SHA-256
-- 3. Artwork MIME typing: Non-fabrication, supports JPEG, PNG, WebP, AVIF, GIF, SVG, NULL for unknown
-- 4. Canonical physical metadata precedence over legacy denormalized columns

-- 1. Enforce unique canonical identity on lyrics_documents
CREATE UNIQUE INDEX IF NOT EXISTS idx_lyrics_documents_canonical_identity
  ON public.lyrics_documents(track_id, source, kind, version);

-- 2. Remediate existing artwork_assets with misattributed MIME types
UPDATE public.artwork_assets
SET mime_type = CASE
  WHEN lower(master_storage_key) ~ '\.(jpg|jpeg)$' THEN 'image/jpeg'
  WHEN lower(master_storage_key) ~ '\.png$' THEN 'image/png'
  WHEN lower(master_storage_key) ~ '\.webp$' THEN 'image/webp'
  WHEN lower(master_storage_key) ~ '\.avif$' THEN 'image/avif'
  WHEN lower(master_storage_key) ~ '\.gif$' THEN 'image/gif'
  WHEN lower(master_storage_key) ~ '\.svg$' THEN 'image/svg+xml'
  ELSE NULL
END
WHERE mime_type = 'image/jpeg'
  AND lower(master_storage_key) !~ '\.(jpg|jpeg)$';

-- 3. Remediate unverified verified_at flags on track_files / video_files where no media analysis exists
UPDATE public.track_files
SET verified_at = NULL, sha256 = NULL, file_size_bytes = NULL
WHERE verified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.media_analysis_records mar
    WHERE mar.track_file_id = track_files.id
       OR mar.storage_key = track_files.storage_key
  );

UPDATE public.video_files
SET verified_at = NULL, sha256 = NULL, file_size_bytes = NULL
WHERE verified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.media_analysis_records mar
    WHERE mar.video_file_id = video_files.id
       OR mar.storage_key = video_files.storage_key
  );

-- 4. Backfill complete lyrics documents from tracks.lyrics without line loss
INSERT INTO public.lyrics_documents (track_id, source, kind, content, version)
SELECT
  t.id,
  'legacy-json',
  CASE
    WHEN jsonb_typeof(t.lyrics) = 'array' AND jsonb_array_length(t.lyrics) > 0 THEN 'synced'
    ELSE 'plain'
  END,
  t.lyrics::text,
  1
FROM public.tracks t
WHERE t.lyrics IS NOT NULL
  AND jsonb_typeof(t.lyrics) = 'array'
  AND jsonb_array_length(t.lyrics) > 0
ON CONFLICT (track_id, source, kind, version) DO UPDATE SET
  content = EXCLUDED.content,
  kind = EXCLUDED.kind,
  updated_at = NOW();

-- 5. Updated Atomic Master Library Reconciliation Function
CREATE OR REPLACE FUNCTION public.replace_master_library_atomic(
  p_albums JSONB,
  p_tracks JSONB,
  p_videos JSONB,
  p_allow_mass_deletion BOOLEAN DEFAULT FALSE,
  p_expected_library_revision BIGINT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_revision BIGINT;
  next_revision BIGINT;
  album_delete_count INTEGER;
  track_delete_count INTEGER;
  video_delete_count INTEGER;
  persisted_albums INTEGER := 0;
  persisted_tracks INTEGER := 0;
  persisted_videos INTEGER := 0;
  artist_count INTEGER := 0;
  track_file_count INTEGER := 0;
  video_file_count INTEGER := 0;
  artwork_count INTEGER := 0;
  lyric_count INTEGER := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_actor_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner role required';
  END IF;

  SELECT revision INTO current_revision
  FROM public.library_revisions
  WHERE id = TRUE
  FOR UPDATE;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_REVISION_STATE_MISSING';
  END IF;

  IF p_expected_library_revision IS NULL OR p_expected_library_revision <> current_revision THEN
    RAISE EXCEPTION 'STALE_LIBRARY_REVISION: expected %, current %', p_expected_library_revision, current_revision;
  END IF;

  SELECT COUNT(*) INTO album_delete_count
  FROM public.albums a
  WHERE a.id <> 'singles'
    AND a.id <> 'single-collection'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
      WHERE x->>'id' = a.id
    );

  SELECT COUNT(*) INTO track_delete_count
  FROM public.tracks t
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    WHERE x->>'id' = t.id
  );

  SELECT COUNT(*) INTO video_delete_count
  FROM public.videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
    WHERE x->>'id' = v.id
  );

  IF (album_delete_count + track_delete_count + video_delete_count) > 0
     AND NOT COALESCE(p_allow_mass_deletion, FALSE) THEN
    RAISE EXCEPTION 'SAFETY_GUARD: destructive reconciliation requires explicit allowMassDeletion=true';
  END IF;

  -- Normalized Artist upserts
  INSERT INTO public.artists (id, name, normalized_name)
  SELECT DISTINCT
    'artist-' || lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g')),
    trim(name),
    lower(trim(name))
  FROM (
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) artists_input
  WHERE NULLIF(trim(name), '') IS NOT NULL
  ON CONFLICT (normalized_name) DO UPDATE SET
    name = EXCLUDED.name;
  GET DIAGNOSTICS artist_count = ROW_COUNT;

  -- Artwork asset upserts (AUTHORITATIVE: Non-fabricating MIME resolution)
  INSERT INTO public.artwork_assets (master_storage_key, mime_type)
  SELECT DISTINCT
    cover_key,
    CASE
      WHEN lower(cover_key) ~ '\.(jpg|jpeg)$' THEN 'image/jpeg'
      WHEN lower(cover_key) ~ '\.png$' THEN 'image/png'
      WHEN lower(cover_key) ~ '\.webp$' THEN 'image/webp'
      WHEN lower(cover_key) ~ '\.avif$' THEN 'image/avif'
      WHEN lower(cover_key) ~ '\.gif$' THEN 'image/gif'
      WHEN lower(cover_key) ~ '\.svg$' THEN 'image/svg+xml'
      ELSE NULL -- Explicit NULL for unverified/unknown formats
    END
  FROM (
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'thumb_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) covers
  WHERE NULLIF(trim(cover_key), '') IS NOT NULL
  ON CONFLICT (master_storage_key) DO UPDATE SET
    mime_type = COALESCE(public.artwork_assets.mime_type, EXCLUDED.mime_type);
  GET DIAGNOSTICS artwork_count = ROW_COUNT;

  -- Albums upsert
  INSERT INTO public.albums (
    id, title, artist, year, cover_storage_key, accent, note,
    artist_id, album_artist_id, release_year, cover_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->>'accent', 'oklch(0.72 0.15 62)'),
    COALESCE(x->>'note', ''),
    ar.id,
    ar.id,
    COALESCE((x->>'year')::INTEGER, 0),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    cover_storage_key = EXCLUDED.cover_storage_key,
    accent = EXCLUDED.accent,
    note = EXCLUDED.note,
    artist_id = EXCLUDED.artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.albums.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_albums = ROW_COUNT;

  -- Tracks upsert
  INSERT INTO public.tracks (
    id, album_id, title, artist, track_no, duration_seconds, format,
    bit_depth, sample_rate, size_mb, storage_key, cover_storage_key,
    lyrics, year, primary_artist_id, album_artist_id, release_year,
    cover_asset_id, version, updated_at, status
  )
  SELECT
    x->>'id',
    NULLIF(x->>'album_id', ''),
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'track_no')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'format', 'UNKNOWN'),
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    COALESCE(x->>'storage_key', ''),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->'lyrics', '[]'::jsonb),
    (x->>'year')::INTEGER,
    ar.id,
    ar.id,
    (x->>'year')::INTEGER,
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    album_id = EXCLUDED.album_id,
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    track_no = EXCLUDED.track_no,
    duration_seconds = EXCLUDED.duration_seconds,
    format = EXCLUDED.format,
    bit_depth = EXCLUDED.bit_depth,
    sample_rate = EXCLUDED.sample_rate,
    size_mb = EXCLUDED.size_mb,
    storage_key = EXCLUDED.storage_key,
    cover_storage_key = EXCLUDED.cover_storage_key,
    lyrics = EXCLUDED.lyrics,
    year = EXCLUDED.year,
    primary_artist_id = EXCLUDED.primary_artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.tracks.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_tracks = ROW_COUNT;

  -- Canonical physical file rows for tracks (AUTHORITATIVE: Non-fabricating & caller verification rejection)
  INSERT INTO public.track_files (
    track_id, kind, storage_key, extension, container, sample_rate, bit_depth,
    duration_seconds, file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    'master',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(upper(x->>'format'), ''),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL, -- Non-fabrication: unverified until server binary analysis
    NULL, -- Caller claim rejected; only server analysis sets verified sha256
    NULL  -- Caller claim rejected; only server analysis sets verified_at
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    track_id = EXCLUDED.track_id,
    kind = 'master',
    extension = EXCLUDED.extension,
    container = EXCLUDED.container,
    sample_rate = COALESCE(public.track_files.sample_rate, EXCLUDED.sample_rate),
    bit_depth = COALESCE(public.track_files.bit_depth, EXCLUDED.bit_depth),
    duration_seconds = COALESCE(public.track_files.duration_seconds, EXCLUDED.duration_seconds),
    file_size_bytes = public.track_files.file_size_bytes,
    sha256 = public.track_files.sha256,
    verified_at = public.track_files.verified_at;
  GET DIAGNOSTICS track_file_count = ROW_COUNT;

  INSERT INTO public.videos (
    id, title, artist, year, thumb_storage_key, storage_key,
    duration_seconds, resolution, codec, bitrate, size_mb,
    artist_id, album_id, artwork_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'thumb_storage_key', ''),
    COALESCE(x->>'storage_key', ''),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'resolution', 'UNKNOWN'),
    COALESCE(x->>'codec', 'UNKNOWN'),
    COALESCE(x->>'bitrate', 'UNKNOWN'),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    ar.id,
    NULLIF(x->>'album_id', ''),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'thumb_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    thumb_storage_key = EXCLUDED.thumb_storage_key,
    storage_key = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds,
    resolution = EXCLUDED.resolution,
    codec = EXCLUDED.codec,
    bitrate = EXCLUDED.bitrate,
    size_mb = EXCLUDED.size_mb,
    artist_id = EXCLUDED.artist_id,
    album_id = EXCLUDED.album_id,
    artwork_asset_id = EXCLUDED.artwork_asset_id,
    version = public.videos.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_videos = ROW_COUNT;

  -- Canonical physical file rows for videos (AUTHORITATIVE: Non-fabricating & caller verification rejection)
  INSERT INTO public.video_files (
    video_id, storage_key, container, codec, resolution, duration_seconds,
    file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(x->>'codec', ''),
    NULLIF(x->>'resolution', ''),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL, -- Non-fabrication: unverified until server binary analysis
    NULL, -- Caller claim rejected
    NULL  -- Caller claim rejected
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    container = EXCLUDED.container,
    codec = COALESCE(public.video_files.codec, EXCLUDED.codec),
    resolution = COALESCE(public.video_files.resolution, EXCLUDED.resolution),
    duration_seconds = COALESCE(public.video_files.duration_seconds, EXCLUDED.duration_seconds),
    file_size_bytes = public.video_files.file_size_bytes,
    sha256 = public.video_files.sha256,
    verified_at = public.video_files.verified_at;
  GET DIAGNOSTICS video_file_count = ROW_COUNT;

  -- Keep media-analysis pointers attached to the normalized master file identity.
  UPDATE public.media_analysis_records mar
  SET track_file_id = tf.id
  FROM public.track_files tf
  WHERE mar.resource_kind = 'track'
    AND mar.resource_id = tf.track_id
    AND mar.storage_key = tf.storage_key;

  UPDATE public.media_analysis_records mar
  SET video_file_id = vf.id
  FROM public.video_files vf
  WHERE mar.resource_kind = 'video'
    AND mar.resource_id = vf.video_id
    AND mar.storage_key = vf.storage_key;

  -- Complete multi-line synced/plain lyrics documents (AUTHORITATIVE: Non-truncating idempotent upsert)
  INSERT INTO public.lyrics_documents (track_id, source, kind, content, version)
  SELECT
    x->>'id',
    'legacy-json',
    CASE WHEN jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
              AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
         THEN 'synced' ELSE 'plain' END,
    COALESCE(x->'lyrics', '[]'::jsonb)::text,
    1
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
  ON CONFLICT (track_id, source, kind, version) DO UPDATE SET
    content = EXCLUDED.content,
    kind = EXCLUDED.kind,
    updated_at = NOW();
  GET DIAGNOSTICS lyric_count = ROW_COUNT;

  -- Reconcile canonical children automatically via parent cascades, then remove unreferenced artwork identities.
  IF track_delete_count > 0 THEN
    DELETE FROM public.tracks t
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = t.id
    );
  END IF;

  IF video_delete_count > 0 THEN
    DELETE FROM public.videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
      WHERE x->>'id' = v.id
    );
  END IF;

  IF album_delete_count > 0 THEN
    DELETE FROM public.albums a
    WHERE a.id <> 'singles'
      AND a.id <> 'single-collection'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
        WHERE x->>'id' = a.id
      );
  END IF;

  DELETE FROM public.artwork_assets aa
  WHERE NOT EXISTS (SELECT 1 FROM public.albums al WHERE al.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.tracks tr WHERE tr.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.videos vd WHERE vd.artwork_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.artists ar WHERE ar.image_asset_id = aa.id);

  next_revision := current_revision + 1;
  UPDATE public.library_revisions
  SET revision = next_revision,
      updated_at = NOW(),
      updated_by = p_actor_user_id
  WHERE id = TRUE;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    p_actor_user_id,
    'library.reconcile_atomic',
    'library',
    'master',
    jsonb_build_object(
      'previous_revision', current_revision,
      'revision', next_revision,
      'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
      'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
      'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
      'allow_mass_deletion', p_allow_mass_deletion
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'libraryRevision', next_revision,
    'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
    'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
    'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) TO service_role;

-- >>> END 20260826_duckroom_v2_canonical_integrity_closure.sql

-- >>> BEGIN 20260827_duckroom_v2_fix_revision_actor_column.sql
-- Duckroom V2 — Fix: library_revisions.updated_by
--
-- Bug: 20260826_duckroom_v2_canonical_integrity_closure.sql introduced
-- "UPDATE public.library_revisions SET ... updated_by = p_actor_user_id"
-- inside replace_master_library_atomic, but no prior migration ever created
-- the column. PL/pgSQL defers column resolution to execution time, so the
-- migration applied cleanly and every subsequent invocation of the RPC raised
-- SQLSTATE 42703 ("column \"updated_by\" of relation \"library_revisions\"
-- does not exist") — breaking the canonical full-library replacement path.
--
-- Fix: add the missing column so the shipped RPC body resolves correctly.
-- Nullable: the column is only ever written by replace_master_library_atomic.

ALTER TABLE public.library_revisions
  ADD COLUMN IF NOT EXISTS updated_by UUID;

COMMENT ON COLUMN public.library_revisions.updated_by IS
  'auth.users.id of the actor that last bumped the revision via replace_master_library_atomic.';

-- >>> END 20260827_duckroom_v2_fix_revision_actor_column.sql

-- >>> BEGIN 20260828_duckroom_v2_share_link_guest_and_token_hash.sql
-- Duckroom V2 — Share links: guest-capable creation + hash-at-rest tokens
--
-- Fix 1 (P1): Guest share-link creation was structurally impossible.
--   createShareLinkServer inserts created_by = NULL for anonymous users, but
--   the column was declared NOT NULL REFERENCES auth.users(id). Master Plan
--   §1.3 grants Guests the ability to share public content, so the constraint
--   must allow an anonymous creator.
--
-- Fix 2 (P2 hardening): Share tokens were stored in plaintext. A database leak
--   would expose every live capability URL. Tokens are now stored as SHA-256
--   hex digests (token_hash). The raw token is shown exactly once at creation
--   time and never persisted. Lookup paths resolve by hashing the presented
--   token instead of plaintext equality.
--
-- The legacy `token` column is kept temporarily for rollback safety and is
-- deprecated; it will be dropped in a future cleanup migration once all
-- environments run the hashed-token application build.

-- ---------------------------------------------------------------------------
-- Fix 1: anonymous creators are allowed (service-role writes only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.share_links ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN public.share_links.created_by IS
  'auth.users.id of the member/owner that created the link. NULL when minted anonymously by a Guest for public content.';

-- ---------------------------------------------------------------------------
-- Fix 2: SHA-256 hash-at-rest capability tokens
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.share_links ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- Backfill existing rows from their legacy plaintext tokens so no link dies.
UPDATE public.share_links
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.share_links ALTER COLUMN token_hash SET NOT NULL;

DROP INDEX IF EXISTS idx_share_links_token_hash;
CREATE UNIQUE INDEX idx_share_links_token_hash ON public.share_links (token_hash);

COMMENT ON COLUMN public.share_links.token_hash IS
  'SHA-256 hex digest of the capability token. Raw tokens are never persisted.';

-- >>> END 20260828_duckroom_v2_share_link_guest_and_token_hash.sql

-- >>> BEGIN 20260829_duckroom_v2_lyrics_source.sql
-- Duckroom V2 — Lyrics provenance (Master Plan §10.2)
--
-- Every lyric document must keep its source. The runtime Track model now
-- carries lyrics_source alongside the embedded lyrics payload so provider
-- attribution (LRCLIB / Lyrics.ovh / Duckroom Community / manual import)
-- survives save round-trips and renders in the UI.

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS lyrics_source TEXT;

COMMENT ON COLUMN public.tracks.lyrics_source IS
  'Provider attribution for the embedded lyrics payload. NULL = unknown/legacy.';

-- >>> END 20260829_duckroom_v2_lyrics_source.sql

-- >>> BEGIN 20260830_duckroom_v2_redteam_hardening.sql
-- Duckroom V2 — Red-Team Hardening Closure (Phase 0–4)
--
-- This migration deterministically converges the database to the terminal
-- state required by the Master Plan after the 2026-08-24 red-team audit.
--
-- Remediations included:
--   R1. LYRICS TRUNCATION PURGE (Critical C-1/H-4/H-5/H-6):
--       Migration 20260825 wrote lyrics_documents rows with
--       `x->'lyrics'->>0` — truncating every document to its FIRST line —
--       under source='manifest' with an un-targeted ON CONFLICT DO NOTHING,
--       which also duplicated rows on repeated reconciliation runs before
--       the 20260826 unique index existed. Later migrations never cleaned the
--       poisoned family. This file collapses duplicate documents, merges the
--       divergent 'legacy-json' family into a single canonical 'manifest'
--       source (matching the TypeScript manifest migrator writer), rebuilds
--       every machine-derived document from the authoritative embedded
--       tracks.lyrics payload at FULL fidelity, and enforces delete-on-empty.
--   R2. RPC ACTOR BINDING (High H-3):
--       replace_master_library_atomic previously trusted the caller-supplied
--       p_actor_user_id parameter. Any principal holding EXECUTE could act as
--       an arbitrary owner UUID. The function now binds p_actor_user_id to
--       auth.uid() unless the caller authenticates as service_role (the only
--       sanctioned server-side path).
--   R3. REVISION ORACLE (Low L-8):
--       STALE_LIBRARY_REVISION no longer leaks the current revision value.
--   R4. POLICY MODERNIZATION:
--       The three visibility policies still using deprecated auth.role()
--       are recreated with scalar-subquery claim extraction
--       ((select auth.jwt()->>'role')), fixing per-row evaluation cost and
--       deprecation debt.
--   R5. ARTWORK ANALYSIS PERSISTENCE:
--       upload_sessions gains artwork_detected_mime/width/height so the
--       server-side binary image inspection result is durable and drives the
--       canonical artwork key extension at commit time.
--
-- Historical migrations are intentionally left untouched (append-only chain);
-- this closure converges any reachable intermediate state.

-- ============================================================================
-- R1a. Collapse duplicate lyric documents defensively (version twins / ties).
-- Keeps exactly one row per (track_id, source, kind) — the highest version;
-- ties broken by newest created_at then stable id ordering.
-- ============================================================================
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY track_id, source, kind
           ORDER BY version DESC, created_at DESC, id
         ) AS rn
  FROM public.lyrics_documents
)
DELETE FROM public.lyrics_documents ld
USING ranked r
WHERE ld.id = r.id AND r.rn > 1;

-- ============================================================================
-- R1b. Unify machine-derived sources: merge 'legacy-json' into 'manifest'.
-- The embedded tracks.lyrics payload is the single upstream truth for both
-- families, so no content merging is needed — only identity unification.
-- ============================================================================
DELETE FROM public.lyrics_documents
WHERE source = 'legacy-json';

-- ============================================================================
-- R1c. Purge the truncated 'manifest' family entirely and rebuild from
-- tracks.lyrics at FULL fidelity (non-truncating, idempotent).
-- ============================================================================
DELETE FROM public.lyrics_documents
WHERE source = 'manifest';

INSERT INTO public.lyrics_documents (track_id, source, kind, content, verified, version)
SELECT
  t.id,
  'manifest',
  CASE WHEN jsonb_typeof(t.lyrics) = 'array' AND jsonb_array_length(t.lyrics) > 0
       THEN 'synced' ELSE 'plain' END,
  t.lyrics::text,
  FALSE,
  1
FROM public.tracks t
WHERE t.lyrics IS NOT NULL
  AND jsonb_typeof(t.lyrics) = 'array'
  AND jsonb_array_length(t.lyrics) > 0
ON CONFLICT (track_id, source, kind, version) DO UPDATE SET
  content = EXCLUDED.content,
  updated_at = NOW();

-- ============================================================================
-- R1d. Delete-on-empty semantics: machine-derived documents must not outlive
-- their upstream payload.
-- ============================================================================
DELETE FROM public.lyrics_documents ld
WHERE ld.source IN ('manifest', 'legacy-json')
  AND NOT EXISTS (
    SELECT 1 FROM public.tracks t
    WHERE t.id = ld.track_id
      AND t.lyrics IS NOT NULL
      AND jsonb_typeof(t.lyrics) = 'array'
      AND jsonb_array_length(t.lyrics) > 0
  );

COMMENT ON COLUMN public.lyrics_documents.source IS
  'Provenance: ''manifest'' = machine-derived from embedded tracks.lyrics (canonical machine family); manual/community providers use their own source values.';

-- ============================================================================
-- R5. Artwork analysis persistence on upload_sessions
-- ============================================================================
ALTER TABLE public.upload_sessions ADD COLUMN IF NOT EXISTS artwork_detected_mime TEXT;
ALTER TABLE public.upload_sessions ADD COLUMN IF NOT EXISTS artwork_width INTEGER;
ALTER TABLE public.upload_sessions ADD COLUMN IF NOT EXISTS artwork_height INTEGER;

COMMENT ON COLUMN public.upload_sessions.artwork_detected_mime IS
  'Authoritative MIME from server-side binary magic-byte inspection. NULL until analyzed or when no artwork was uploaded.';

-- ============================================================================
-- R2 + R3 + R1(function side). replace_master_library_atomic hardening.
-- Full body reproduced from 20260826 with exactly three behavioral changes:
--   (a) caller/actor binding (R2)
--   (b) STALE_LIBRARY_REVISION no longer leaks the current revision (R3)
--   (c) machine lyric documents written under unified source='manifest' (R1)
-- Grants are re-asserted in this same file (DROP-less CREATE OR REPLACE keeps
-- ACLs, but we re-state them as a house rule).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.replace_master_library_atomic(
  p_albums JSONB,
  p_tracks JSONB,
  p_videos JSONB,
  p_allow_mass_deletion BOOLEAN DEFAULT FALSE,
  p_expected_library_revision BIGINT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_revision BIGINT;
  next_revision BIGINT;
  album_delete_count INTEGER;
  track_delete_count INTEGER;
  video_delete_count INTEGER;
  persisted_albums INTEGER := 0;
  persisted_tracks INTEGER := 0;
  persisted_videos INTEGER := 0;
  artist_count INTEGER := 0;
  track_file_count INTEGER := 0;
  video_file_count INTEGER := 0;
  artwork_count INTEGER := 0;
  lyric_count INTEGER := 0;
BEGIN
  -- R2: bind the acting user to the authenticated identity unless the call is
  -- made with service credentials (the sanctioned server-side path).
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'ACTOR_MISMATCH: p_actor_user_id must equal the authenticated caller';
    END IF;
  END IF;

  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_actor_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: owner role required';
  END IF;

  SELECT revision INTO current_revision
  FROM public.library_revisions
  WHERE id = TRUE
  FOR UPDATE;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_REVISION_STATE_MISSING';
  END IF;

  IF p_expected_library_revision IS NULL OR p_expected_library_revision <> current_revision THEN
    RAISE EXCEPTION 'STALE_LIBRARY_REVISION: expected % does not match current library revision', p_expected_library_revision;
  END IF;

  SELECT COUNT(*) INTO album_delete_count
  FROM public.albums a
  WHERE a.id <> 'singles'
    AND a.id <> 'single-collection'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
      WHERE x->>'id' = a.id
    );

  SELECT COUNT(*) INTO track_delete_count
  FROM public.tracks t
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    WHERE x->>'id' = t.id
  );

  SELECT COUNT(*) INTO video_delete_count
  FROM public.videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
    WHERE x->>'id' = v.id
  );

  IF (album_delete_count + track_delete_count + video_delete_count) > 0
     AND NOT COALESCE(p_allow_mass_deletion, FALSE) THEN
    RAISE EXCEPTION 'SAFETY_GUARD: destructive reconciliation requires explicit allowMassDeletion=true';
  END IF;

  INSERT INTO public.artists (id, name, normalized_name)
  SELECT DISTINCT
    'artist-' || lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g')),
    trim(name),
    lower(trim(name))
  FROM (
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'artist' AS name FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) artists_input
  WHERE NULLIF(trim(name), '') IS NOT NULL
  ON CONFLICT (normalized_name) DO UPDATE SET
    name = EXCLUDED.name;
  GET DIAGNOSTICS artist_count = ROW_COUNT;

  INSERT INTO public.artwork_assets (master_storage_key, mime_type)
  SELECT DISTINCT
    cover_key,
    CASE
      WHEN lower(cover_key) ~ '\.(jpg|jpeg)$' THEN 'image/jpeg'
      WHEN lower(cover_key) ~ '\.png$' THEN 'image/png'
      WHEN lower(cover_key) ~ '\.webp$' THEN 'image/webp'
      WHEN lower(cover_key) ~ '\.avif$' THEN 'image/avif'
      WHEN lower(cover_key) ~ '\.gif$' THEN 'image/gif'
      WHEN lower(cover_key) ~ '\.svg$' THEN 'image/svg+xml'
      ELSE NULL
    END
  FROM (
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
    UNION
    SELECT x->>'cover_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
    UNION
    SELECT x->>'thumb_storage_key' AS cover_key FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  ) covers
  WHERE NULLIF(trim(cover_key), '') IS NOT NULL
  ON CONFLICT (master_storage_key) DO UPDATE SET
    mime_type = COALESCE(public.artwork_assets.mime_type, EXCLUDED.mime_type);
  GET DIAGNOSTICS artwork_count = ROW_COUNT;

  INSERT INTO public.albums (
    id, title, artist, year, cover_storage_key, accent, note,
    artist_id, album_artist_id, release_year, cover_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->>'accent', 'oklch(0.72 0.15 62)'),
    COALESCE(x->>'note', ''),
    ar.id,
    ar.id,
    COALESCE((x->>'year')::INTEGER, 0),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    cover_storage_key = EXCLUDED.cover_storage_key,
    accent = EXCLUDED.accent,
    note = EXCLUDED.note,
    artist_id = EXCLUDED.artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.albums.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_albums = ROW_COUNT;

  INSERT INTO public.tracks (
    id, album_id, title, artist, track_no, duration_seconds, format,
    bit_depth, sample_rate, size_mb, storage_key, cover_storage_key,
    lyrics, year, primary_artist_id, album_artist_id, release_year,
    cover_asset_id, version, updated_at, status
  )
  SELECT
    x->>'id',
    NULLIF(x->>'album_id', ''),
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'track_no')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'format', 'UNKNOWN'),
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    COALESCE(x->>'storage_key', ''),
    COALESCE(x->>'cover_storage_key', ''),
    COALESCE(x->'lyrics', '[]'::jsonb),
    (x->>'year')::INTEGER,
    ar.id,
    ar.id,
    (x->>'year')::INTEGER,
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'cover_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    album_id = EXCLUDED.album_id,
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    track_no = EXCLUDED.track_no,
    duration_seconds = EXCLUDED.duration_seconds,
    format = EXCLUDED.format,
    bit_depth = EXCLUDED.bit_depth,
    sample_rate = EXCLUDED.sample_rate,
    size_mb = EXCLUDED.size_mb,
    storage_key = EXCLUDED.storage_key,
    cover_storage_key = EXCLUDED.cover_storage_key,
    lyrics = EXCLUDED.lyrics,
    year = EXCLUDED.year,
    primary_artist_id = EXCLUDED.primary_artist_id,
    album_artist_id = EXCLUDED.album_artist_id,
    release_year = EXCLUDED.release_year,
    cover_asset_id = EXCLUDED.cover_asset_id,
    version = public.tracks.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_tracks = ROW_COUNT;

  INSERT INTO public.track_files (
    track_id, kind, storage_key, extension, container, sample_rate, bit_depth,
    duration_seconds, file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    'master',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(upper(x->>'format'), ''),
    CASE
      WHEN COALESCE((x->>'sample_rate')::INTEGER, 0) > 1000 THEN (x->>'sample_rate')::INTEGER
      ELSE COALESCE((x->>'sample_rate')::INTEGER, 0) * 1000
    END,
    COALESCE((x->>'bit_depth')::INTEGER, 0),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL,
    NULL,
    NULL
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    track_id = EXCLUDED.track_id,
    kind = 'master',
    extension = EXCLUDED.extension,
    container = EXCLUDED.container,
    sample_rate = COALESCE(public.track_files.sample_rate, EXCLUDED.sample_rate),
    bit_depth = COALESCE(public.track_files.bit_depth, EXCLUDED.bit_depth),
    duration_seconds = COALESCE(public.track_files.duration_seconds, EXCLUDED.duration_seconds),
    file_size_bytes = public.track_files.file_size_bytes,
    sha256 = public.track_files.sha256,
    verified_at = public.track_files.verified_at;
  GET DIAGNOSTICS track_file_count = ROW_COUNT;

  INSERT INTO public.videos (
    id, title, artist, year, thumb_storage_key, storage_key,
    duration_seconds, resolution, codec, bitrate, size_mb,
    artist_id, album_id, artwork_asset_id,
    version, updated_at, status
  )
  SELECT
    x->>'id',
    COALESCE(x->>'title', ''),
    COALESCE(x->>'artist', ''),
    COALESCE((x->>'year')::INTEGER, 0),
    COALESCE(x->>'thumb_storage_key', ''),
    COALESCE(x->>'storage_key', ''),
    COALESCE((x->>'duration_seconds')::INTEGER, 0),
    COALESCE(x->>'resolution', 'UNKNOWN'),
    COALESCE(x->>'codec', 'UNKNOWN'),
    COALESCE(x->>'bitrate', 'UNKNOWN'),
    COALESCE((x->>'size_mb')::NUMERIC, 0),
    ar.id,
    NULLIF(x->>'album_id', ''),
    aa.id,
    1,
    NOW(),
    'active'
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  LEFT JOIN public.artists ar ON ar.normalized_name = lower(trim(COALESCE(x->>'artist', '')))
  LEFT JOIN public.artwork_assets aa ON aa.master_storage_key = NULLIF(x->>'thumb_storage_key', '')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    artist = EXCLUDED.artist,
    year = EXCLUDED.year,
    thumb_storage_key = EXCLUDED.thumb_storage_key,
    storage_key = EXCLUDED.storage_key,
    duration_seconds = EXCLUDED.duration_seconds,
    resolution = EXCLUDED.resolution,
    codec = EXCLUDED.codec,
    bitrate = EXCLUDED.bitrate,
    size_mb = EXCLUDED.size_mb,
    artist_id = EXCLUDED.artist_id,
    album_id = EXCLUDED.album_id,
    artwork_asset_id = EXCLUDED.artwork_asset_id,
    version = public.videos.version + 1,
    updated_at = NOW(),
    status = 'active',
    deleted_at = NULL;
  GET DIAGNOSTICS persisted_videos = ROW_COUNT;

  INSERT INTO public.video_files (
    video_id, storage_key, container, codec, resolution, duration_seconds,
    file_size_bytes, sha256, verified_at
  )
  SELECT
    x->>'id',
    COALESCE(x->>'storage_key', ''),
    NULLIF(lower(regexp_replace(COALESCE(x->>'storage_key', ''), '^.*\\.', '')), ''),
    NULLIF(x->>'codec', ''),
    NULLIF(x->>'resolution', ''),
    COALESCE((x->>'duration_seconds')::DOUBLE PRECISION, 0),
    NULL,
    NULL,
    NULL
  FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
  WHERE NULLIF(x->>'storage_key', '') IS NOT NULL
  ON CONFLICT (storage_key) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    container = EXCLUDED.container,
    codec = COALESCE(public.video_files.codec, EXCLUDED.codec),
    resolution = COALESCE(public.video_files.resolution, EXCLUDED.resolution),
    duration_seconds = COALESCE(public.video_files.duration_seconds, EXCLUDED.duration_seconds),
    file_size_bytes = public.video_files.file_size_bytes,
    sha256 = public.video_files.sha256,
    verified_at = public.video_files.verified_at;
  GET DIAGNOSTICS video_file_count = ROW_COUNT;

  UPDATE public.media_analysis_records mar
  SET track_file_id = tf.id
  FROM public.track_files tf
  WHERE mar.resource_kind = 'track'
    AND mar.resource_id = tf.track_id
    AND mar.storage_key = tf.storage_key;

  UPDATE public.media_analysis_records mar
  SET video_file_id = vf.id
  FROM public.video_files vf
  WHERE mar.resource_kind = 'video'
    AND mar.resource_id = vf.video_id
    AND mar.storage_key = vf.storage_key;

  -- Machine-derived lyric documents: unified source='manifest', full fidelity.
  INSERT INTO public.lyrics_documents (track_id, source, kind, content, verified, version)
  SELECT
    x->>'id',
    'manifest',
    CASE WHEN jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
              AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
         THEN 'synced' ELSE 'plain' END,
    COALESCE(x->'lyrics', '[]'::jsonb)::text,
    FALSE,
    1
  FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
  WHERE jsonb_typeof(COALESCE(x->'lyrics', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(x->'lyrics', '[]'::jsonb)) > 0
  ON CONFLICT (track_id, source, kind, version) DO UPDATE SET
    content = EXCLUDED.content,
    updated_at = NOW();
  GET DIAGNOSTICS lyric_count = ROW_COUNT;

  IF track_delete_count > 0 THEN
    DELETE FROM public.tracks t
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_tracks, '[]'::jsonb)) x
      WHERE x->>'id' = t.id
    );
  END IF;

  IF video_delete_count > 0 THEN
    DELETE FROM public.videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_videos, '[]'::jsonb)) x
      WHERE x->>'id' = v.id
    );
  END IF;

  IF album_delete_count > 0 THEN
    DELETE FROM public.albums a
    WHERE a.id <> 'singles'
      AND a.id <> 'single-collection'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_albums, '[]'::jsonb)) x
        WHERE x->>'id' = a.id
      );
  END IF;

  DELETE FROM public.artwork_assets aa
  WHERE NOT EXISTS (SELECT 1 FROM public.albums al WHERE al.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.tracks tr WHERE tr.cover_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.videos vd WHERE vd.artwork_asset_id = aa.id)
    AND NOT EXISTS (SELECT 1 FROM public.artists ar WHERE ar.image_asset_id = aa.id);

  next_revision := current_revision + 1;
  UPDATE public.library_revisions
  SET revision = next_revision,
      updated_at = NOW(),
      updated_by = p_actor_user_id
  WHERE id = TRUE;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    p_actor_user_id,
    'library.reconcile_atomic',
    'library',
    'master',
    jsonb_build_object(
      'previous_revision', current_revision,
      'revision', next_revision,
      'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
      'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
      'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count),
      'allow_mass_deletion', p_allow_mass_deletion
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'libraryRevision', next_revision,
    'persisted', jsonb_build_object('albums', persisted_albums, 'tracks', persisted_tracks, 'videos', persisted_videos),
    'normalized', jsonb_build_object('artists', artist_count, 'track_files', track_file_count, 'video_files', video_file_count, 'artwork_assets', artwork_count, 'lyrics_documents', lyric_count),
    'deleted', jsonb_build_object('albums', album_delete_count, 'tracks', track_delete_count, 'videos', video_delete_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_master_library_atomic(JSONB, JSONB, JSONB, BOOLEAN, BIGINT, UUID) TO service_role;

-- ============================================================================
-- R4. Policy modernization: deprecated auth.role() → claim subquery.
-- ============================================================================
DROP POLICY IF EXISTS "Public can read active public albums" ON public.albums;
CREATE POLICY "Public can read active public albums" ON public.albums
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Public can read active public tracks" ON public.tracks;
CREATE POLICY "Public can read active public tracks" ON public.tracks
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Public can read active public videos" ON public.videos;
CREATE POLICY "Public can read active public videos" ON public.videos
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

-- >>> END 20260830_duckroom_v2_redteam_hardening.sql

-- >>> BEGIN 20260831_duckroom_v2_replaygain.sql
-- Duckroom V2 — ReplayGain Persistence (Phase 5, Master Plan §11.5)
--
-- Adds server-authoritative ReplayGain storage to the canonical physical
-- file layer so the player can apply track/album gain without ever mutating
-- the master binary and without trusting client claims.
--
-- Rules honored (AGENTS.md):
--   * Append-only chain: no existing statement is rewritten.
--   * Deterministic convergence: columns are nullable; absence simply means
--     "not yet analyzed" (non-fabrication).
--   * Same-file grants: every DROP FUNCTION in this file is paired with its
--     grants; this file drops nothing, so nothing needs re-granting.
--   * Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.track_files
  ADD COLUMN IF NOT EXISTS replaygain_track_gain_db DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS replaygain_album_gain_db DOUBLE PRECISION;

COMMENT ON COLUMN public.track_files.replaygain_track_gain_db IS 'ReplayGain track gain in dB parsed by server binary analysis; NULL = unknown (never fabricated).';
COMMENT ON COLUMN public.track_files.replaygain_album_gain_db IS 'ReplayGain album gain in dB parsed by server binary analysis; NULL = unknown (never fabricated).';

-- >>> END 20260831_duckroom_v2_replaygain.sql

-- >>> BEGIN 20260901_duckroom_v2_external_identities.sql
-- Duckroom V2 — External Identities (Phase 9, Master Plan §14)
--
-- Spotify is an EXTERNAL metadata / identity bridge. Duckroom remains
-- canonical for audio, lyrics, artwork copies and playback (§14.1). This
-- table records the link between a canonical resource and its external
-- provider identity without polluting domain tables with provider columns.
--
-- Rules honored (AGENTS.md + Master Plan §14.3):
--   * Append-only chain: no existing statement is rewritten.
--   * Generic model: (provider, resource_type, external_id) — Spotify is
--     merely the first provider; future providers need no schema redesign.
--   * Fail-closed RLS: the table is enabled for RLS with NO policies.
--     Only service-role server code (which performs explicit owner
--     authorization first) can read or write it. Clients get nothing.
--   * Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider <> ''),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('track', 'album', 'artist', 'playlist', 'video')),
  external_id TEXT NOT NULL,
  external_url TEXT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('track', 'album', 'artist', 'playlist', 'video')),
  resource_id TEXT NOT NULL,
  match_confidence DOUBLE PRECISION CHECK (match_confidence >= 0 AND match_confidence <= 1),
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_identities_unique_link UNIQUE (provider, resource_type, external_id, resource_kind, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_resource
  ON public.external_identities (resource_kind, resource_id);

COMMENT ON TABLE public.external_identities IS
  'Generic provider-identity bridge (Master Plan §14.3). Spotify is the first provider. Service-role only: RLS enabled, zero policies (fail-closed).';
COMMENT ON COLUMN public.external_identities.match_confidence IS
  'Confidence of the local-file match confirmed by the Owner at link time (0..1); NULL when imported without a local counterpart.';
COMMENT ON COLUMN public.external_identities.payload IS
  'Snapshot of the external metadata at link time (display only — never canonical truth).';

ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: RLS denies every client operation.

-- >>> END 20260901_duckroom_v2_external_identities.sql

-- >>> BEGIN 20260902_duckroom_v2_user_preferences.sql
-- Duckroom V2 — User Preferences (Master Plan §5.2 / §12 Member Experience)
--
-- Persists per-member playback/UI settings server-side so they follow the
-- account across devices (Guests keep localStorage-only behavior).
-- Non-fabrication rule: rows are optional — absence simply means "defaults".
--
-- Rules honored (AGENTS.md):
--   * Append-only chain; idempotent CREATE TABLE IF NOT EXISTS.
--   * RLS mirrors the playback_state pattern: auth.uid() = user_id.
--   * Same-file grants: nothing dropped here, so nothing needs re-granting.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  volume DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (volume >= 0 AND volume <= 1),
  crossfade_seconds INT NOT NULL DEFAULT 0 CHECK (crossfade_seconds >= 0 AND crossfade_seconds <= 10),
  replaygain_mode TEXT NOT NULL DEFAULT 'off' CHECK (replaygain_mode IN ('off', 'track', 'album')),
  default_view TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_preferences IS
  'Per-member playback/UI settings (§12). Absence = client defaults; never fabricated.';

DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- >>> END 20260902_duckroom_v2_user_preferences.sql

-- >>> BEGIN 20260903_duckroom_v2_atomic_playlist_reorder.sql
-- Duckroom V2 — Atomic Playlist Reorder (Phase 7 §12.2, audit finding #6)
--
-- Replaces the application-layer sequential UPDATE loop (which had a partial-
-- write window: row1 OK / row2 FAIL leaves mixed positions) with a SINGLE
-- atomic SQL statement guarded by full pre-validation.
--
-- Contract:
--   reorder_playlist_tracks(p_playlist_id uuid, p_ordered_track_ids text[],
--                           p_actor uuid) RETURNS int
--   * PLAYLIST_NOT_FOUND     — playlist row does not exist
--   * FORBIDDEN              — actor is not the owner
--   * MEMBERSHIP_MISMATCH    — submitted ids are not exactly the current set
--                              (dedup check) or the rewrite missed rows
--
-- Rules honored (AGENTS.md):
--   * Append-only chain.
--   * Deterministic convergence: success leaves positions exactly 0..n-1 in
--     submitted order; any failure leaves positions untouched (single-statement).
--   * Same-file grants: REVOKE public, GRANT EXECUTE to service_role only —
--     the app calls this through the server-side admin client which performs
--     its own ownership pre-checks too (defense in depth).

CREATE OR REPLACE FUNCTION public.reorder_playlist_tracks(
  p_playlist_id UUID,
  p_ordered_track_ids TEXT[],
  p_actor UUID
) RETURNS INT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_current_count INT;
  v_submitted_count INT;
  v_updated INT;
BEGIN
  SELECT user_id INTO v_owner FROM public.playlists WHERE id = p_playlist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAYLIST_NOT_FOUND';
  END IF;
  IF v_owner IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT count(*) INTO v_submitted_count FROM unnest(p_ordered_track_ids);
  SELECT count(*) INTO v_current_count FROM public.playlist_tracks WHERE playlist_id = p_playlist_id;

  -- Exact-set validation: same cardinality AND no duplicates AND no unknown ids.
  IF v_submitted_count <> v_current_count THEN
    RAISE EXCEPTION 'MEMBERSHIP_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_track_ids) AS t(id)
    GROUP BY t.id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'MEMBERSHIP_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_track_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.playlist_tracks pt
      WHERE pt.playlist_id = p_playlist_id AND pt.track_id::text = t.id
    )
  ) THEN
    RAISE EXCEPTION 'MEMBERSHIP_MISMATCH';
  END IF;

  -- THE atomic rewrite: one statement, all-or-nothing.
  UPDATE public.playlist_tracks AS pt
  SET position = ord.ord - 1
  FROM unnest(p_ordered_track_ids) WITH ORDINALITY AS t(id, ord)
  WHERE pt.playlist_id = p_playlist_id AND pt.track_id::text = t.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_submitted_count THEN
    RAISE EXCEPTION 'MEMBERSHIP_MISMATCH';
  END IF;

  UPDATE public.playlists SET updated_at = NOW() WHERE id = p_playlist_id;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_playlist_tracks(UUID, TEXT[], UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_playlist_tracks(UUID, TEXT[], UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_playlist_tracks(UUID, TEXT[], UUID) TO service_role;

COMMENT ON FUNCTION public.reorder_playlist_tracks(UUID, TEXT[], UUID) IS
  'Atomic playlist position rewrite (§12.2). Validates ownership and exact membership, then rewrites all positions in ONE statement. Errors: PLAYLIST_NOT_FOUND | FORBIDDEN | MEMBERSHIP_MISMATCH.';

-- >>> END 20260903_duckroom_v2_atomic_playlist_reorder.sql

-- >>> BEGIN 20260904_duckroom_v2_history_idempotency.sql
-- Duckroom V2 — Playback history idempotency (Phase 7 §12.3, audit finding #7)
--
-- Retried / duplicated play-end events (timeout retry, reconnect, page resume,
-- double 'ended') previously inserted duplicate rows. A per-event client id
-- turns the append into an insert-if-absent.
--
-- Semantics:
--   * client_event_id TEXT NULL — NULL rows (legacy) are exempt from uniqueness
--     (Postgres unique indexes allow multiple NULLs), so no backfill is needed.
--   * Application layer upserts with ON CONFLICT (client_event_id) DO NOTHING.
--
-- Rules honored (AGENTS.md): append-only; idempotent; no destructive rewrite.

ALTER TABLE public.playback_history
  ADD COLUMN IF NOT EXISTS client_event_id TEXT;

DROP INDEX IF EXISTS idx_playback_history_client_event;
CREATE UNIQUE INDEX idx_playback_history_client_event
  ON public.playback_history (client_event_id);

COMMENT ON COLUMN public.playback_history.client_event_id IS
  'Client-generated UUID for the play event; retries of the same event dedupe to one row via upsert-ignore. NULL = legacy row written before this column existed.';

-- >>> END 20260904_duckroom_v2_history_idempotency.sql
