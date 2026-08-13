-- ========================================================
-- DUCKROOM SUPABASE DATABASE SCHEMA & RLS MIGRATION
-- ========================================================

-- 1. Bảng allowed_emails: Quản lý danh sách email được mời vào hội
CREATE TABLE IF NOT EXISTS public.allowed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Bảng albums: Quản lý các Album
CREATE TABLE IF NOT EXISTS public.albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INT NOT NULL,
  cover_storage_key TEXT NOT NULL,
  accent TEXT DEFAULT 'oklch(0.72 0.15 62)' NOT NULL,
  note TEXT DEFAULT '' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Bảng tracks: Quản lý bài hát FLAC / WAV
CREATE TABLE IF NOT EXISTS public.tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES public.albums(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  track_no INT NOT NULL DEFAULT 1,
  duration_seconds INT NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'FLAC',
  bit_depth INT NOT NULL DEFAULT 24,
  sample_rate INT NOT NULL DEFAULT 96,
  size_mb NUMERIC(10, 2) NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL, -- Đường dẫn object trong Pikamc S3
  lyrics JSONB DEFAULT '[]'::jsonb NOT NULL, -- Mảng [{time: number, text: string}]
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Bảng videos: Quản lý kho MV bản gốc 4K
CREATE TABLE IF NOT EXISTS public.videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INT NOT NULL,
  thumb_storage_key TEXT NOT NULL,
  storage_key TEXT NOT NULL, -- Đường dẫn object .mp4 trong Pikamc S3
  duration_seconds INT NOT NULL DEFAULT 0,
  resolution TEXT DEFAULT '3840 x 2160' NOT NULL,
  codec TEXT DEFAULT 'H.265' NOT NULL,
  bitrate TEXT DEFAULT '120 Mbps' NOT NULL,
  size_mb NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================================

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- Helper function: Kiểm tra xem user hiện tại có trong allowed_emails không
CREATE OR REPLACE FUNCTION public.is_member()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Kiểm tra xem user hiện tại có phải Admin không
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
      AND is_admin = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policy cho allowed_emails: Chỉ Admin xem được danh sách
CREATE POLICY "Admins can view allowed_emails" ON public.allowed_emails
  FOR SELECT USING (public.is_admin());

-- Policy cho albums: Member được SELECT, Admin được ALL
CREATE POLICY "Members can view albums" ON public.albums
  FOR SELECT USING (public.is_member());

CREATE POLICY "Admins can manage albums" ON public.albums
  FOR ALL USING (public.is_admin());

-- Policy cho tracks: Member được SELECT, Admin được ALL
CREATE POLICY "Members can view tracks" ON public.tracks
  FOR SELECT USING (public.is_member());

CREATE POLICY "Admins can manage tracks" ON public.tracks
  FOR ALL USING (public.is_admin());

-- Policy cho videos: Member được SELECT, Admin được ALL
CREATE POLICY "Members can view videos" ON public.videos
  FOR SELECT USING (public.is_member());

CREATE POLICY "Admins can manage videos" ON public.videos
  FOR ALL USING (public.is_admin());
