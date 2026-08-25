-- Duckroom V2 — External Identities (Phase 9, Master Plan §14)
--
-- Spotify is an EXTERNAL metadata / identity bridge. Duckroom remains
-- canonical for audio, lyrics, artwork copies and playback (§14.1). This
-- table records the link between a canonical resource and its external
-- provider identity without polluting domain tables with provider columns.
--
-- Rules honored (AGENTS.md + Master Plan §14.3):
--   * Append-only chain: no existing statement is rewritten.
--   * Generic model: (provider, resource_type, external_id) — Spotify is
--     merely the first provider; future providers need no schema redesign.
--   * Fail-closed RLS: the table is enabled for RLS with NO policies.
--     Only service-role server code (which performs explicit owner
--     authorization first) can read or write it. Clients get nothing.
--   * Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider <> ''),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('track', 'album', 'artist', 'playlist', 'video')),
  external_id TEXT NOT NULL,
  external_url TEXT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('track', 'album', 'artist', 'playlist', 'video')),
  resource_id TEXT NOT NULL,
  match_confidence DOUBLE PRECISION CHECK (match_confidence >= 0 AND match_confidence <= 1),
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_identities_unique_link UNIQUE (provider, resource_type, external_id, resource_kind, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identities_resource
  ON public.external_identities (resource_kind, resource_id);

COMMENT ON TABLE public.external_identities IS
  'Generic provider-identity bridge (Master Plan §14.3). Spotify is the first provider. Service-role only: RLS enabled, zero policies (fail-closed).';
COMMENT ON COLUMN public.external_identities.match_confidence IS
  'Confidence of the local-file match confirmed by the Owner at link time (0..1); NULL when imported without a local counterpart.';
COMMENT ON COLUMN public.external_identities.payload IS
  'Snapshot of the external metadata at link time (display only — never canonical truth).';

ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: RLS denies every client operation.
