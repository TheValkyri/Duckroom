-- Duckroom V2 — Social Profiles (Friends Plan §3 & §33)
--
-- Extends public.profiles with durable identity and privacy fields:
--   * handle: unique lowercase handle for discovery (e.g. @duck_8f3q2m)
--   * avatar_storage_key: S3 storage key resolved via short-lived signed URLs
--   * friend_code: unique uppercase code (e.g. DUCK-XXXX-XXXX)
--   * presence_visibility: 'friends' | 'none'
--   * listening_visibility: 'friends' | 'none'
--   * updated_at: timestamp tracking profile changes
--
-- Backfill strategy (§34):
--   * Preserves existing display_name
--   * Generates deterministic/random unique handles (duck_XXXXXX) and friend codes (DUCK-XXXX-XXXX)
--   * Never fabricates human names; leaves avatar null.

-- 1. Add columns idempotently (without NOT NULL initially to allow backfill)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS presence_visibility TEXT NOT NULL DEFAULT 'friends';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS listening_visibility TEXT NOT NULL DEFAULT 'friends';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Generator helper functions for handles and friend codes
CREATE OR REPLACE FUNCTION public.generate_duck_handle_candidate(seed_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'duck_' || lower(substr(md5(random()::text || clock_timestamp()::text || coalesce(seed_id::text, gen_random_uuid()::text)), 1, 6));
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_duck_friend_code_candidate(seed_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'DUCK-' || upper(substr(md5(random()::text || clock_timestamp()::text || coalesce(seed_id::text, gen_random_uuid()::text) || '1'), 1, 4))
         || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || coalesce(seed_id::text, gen_random_uuid()::text) || '2'), 1, 4));
END;
$$;

-- 3. Backfill existing profiles missing handle or friend_code
DO $$
DECLARE
  r RECORD;
  new_handle TEXT;
  new_code TEXT;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles WHERE handle IS NULL OR friend_code IS NULL LOOP
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = r.user_id AND handle IS NULL) THEN
      LOOP
        new_handle := public.generate_duck_handle_candidate(r.user_id);
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE handle = new_handle) THEN
          UPDATE public.profiles SET handle = new_handle WHERE user_id = r.user_id;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = r.user_id AND friend_code IS NULL) THEN
      LOOP
        new_code := public.generate_duck_friend_code_candidate(r.user_id);
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = new_code) THEN
          UPDATE public.profiles SET friend_code = new_code WHERE user_id = r.user_id;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 4. Enforce NOT NULL constraints once backfilled
ALTER TABLE public.profiles ALTER COLUMN handle SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN friend_code SET NOT NULL;

-- 5. Set default expressions for future inserts
ALTER TABLE public.profiles ALTER COLUMN handle SET DEFAULT public.generate_duck_handle_candidate(gen_random_uuid());
ALTER TABLE public.profiles ALTER COLUMN friend_code SET DEFAULT public.generate_duck_friend_code_candidate(gen_random_uuid());

-- 6. Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique ON public.profiles(lower(handle));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_friend_code_unique ON public.profiles(upper(friend_code));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON public.profiles(handle);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_friend_code ON public.profiles(friend_code);

-- 7. Constraints for format validation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_profiles_handle_format' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_profiles_handle_format
      CHECK (handle ~ '^[a-z0-9_.]{3,24}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_profiles_friend_code_format' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_profiles_friend_code_format
      CHECK (friend_code ~ '^DUCK-[A-Z0-9]{4}-[A-Z0-9]{4}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_profiles_presence_visibility' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_profiles_presence_visibility
      CHECK (presence_visibility IN ('friends', 'none', 'nobody', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_profiles_listening_visibility' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT check_profiles_listening_visibility
      CHECK (listening_visibility IN ('friends', 'none', 'nobody', 'public'));
  END IF;
END $$;

-- 8. Update handle_new_duckroom_user trigger to populate handle and friend_code cleanly
CREATE OR REPLACE FUNCTION public.handle_new_duckroom_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cand_handle TEXT;
  cand_code TEXT;
BEGIN
  LOOP
    cand_handle := public.generate_duck_handle_candidate(NEW.id);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE handle = cand_handle);
  END LOOP;

  LOOP
    cand_code := public.generate_duck_friend_code_candidate(NEW.id);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = cand_code);
  END LOOP;

  INSERT INTO public.profiles (user_id, email, handle, friend_code)
  VALUES (NEW.id, LOWER(COALESCE(NEW.email, 'unknown@example.invalid')), cand_handle, cand_code)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 9. Row Level Security policies
-- Users can update their own profile fields (display_name, handle, avatar_storage_key, privacy settings)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON COLUMN public.profiles.handle IS 'Unique lowercase social handle (3-24 chars) for friend search (§3)';
COMMENT ON COLUMN public.profiles.avatar_storage_key IS 'S3 storage key for avatar visual asset, resolved to signed URL (§6)';
COMMENT ON COLUMN public.profiles.friend_code IS 'Unique alphanumeric discovery code (DUCK-XXXX-XXXX) (§3)';
COMMENT ON COLUMN public.profiles.presence_visibility IS 'Presence visibility setting: friends or none (§10)';
COMMENT ON COLUMN public.profiles.listening_visibility IS 'Listening activity visibility setting: friends or none (§10)';
