BEGIN;

CREATE TABLE IF NOT EXISTS public.work_log_status_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_log_id UUID NOT NULL REFERENCES public.work_logs(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS work_log_status_notifications_recipient_idx
  ON public.work_log_status_notifications (recipient_id, created_at DESC);

ALTER TABLE public.work_log_status_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_log_status_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.work_log_status_notifications TO service_role;

COMMIT;
