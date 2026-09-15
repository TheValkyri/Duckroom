-- Duckroom V2 — Precomputed Waveform Peaks Persistence (Phase 2)
--
-- Adds 128-byte waveform peaks to the canonical physical track_files layer
-- so clients can render waveforms instantly without downloading full audio.
--
-- Rules honored (AGENTS.md):
--   * Append-only chain: no existing statement is rewritten.
--   * Deterministic convergence: nullable column.
--   * Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.track_files
  ADD COLUMN IF NOT EXISTS waveform_peaks SMALLINT[];

COMMENT ON COLUMN public.track_files.waveform_peaks IS 'Precomputed 128-point waveform peaks (0-255) for instant seekbar waveform rendering; NULL = not precomputed.';
