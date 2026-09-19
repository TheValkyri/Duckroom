-- Duckroom V2 — Realtime Authorization for Social Presence (Friends Plan §20, §31, §33)
--
-- Authorization policy for private channel `social:user:<userId>`:
--   * Only the topic owner can publish activity (Presence / Broadcast).
--   * Only the topic owner and accepted friends can receive activity.
--   * Blocked relationships cannot receive activity.
--   * Users in Ghost Mode (presence_visibility = 'none') are hidden from friends.
--   * Uses RLS policies on Supabase's managed `realtime.messages` table.
--   * Note: The `realtime` schema and `realtime.messages` table are managed internally
--     by Supabase with RLS pre-enabled. Do not run CREATE TABLE or ALTER TABLE on them.

-- Helper function: verify if authenticated user can publish to topic
CREATE OR REPLACE FUNCTION public.can_publish_social_topic(topic text, auth_user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  topic_user_str text;
  topic_user_id uuid;
BEGIN
  IF auth_user IS NULL OR topic IS NULL THEN
    RETURN false;
  END IF;

  topic_user_str := substring(topic from '^social:user:([0-9a-fA-F-]{36})$');
  IF topic_user_str IS NULL THEN
    -- Non-social topics fall through to other policies or default deny
    RETURN false;
  END IF;

  BEGIN
    topic_user_id := topic_user_str::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Only owner can publish activity to their own topic (§20, §31)
  RETURN (topic_user_id = auth_user);
END;
$$;

-- Helper function: verify if authenticated user can receive from topic
CREATE OR REPLACE FUNCTION public.can_receive_social_topic(topic text, auth_user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  topic_user_str text;
  topic_user_id uuid;
  is_accepted boolean;
  visibility text;
BEGIN
  IF auth_user IS NULL OR topic IS NULL THEN
    RETURN false;
  END IF;

  topic_user_str := substring(topic from '^social:user:([0-9a-fA-F-]{36})$');
  IF topic_user_str IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    topic_user_id := topic_user_str::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Owner can always receive on their own topic
  IF topic_user_id = auth_user THEN
    RETURN true;
  END IF;

  -- Check topic owner presence visibility (ghost mode / privacy §10)
  SELECT presence_visibility INTO visibility
  FROM public.profiles
  WHERE user_id = topic_user_id;

  IF visibility IS NULL OR visibility = 'none' OR visibility = 'nobody' THEN
    RETURN false;
  END IF;

  -- Check accepted friendship without any block (§8, §20)
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE user_low_id = LEAST(auth_user, topic_user_id)
      AND user_high_id = GREATEST(auth_user, topic_user_id)
      AND status = 'accepted'
  ) INTO is_accepted;

  RETURN coalesce(is_accepted, false);
END;
$$;

-- Grant function execute permissions to authenticated role
GRANT EXECUTE ON FUNCTION public.can_publish_social_topic(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_receive_social_topic(text, uuid) TO authenticated;

-- Policies on Supabase's managed realtime.messages table
DROP POLICY IF EXISTS "Users can publish to their own social presence topic" ON realtime.messages;
CREATE POLICY "Users can publish to their own social presence topic" ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_publish_social_topic(realtime.messages.topic, auth.uid())
  );

DROP POLICY IF EXISTS "Users can receive their own and friends social presence topics" ON realtime.messages;
CREATE POLICY "Users can receive their own and friends social presence topics" ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    public.can_receive_social_topic(realtime.messages.topic, auth.uid())
  );

COMMENT ON FUNCTION public.can_publish_social_topic(text, uuid) IS 'Validates that only the topic owner can publish presence/broadcast events for social:user:<userId> (§20)';
COMMENT ON FUNCTION public.can_receive_social_topic(text, uuid) IS 'Validates that only topic owner and non-blocked accepted friends can receive presence events for social:user:<userId>, respecting ghost mode (§20)';
