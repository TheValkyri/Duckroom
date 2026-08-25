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
