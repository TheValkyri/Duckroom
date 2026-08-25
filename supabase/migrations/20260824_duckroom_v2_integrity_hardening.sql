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
