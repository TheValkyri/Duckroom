-- Duckroom V2 — Fix: library_revisions.updated_by
--
-- Bug: 20260826_duckroom_v2_canonical_integrity_closure.sql introduced
-- "UPDATE public.library_revisions SET ... updated_by = p_actor_user_id"
-- inside replace_master_library_atomic, but no prior migration ever created
-- the column. PL/pgSQL defers column resolution to execution time, so the
-- migration applied cleanly and every subsequent invocation of the RPC raised
-- SQLSTATE 42703 ("column \"updated_by\" of relation \"library_revisions\"
-- does not exist") — breaking the canonical full-library replacement path.
--
-- Fix: add the missing column so the shipped RPC body resolves correctly.
-- Nullable: the column is only ever written by replace_master_library_atomic.

ALTER TABLE public.library_revisions
  ADD COLUMN IF NOT EXISTS updated_by UUID;

COMMENT ON COLUMN public.library_revisions.updated_by IS
  'auth.users.id of the actor that last bumped the revision via replace_master_library_atomic.';
