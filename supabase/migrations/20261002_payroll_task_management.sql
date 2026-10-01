BEGIN;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS cost_override NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.work_logs
  DROP CONSTRAINT IF EXISTS work_logs_cost_override_check,
  ADD CONSTRAINT work_logs_cost_override_check
    CHECK (cost_override IS NULL OR cost_override >= 0);

ALTER TABLE public.work_log_audit
  DROP CONSTRAINT IF EXISTS work_log_audit_action_check,
  ADD CONSTRAINT work_log_audit_action_check
    CHECK (action IN ('created', 'edited', 'approved', 'rejected', 'unapproved', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_work_logs_active_payroll
  ON public.work_logs (task_date, hotel_id, user_id)
  WHERE is_locked = TRUE AND status = 'completed' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
