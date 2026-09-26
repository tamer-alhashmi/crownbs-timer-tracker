ALTER TABLE public.services_config
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS task_date DATE,
  ADD COLUMN IF NOT EXISTS room_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS service_description_snapshot TEXT;

UPDATE public.services_config
SET description = CASE name
  WHEN 'Cleaning (Hourly)' THEN 'Cleaning service paid by recorded hours.'
  WHEN 'Cleaning (Per Room)' THEN 'Room-based cleaning service paid per completed room.'
  WHEN 'Maintenance' THEN 'Maintenance and repair work for selected rooms.'
  WHEN 'Linen Distribution' THEN 'Linen distribution service.'
  WHEN 'Product Delivery' THEN 'Hotel product delivery service.'
  ELSE name
END
WHERE description = '';

UPDATE public.work_logs AS wl
SET task_date = COALESCE(wl.task_date, (wl.start_time AT TIME ZONE 'Europe/London')::date),
    room_numbers = CASE
      WHEN cardinality(wl.room_numbers) > 0 THEN wl.room_numbers
      ELSE ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(wl.room_number, ''), ',')) AS value WHERE btrim(value) <> '')
    END,
    service_name_snapshot = COALESCE(wl.service_name_snapshot, service.name, 'Unknown service'),
    service_description_snapshot = COALESCE(wl.service_description_snapshot, NULLIF(service.description, ''), service.name, 'Unknown service')
FROM public.services_config AS service
WHERE service.id = wl.service_id;

ALTER TABLE public.work_logs
  ALTER COLUMN task_date SET NOT NULL,
  ALTER COLUMN service_name_snapshot SET NOT NULL,
  ALTER COLUMN service_description_snapshot SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_logs_task_date ON public.work_logs(task_date);

CREATE OR REPLACE FUNCTION public.capture_work_log_task_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_service_name TEXT;
  selected_service_description TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.task_date := (NEW.start_time AT TIME ZONE 'Europe/London')::date;
    SELECT name, COALESCE(NULLIF(description, ''), name)
    INTO selected_service_name, selected_service_description
    FROM public.services_config
    WHERE id = NEW.service_id;
    NEW.service_name_snapshot := COALESCE(NEW.service_name_snapshot, selected_service_name, 'Unknown service');
    NEW.service_description_snapshot := COALESCE(NEW.service_description_snapshot, selected_service_description, 'Unknown service');
    NEW.room_numbers := COALESCE(NEW.room_numbers, '{}'::TEXT[]);
    IF cardinality(NEW.room_numbers) = 0 AND NULLIF(NEW.room_number, '') IS NOT NULL THEN
      NEW.room_numbers := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(NEW.room_number, ',')) AS value WHERE btrim(value) <> '');
    END IF;
  ELSE
    IF NEW.task_date IS DISTINCT FROM OLD.task_date THEN
      RAISE EXCEPTION 'Task date is immutable';
    END IF;
    IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
      SELECT name, COALESCE(NULLIF(description, ''), name)
      INTO selected_service_name, selected_service_description
      FROM public.services_config
      WHERE id = NEW.service_id;
      NEW.service_name_snapshot := COALESCE(selected_service_name, 'Unknown service');
      NEW.service_description_snapshot := COALESCE(selected_service_description, 'Unknown service');
    END IF;
    IF NEW.room_number IS DISTINCT FROM OLD.room_number AND NEW.room_numbers IS NOT DISTINCT FROM OLD.room_numbers THEN
      NEW.room_numbers := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(NEW.room_number, ''), ',')) AS value WHERE btrim(value) <> '');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_log_task_context ON public.work_logs;
CREATE TRIGGER work_log_task_context
BEFORE INSERT OR UPDATE ON public.work_logs
FOR EACH ROW
EXECUTE FUNCTION public.capture_work_log_task_context();

NOTIFY pgrst, 'reload schema';