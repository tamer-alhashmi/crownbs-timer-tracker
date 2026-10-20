BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

UPDATE public.messages
SET sent_at = created_at
WHERE sent_at IS DISTINCT FROM created_at;

UPDATE public.messages
SET delivered_at = COALESCE(delivered_at, created_at),
    read_at = COALESCE(read_at, created_at)
WHERE is_read = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_receiver_pending_delivery
  ON public.messages (receiver_id, sent_at)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_receiver_pending_read
  ON public.messages (receiver_id, sender_id, sent_at)
  WHERE is_read = FALSE;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sound_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';

COMMIT;
