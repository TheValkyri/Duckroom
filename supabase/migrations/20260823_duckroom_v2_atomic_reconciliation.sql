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
