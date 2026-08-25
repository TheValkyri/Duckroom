-- Duckroom V2 Domain Mutations, CAS Concurrency, and Lifecycle Migration.
-- Adds versioning, updated_at tracking, safe status lifecycle, and visibility-aware RLS to canonical entities.

-- 1. Albums enhancements
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_albums_status ON public.albums (status);

-- 2. Tracks enhancements
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tracks_status ON public.tracks (status);

-- 3. Videos enhancements
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trash', 'archived'));
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_videos_status ON public.videos (status);

-- 4. Row Level Security Policies (Visibility + Lifecycle + Owner Admin)

-- Albums Policies
DROP POLICY IF EXISTS "Public can read albums" ON public.albums;
DROP POLICY IF EXISTS "Members can view albums" ON public.albums;
DROP POLICY IF EXISTS "Admins can manage albums" ON public.albums;
DROP POLICY IF EXISTS "Owners can manage albums" ON public.albums;

CREATE POLICY "Public can read active public albums" ON public.albums
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage albums" ON public.albums
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Tracks Policies
DROP POLICY IF EXISTS "Public can read tracks" ON public.tracks;
DROP POLICY IF EXISTS "Members can view tracks" ON public.tracks;
DROP POLICY IF EXISTS "Admins can manage tracks" ON public.tracks;
DROP POLICY IF EXISTS "Owners can manage tracks" ON public.tracks;

CREATE POLICY "Public can read active public tracks" ON public.tracks
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage tracks" ON public.tracks
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Videos Policies
DROP POLICY IF EXISTS "Public can read videos" ON public.videos;
DROP POLICY IF EXISTS "Members can view videos" ON public.videos;
DROP POLICY IF EXISTS "Admins can manage videos" ON public.videos;
DROP POLICY IF EXISTS "Owners can manage videos" ON public.videos;

CREATE POLICY "Public can read active public videos" ON public.videos
  FOR SELECT USING (
    status = 'active' AND (
      visibility = 'public'
      OR (auth.role() = 'authenticated' AND visibility = 'members')
      OR public.current_duckroom_role() = 'owner'
    )
  );

CREATE POLICY "Owners can manage videos" ON public.videos
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');
