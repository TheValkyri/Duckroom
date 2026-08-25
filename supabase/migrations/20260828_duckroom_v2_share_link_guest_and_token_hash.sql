-- Duckroom V2 — Share links: guest-capable creation + hash-at-rest tokens
--
-- Fix 1 (P1): Guest share-link creation was structurally impossible.
--   createShareLinkServer inserts created_by = NULL for anonymous users, but
--   the column was declared NOT NULL REFERENCES auth.users(id). Master Plan
--   §1.3 grants Guests the ability to share public content, so the constraint
--   must allow an anonymous creator.
--
-- Fix 2 (P2 hardening): Share tokens were stored in plaintext. A database leak
--   would expose every live capability URL. Tokens are now stored as SHA-256
--   hex digests (token_hash). The raw token is shown exactly once at creation
--   time and never persisted. Lookup paths resolve by hashing the presented
--   token instead of plaintext equality.
--
-- The legacy `token` column is kept temporarily for rollback safety and is
-- deprecated; it will be dropped in a future cleanup migration once all
-- environments run the hashed-token application build.

-- ---------------------------------------------------------------------------
-- Fix 1: anonymous creators are allowed (service-role writes only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.share_links ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN public.share_links.created_by IS
  'auth.users.id of the member/owner that created the link. NULL when minted anonymously by a Guest for public content.';

-- ---------------------------------------------------------------------------
-- Fix 2: SHA-256 hash-at-rest capability tokens
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.share_links ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- Backfill existing rows from their legacy plaintext tokens so no link dies.
UPDATE public.share_links
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.share_links ALTER COLUMN token_hash SET NOT NULL;

DROP INDEX IF EXISTS idx_share_links_token_hash;
CREATE UNIQUE INDEX idx_share_links_token_hash ON public.share_links (token_hash);

COMMENT ON COLUMN public.share_links.token_hash IS
  'SHA-256 hex digest of the capability token. Raw tokens are never persisted.';
