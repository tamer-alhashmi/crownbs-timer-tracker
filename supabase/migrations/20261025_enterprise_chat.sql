BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  property_id UUID REFERENCES public.hotels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_direct_channel_name_check CHECK (type = 'group' OR name = 'Direct conversation')
);

CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_channel_members_channel_user_key UNIQUE (channel_id, user_id)
);

ALTER TABLE public.messages
  ALTER COLUMN receiver_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_type_check CHECK (attachment_type IN ('image', 'pdf', 'doc', 'voice'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_attachment_details_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_details_check CHECK (
    (attachment_url IS NULL) = (attachment_type IS NULL)
  );

UPDATE storage.buckets
SET allowed_mime_types = array_cat(
  COALESCE(allowed_mime_types, ARRAY[]::TEXT[]),
  ARRAY['audio/webm', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus']::TEXT[]
)
WHERE id = 'chat_attachments'
  AND NOT (COALESCE(allowed_mime_types, ARRAY[]::TEXT[]) @> ARRAY['audio/webm']::TEXT[]);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_message_type_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_message_type_check CHECK (message_type IN ('text', 'voice', 'system', 'call_log'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_target_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_conversation_target_check CHECK (
        (channel_id IS NOT NULL AND receiver_id IS NULL)
        OR (channel_id IS NULL AND receiver_id IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_duration_nonnegative_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_duration_nonnegative_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_message_reactions_message_user_emoji_key UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS public.chat_conversation_preferences (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, contact_id),
  CONSTRAINT chat_conversation_preferences_not_self CHECK (user_id <> contact_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_channel_members_user
  ON public.chat_channel_members(user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON public.messages(channel_id, created_at DESC)
  WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON public.messages(parent_id)
  WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message
  ON public.chat_message_reactions(message_id, created_at);

GRANT ALL PRIVILEGES ON TABLE public.chat_channels TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.chat_channel_members TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.chat_message_reactions TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.chat_conversation_preferences TO service_role;

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversation_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat channels through server API only" ON public.chat_channels;
CREATE POLICY "Chat channels through server API only" ON public.chat_channels
  AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Chat channel members through server API only" ON public.chat_channel_members;
CREATE POLICY "Chat channel members through server API only" ON public.chat_channel_members
  AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Chat reactions through server API only" ON public.chat_message_reactions;
CREATE POLICY "Chat reactions through server API only" ON public.chat_message_reactions
  AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Chat preferences through server API only" ON public.chat_conversation_preferences;
CREATE POLICY "Chat preferences through server API only" ON public.chat_conversation_preferences
  AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_channels') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channels;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_channel_members') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channel_members;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_message_reactions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_conversation_preferences') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversation_preferences;
    END IF;
  END IF;
END
$$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_channel_members REPLICA IDENTITY FULL;
ALTER TABLE public.chat_message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.chat_conversation_preferences REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
