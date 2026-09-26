-- Immutable responsibility snapshots for work logs and derived payroll views.
-- Existing rows are backfilled from the current hotel assignment once. New rows
-- are captured from the hotel assignment at insert time by the trigger below.
ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID,
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS responsibility_recorded_at TIMESTAMPTZ;

UPDATE public.work_logs AS wl
SET owner_id = h.owner_id,
    owner_name = owner.full_name,
    manager_id = h.manager_id,
    manager_name = manager.full_name,
    responsibility_recorded_at = COALESCE(wl.responsibility_recorded_at, wl.created_at, wl.start_time)
FROM public.hotels AS h
LEFT JOIN public.users AS owner ON owner.id = h.owner_id
LEFT JOIN public.users AS manager ON manager.id = h.manager_id
WHERE h.id = wl.hotel_id
  AND (wl.owner_id IS NULL OR wl.owner_name IS NULL OR wl.manager_id IS NULL OR wl.manager_name IS NULL OR wl.responsibility_recorded_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_work_logs_owner_snapshot ON public.work_logs(owner_id, start_time);
CREATE INDEX IF NOT EXISTS idx_work_logs_manager_snapshot ON public.work_logs(manager_id, start_time);
CREATE INDEX IF NOT EXISTS idx_work_logs_responsibility_recorded_at ON public.work_logs(responsibility_recorded_at);

CREATE OR REPLACE FUNCTION public.capture_work_log_responsibility_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_owner_id UUID;
  assigned_owner_name TEXT;
  assigned_manager_id UUID;
  assigned_manager_name TEXT;
BEGIN
  SELECT
    h.owner_id,
    owner.full_name,
    h.manager_id,
    manager.full_name
  INTO assigned_owner_id, assigned_owner_name, assigned_manager_id, assigned_manager_name
  FROM public.hotels AS h
  LEFT JOIN public.users AS owner ON owner.id = h.owner_id
  LEFT JOIN public.users AS manager ON manager.id = h.manager_id
  WHERE h.id = NEW.hotel_id;

  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := assigned_owner_id;
    NEW.owner_name := COALESCE(assigned_owner_name, 'Unassigned owner at time of work');
    NEW.manager_id := assigned_manager_id;
    NEW.manager_name := COALESCE(assigned_manager_name, 'Unassigned manager at time of work');
    NEW.responsibility_recorded_at := COALESCE(NEW.responsibility_recorded_at, NOW());
  ELSE
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.owner_name IS DISTINCT FROM OLD.owner_name
      OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
      OR NEW.manager_name IS DISTINCT FROM OLD.manager_name
      OR NEW.responsibility_recorded_at IS DISTINCT FROM OLD.responsibility_recorded_at THEN
      RAISE EXCEPTION 'Responsibility snapshots are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_log_responsibility_snapshot ON public.work_logs;
CREATE TRIGGER work_log_responsibility_snapshot
BEFORE INSERT OR UPDATE ON public.work_logs
FOR EACH ROW
EXECUTE FUNCTION public.capture_work_log_responsibility_snapshot();

NOTIFY pgrst, 'reload schema';
