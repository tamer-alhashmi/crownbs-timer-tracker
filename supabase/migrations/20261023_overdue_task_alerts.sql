BEGIN;

CREATE TABLE IF NOT EXISTS public.task_overdue_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.work_logs(id) ON DELETE CASCADE,
  incident_started_at TIMESTAMPTZ NOT NULL,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_overdue_alerts_incident_recipient_key
    UNIQUE (task_id, incident_started_at, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_task_overdue_alerts_recipient_created
  ON public.task_overdue_alerts(recipient_id, created_at DESC);

ALTER TABLE public.task_overdue_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Overdue task alerts through server API only"
  ON public.task_overdue_alerts;
CREATE POLICY "Overdue task alerts through server API only"
  ON public.task_overdue_alerts
  AS RESTRICTIVE FOR ALL TO public
  USING (false)
  WITH CHECK (false);

GRANT ALL PRIVILEGES ON TABLE public.task_overdue_alerts TO service_role;

COMMIT;
