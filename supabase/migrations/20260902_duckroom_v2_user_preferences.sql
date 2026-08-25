-- Duckroom V2 — User Preferences (Master Plan §5.2 / §12 Member Experience)
--
-- Persists per-member playback/UI settings server-side so they follow the
-- account across devices (Guests keep localStorage-only behavior).
-- Non-fabrication rule: rows are optional — absence simply means "defaults".
--
-- Rules honored (AGENTS.md):
--   * Append-only chain; idempotent CREATE TABLE IF NOT EXISTS.
--   * RLS mirrors the playback_state pattern: auth.uid() = user_id.
--   * Same-file grants: nothing dropped here, so nothing needs re-granting.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  volume DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (volume >= 0 AND volume <= 1),
  crossfade_seconds INT NOT NULL DEFAULT 0 CHECK (crossfade_seconds >= 0 AND crossfade_seconds <= 10),
  replaygain_mode TEXT NOT NULL DEFAULT 'off' CHECK (replaygain_mode IN ('off', 'track', 'album')),
  default_view TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_preferences IS
  'Per-member playback/UI settings (§12). Absence = client defaults; never fabricated.';

DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;
CREATE POLICY "Users can manage own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
