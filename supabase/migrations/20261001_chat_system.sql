-- Chat data is accessed through authenticated server routes, which apply role checks
-- before using the service key. Keep direct client access disabled and media private.
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 5000),
  attachment_url TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('image', 'pdf', 'doc')),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_attachment_details_check CHECK (
    (attachment_url IS NULL) = (attachment_type IS NULL)
  )
);

GRANT ALL PRIVILEGES ON TABLE public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat access through server API only" ON public.messages;
CREATE POLICY "Chat access through server API only"
  ON public.messages
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Chat attachments through server API only" ON storage.objects;
CREATE POLICY "Chat attachments through server API only"
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (bucket_id <> 'chat_attachments')
  WITH CHECK (bucket_id <> 'chat_attachments');

CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread_created
  ON public.messages (receiver_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver_created
  ON public.messages (sender_id, receiver_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender_created
  ON public.messages (receiver_id, sender_id, created_at);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat_attachments',
  'chat_attachments',
  FALSE,
  12582912,
  ARRAY[
    'image/avif',
    'image/gif',
    'image/heic',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
