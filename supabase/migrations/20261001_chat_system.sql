-- Chat data is accessed through authenticated server routes, which apply role checks
-- before using the service key. Keep direct client access disabled and media private.
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

UPDATE storage.buckets
SET public = false
WHERE id = 'chat_attachments';

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
