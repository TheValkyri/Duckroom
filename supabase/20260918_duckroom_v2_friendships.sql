-- Duckroom V2 — Social Friendships (Friends Plan §8, §9, §33, §43)
--
-- Canonical undirected relationship table `friendships`:
--   * user_low_id < user_high_id enforced by CHECK constraint (single canonical row per user pair)
--   * status:
--       'pending_first_to_second'  (low requested high)
--       'pending_second_to_first'  (high requested low)
--       'accepted'                 (mutual friends)
--       'blocked_first_to_second'  (low blocked high)
--       'blocked_second_to_first'  (high blocked low)
--       'blocked_both'             (both blocked each other)
--   * action_user_id: user who initiated or last transitioned the relationship
--   * created_at, updated_at, accepted_at

CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  action_user_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  CONSTRAINT check_friendships_canonical_order CHECK (user_low_id < user_high_id),
  CONSTRAINT check_friendships_action_user CHECK (action_user_id = user_low_id OR action_user_id = user_high_id),
  CONSTRAINT check_friendships_status CHECK (
    status IN (
      'pending_first_to_second',
      'pending_second_to_first',
      'accepted',
      'blocked_first_to_second',
      'blocked_second_to_first',
      'blocked_both'
    )
  ),
  CONSTRAINT uq_friendships_canonical_pair UNIQUE (user_low_id, user_high_id)
);

-- Unique and lookup indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_canonical_pair ON public.friendships(user_low_id, user_high_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user_low ON public.friendships(user_low_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user_high ON public.friendships(user_high_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON public.friendships(status);
CREATE INDEX IF NOT EXISTS idx_friendships_action_user ON public.friendships(action_user_id);

-- Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION public.handle_friendships_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_friendships_updated_at ON public.friendships;
CREATE TRIGGER trigger_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_friendships_updated_at();

-- Row Level Security
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Select policy: users can only see friendships they participate in,
-- with blocking semantics (a blocked user cannot see the friendship row unless they are also a blocker):
DROP POLICY IF EXISTS "Users can view friendships they participate in" ON public.friendships;
CREATE POLICY "Users can view friendships they participate in" ON public.friendships
  FOR SELECT USING (
    (auth.uid() = user_low_id AND status != 'blocked_second_to_first')
    OR
    (auth.uid() = user_high_id AND status != 'blocked_first_to_second')
  );

-- Direct client mutation policies are disallowed (§19).
-- All mutations (request, accept, reject, cancel, remove, block, unblock)
-- must execute through server domain functions with session verification and rate limiting.
DROP POLICY IF EXISTS "Users can insert friendships they participate in" ON public.friendships;
DROP POLICY IF EXISTS "Users can update friendships they participate in" ON public.friendships;
DROP POLICY IF EXISTS "Users can delete friendships they participate in" ON public.friendships;

-- Ensure profiles remain private to row owners (§3, §7, §10, §31):
-- Members must not be able to dump all profiles or leak other users' emails via direct Supabase client queries.
DROP POLICY IF EXISTS "Members can view other profiles" ON public.profiles;

COMMENT ON TABLE public.friendships IS 'Canonical social relationship graph between members (§8)';
COMMENT ON COLUMN public.friendships.user_low_id IS 'Lesser UUID in canonical pair (user_low_id < user_high_id)';
COMMENT ON COLUMN public.friendships.user_high_id IS 'Greater UUID in canonical pair';
COMMENT ON COLUMN public.friendships.status IS 'pending_first_to_second, pending_second_to_first, accepted, blocked_first_to_second, blocked_second_to_first, blocked_both';
COMMENT ON COLUMN public.friendships.action_user_id IS 'User ID who initiated or last transitioned this relationship';
