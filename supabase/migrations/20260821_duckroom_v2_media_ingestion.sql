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
