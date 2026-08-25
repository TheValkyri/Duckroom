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
