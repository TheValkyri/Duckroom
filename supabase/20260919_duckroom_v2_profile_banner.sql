-- Duckroom V2 — Profile Banner & Bio Extension
--
-- Adds support for Discord-style user profile customization:
--   * banner_storage_key: S3 storage key for profile cover banner (artwork/banners/...)
--   * banner_color: Hex color string fallback / background color for banner (e.g. #3b82f6)
--   * bio: Custom about-me text up to 300 characters
--

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banner_storage_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banner_color TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_profiles_bio_length' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_profiles_bio_length
      CHECK (bio IS NULL OR char_length(bio) <= 300);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.banner_storage_key IS 'S3 storage key for profile banner visual asset (artwork/banners/...)';
COMMENT ON COLUMN public.profiles.banner_color IS 'Hex color string for profile banner background';
COMMENT ON COLUMN public.profiles.bio IS 'User bio/about me text up to 300 characters';
