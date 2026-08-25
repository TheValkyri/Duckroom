-- Duckroom V2 — Lyrics provenance (Master Plan §10.2)
--
-- Every lyric document must keep its source. The runtime Track model now
-- carries lyrics_source alongside the embedded lyrics payload so provider
-- attribution (LRCLIB / Lyrics.ovh / Duckroom Community / manual import)
-- survives save round-trips and renders in the UI.

ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS lyrics_source TEXT;

COMMENT ON COLUMN public.tracks.lyrics_source IS
  'Provider attribution for the embedded lyrics payload. NULL = unknown/legacy.';
