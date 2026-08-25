-- Duckroom V2 foundation migration.
-- This migration establishes canonical user/profile data and member-owned
-- libraries without removing the legacy manifest tables yet.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duckroom_role') THEN
    CREATE TYPE public.duckroom_role AS ENUM ('member', 'owner');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.duckroom_role NOT NULL DEFAULT 'member',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.current_duckroom_role()
RETURNS public.duckroom_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cover_storage_key TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
  ON public.playlist_tracks (playlist_id, position);

CREATE TABLE IF NOT EXISTS public.playback_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES public.tracks(id) ON DELETE SET NULL,
  position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.playback_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  seconds_played DOUBLE PRECISION NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_playback_history_user_time
  ON public.playback_history (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('track', 'album', 'video', 'playlist')),
  resource_id TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_resource
  ON public.share_links (resource_type, resource_id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own favorites" ON public.user_favorites;
CREATE POLICY "Users can manage own favorites" ON public.user_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own playlists" ON public.playlists;
CREATE POLICY "Users can manage own playlists" ON public.playlists
  FOR ALL USING (auth.uid() = user_id OR public.current_duckroom_role() = 'owner')
  WITH CHECK (auth.uid() = user_id OR public.current_duckroom_role() = 'owner');

DROP POLICY IF EXISTS "Users can manage own playlist tracks" ON public.playlist_tracks;
CREATE POLICY "Users can manage own playlist tracks" ON public.playlist_tracks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND (p.user_id = auth.uid() OR public.current_duckroom_role() = 'owner'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_id AND (p.user_id = auth.uid() OR public.current_duckroom_role() = 'owner'))
  );

DROP POLICY IF EXISTS "Users can manage own playback state" ON public.playback_state;
CREATE POLICY "Users can manage own playback state" ON public.playback_state
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own playback history" ON public.playback_history;
CREATE POLICY "Users can manage own playback history" ON public.playback_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners manage audit logs" ON public.audit_logs;
CREATE POLICY "Owners manage audit logs" ON public.audit_logs
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Public master library is intentionally readable in the V2 model. Storage
-- objects remain private and are accessed through short-lived signed URLs.
DROP POLICY IF EXISTS "Public can read albums" ON public.albums;
CREATE POLICY "Public can read albums" ON public.albums FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read tracks" ON public.tracks;
CREATE POLICY "Public can read tracks" ON public.tracks FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public can read videos" ON public.videos;
CREATE POLICY "Public can read videos" ON public.videos FOR SELECT USING (TRUE);

-- Canonical profile role bootstrap. A real deployment should set
-- DUCKROOM_OWNER_EMAIL in server environment and assign the owner row once.
CREATE OR REPLACE FUNCTION public.handle_new_duckroom_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, LOWER(COALESCE(NEW.email, 'unknown@example.invalid')))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_duckroom ON auth.users;
CREATE TRIGGER on_auth_user_created_duckroom
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_duckroom_user();

-- Backfill profiles for users that already existed before this migration.
INSERT INTO public.profiles (user_id, email, role)
SELECT
  u.id,
  LOWER(COALESCE(u.email, 'unknown@example.invalid')),
  CASE WHEN COALESCE(a.is_admin, FALSE) THEN 'owner'::public.duckroom_role ELSE 'member'::public.duckroom_role END
FROM auth.users u
LEFT JOIN public.allowed_emails a ON LOWER(a.email) = LOWER(COALESCE(u.email, ''))
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email,
    role = CASE
      WHEN public.profiles.role = 'owner'::public.duckroom_role THEN public.profiles.role
      ELSE EXCLUDED.role
    END,
    updated_at = NOW();

-- Owners can administer profiles; members can read only their own profile.
DROP POLICY IF EXISTS "Owners can manage profiles" ON public.profiles;
CREATE POLICY "Owners can manage profiles" ON public.profiles
  FOR ALL USING (public.current_duckroom_role() = 'owner')
  WITH CHECK (public.current_duckroom_role() = 'owner');

-- Shares are private to their creator unless the resource is public. The share
-- token itself is intentionally non-guessable and is resolved server-side.
DROP POLICY IF EXISTS "Users can manage own share links" ON public.share_links;
CREATE POLICY "Users can manage own share links" ON public.share_links
  FOR ALL USING (auth.uid() = created_by OR public.current_duckroom_role() = 'owner')
  WITH CHECK (auth.uid() = created_by OR public.current_duckroom_role() = 'owner');

-- V2 metadata fields used by the canonical application model.
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS cover_storage_key TEXT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS year INT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'owner'));

CREATE INDEX IF NOT EXISTS idx_tracks_visibility ON public.tracks (visibility);
CREATE INDEX IF NOT EXISTS idx_albums_visibility ON public.albums (visibility);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON public.videos (visibility);
