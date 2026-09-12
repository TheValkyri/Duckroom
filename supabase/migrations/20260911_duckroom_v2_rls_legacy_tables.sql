-- Duckroom V2 — Enable RLS on legacy v1 core tables (tracks / albums / videos)
--
-- CONTEXT (P0 security finding, verified 2026-09-11):
--   The migration chain issues `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
--   for every V2 table it creates, but tracks/albums/videos are legacy v1
--   tables that predate the chain (see schema.sql "LEGACY BASELINE NOTE AD-16").
--   The chain ALTERs them and even creates SELECT/ALL policies on them
--   (20260821 domain_mutations, modernized by 20260830 R4), but NEVER enabled
--   RLS — and policies are inert unless RLS is enabled. Any holder of the
--   anon key could therefore read AND write all three core tables directly
--   through the PostgREST surface.
--
-- REMEDIATION:
--   Enable RLS on the three legacy tables. The existing policies
--   ("Public can read active public ..." + "Owners can manage ...") become
--   enforceable immediately:
--     - anon reads only rows with status='active' AND visibility='public'
--     - authenticated members additionally read visibility='members' rows
--     - only owner-role principals (or service_role, which bypasses RLS)
--       may mutate
--
-- COMPATIBILITY:
--   All Duckroom application traffic runs through the server-side admin
--   (service-role) client, which bypasses RLS by design — enabling RLS
--   changes nothing for the app and only closes the direct anon-REST hole.
--   No FORCE ROW LEVEL SECURITY is applied, preserving the sanctioned
--   server-side service-role path (AD-16 / §22.4).
--
-- VERIFICATION (run after applying on live Supabase):
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('tracks','albums','videos');  -- expect relrowsecurity = true ×3
--   As anon: POST/PATCH to /rest/v1/tracks must 403/404;
--   SELECT on /rest/v1/tracks must only return active+public rows.

-- ============================================================================
-- Enable RLS on the legacy v1 core tables (idempotent by nature: ENABLE
-- ROW LEVEL SECURITY is a no-op when already enabled).
-- ============================================================================

ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Safety net: if the live baseline pre-dates the 20260830 R4 policy
-- modernization (or a policy was dropped), re-create the canonical policy
-- set here so enabling RLS can never lock the public read path out entirely.
--   - SELECT policies: exact bodies from 20260830 R4 (jwt claim subquery)
--   - ALL policies:   exact bodies from 20260821 domain_mutations
-- DROP + CREATE makes the migration self-contained and idempotent.
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

DROP POLICY IF EXISTS "Owners can manage albums" ON public.albums;
CREATE POLICY "Owners can manage albums" ON public.albums
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Public can read active public tracks" ON public.tracks;
CREATE POLICY "Public can read active public tracks" ON public.tracks
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage tracks" ON public.tracks;
CREATE POLICY "Owners can manage tracks" ON public.tracks
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Public can read active public videos" ON public.videos;
CREATE POLICY "Public can read active public videos" ON public.videos
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR ((select auth.jwt()->>'role') = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage videos" ON public.videos;
CREATE POLICY "Owners can manage videos" ON public.videos
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');
