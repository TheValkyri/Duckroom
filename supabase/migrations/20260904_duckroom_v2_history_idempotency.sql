-- Duckroom V2 — Playback history idempotency (Phase 7 §12.3, audit finding #7)
--
-- Retried / duplicated play-end events (timeout retry, reconnect, page resume,
-- double 'ended') previously inserted duplicate rows. A per-event client id
-- turns the append into an insert-if-absent.
--
-- Semantics:
--   * client_event_id TEXT NULL — NULL rows (legacy) are exempt from uniqueness
--     (Postgres unique indexes allow multiple NULLs), so no backfill is needed.
--   * Application layer upserts with ON CONFLICT (client_event_id) DO NOTHING.
--
-- Rules honored (AGENTS.md): append-only; idempotent; no destructive rewrite.

ALTER TABLE public.playback_history
  ADD COLUMN IF NOT EXISTS client_event_id TEXT;

DROP INDEX IF EXISTS idx_playback_history_client_event;
CREATE UNIQUE INDEX idx_playback_history_client_event
  ON public.playback_history (client_event_id);

COMMENT ON COLUMN public.playback_history.client_event_id IS
  'Client-generated UUID for the play event; retries of the same event dedupe to one row via upsert-ignore. NULL = legacy row written before this column existed.';
