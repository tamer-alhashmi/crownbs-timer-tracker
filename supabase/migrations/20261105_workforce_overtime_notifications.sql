BEGIN;

CREATE TABLE IF NOT EXISTS public.workforce_overtime_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('task', 'shift')),
  source_id UUID NOT NULL,
  incident_started_at TIMESTAMPTZ NOT NULL,
  worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_overtime_notification_recipient_key
    UNIQUE (source_type, source_id, incident_started_at, recipient_id)
);

CREATE INDEX IF NOT EXISTS workforce_overtime_notifications_recipient_idx
  ON public.workforce_overtime_notifications (recipient_id, created_at DESC);

ALTER TABLE public.workforce_overtime_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workforce_overtime_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workforce_overtime_notifications TO service_role;

COMMIT;
