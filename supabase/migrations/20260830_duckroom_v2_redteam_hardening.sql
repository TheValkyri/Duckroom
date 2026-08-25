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
