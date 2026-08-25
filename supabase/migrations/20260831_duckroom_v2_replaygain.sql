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
