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
