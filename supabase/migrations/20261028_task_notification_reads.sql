BEGIN;

CREATE TABLE IF NOT EXISTS public.task_notification_reads (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.work_logs(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, task_id)
);

ALTER TABLE public.task_notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_notification_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.task_notification_reads TO service_role;

COMMIT;
