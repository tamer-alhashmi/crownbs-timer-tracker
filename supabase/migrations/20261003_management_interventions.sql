BEGIN;

ALTER TABLE public.master_shifts
  ADD COLUMN IF NOT EXISTS overridden_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overridden_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

CREATE TABLE IF NOT EXISTS public.operations_override_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('shift', 'task')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('force_clock_out', 'force_complete_task', 'cancel_task')),
  actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  override_reason TEXT NOT NULL,
  previous_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_override_audit_entity
  ON public.operations_override_audit (entity_type, entity_id, created_at DESC);

ALTER TABLE public.operations_override_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Management can read scoped operational overrides" ON public.operations_override_audit;
CREATE POLICY "Management can read scoped operational overrides"
ON public.operations_override_audit
FOR SELECT
USING (
  public.is_admin()
  OR (
    entity_type = 'task'
    AND EXISTS (
      SELECT 1
      FROM public.work_logs AS log
      JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
      WHERE log.id = operations_override_audit.entity_id
        AND (hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid())
    )
  )
  OR (
    entity_type = 'shift'
    AND EXISTS (
      SELECT 1
      FROM public.master_shifts AS shift
      JOIN public.users AS cleaner ON cleaner.id = shift.user_id
      JOIN public.hotels AS hotel ON hotel.id = cleaner.primary_hotel_id
      WHERE shift.id = operations_override_audit.entity_id
        AND (hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid())
      UNION
      SELECT 1
      FROM public.master_shifts AS shift
      JOIN public.work_logs AS log ON log.shift_id = shift.id
      JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
      WHERE shift.id = operations_override_audit.entity_id
        AND (hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Users can manage own master shifts" ON public.master_shifts;
DROP POLICY IF EXISTS "Users and assigned management can read master shifts" ON public.master_shifts;
CREATE POLICY "Users and assigned management can read master shifts"
ON public.master_shifts
FOR SELECT
USING (
  auth.uid() = user_id
  OR public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.users AS cleaner
    JOIN public.hotels AS hotel ON hotel.id = cleaner.primary_hotel_id
    WHERE cleaner.id = master_shifts.user_id
      AND (hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.work_logs AS log
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    WHERE log.shift_id = master_shifts.id
      AND (hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Admin owner manager can manage services" ON public.services_config;
CREATE POLICY "Admin owner manager can manage services"
ON public.services_config
FOR ALL
USING (public.is_admin() OR public.is_owner() OR public.is_manager())
WITH CHECK (public.is_admin() OR public.is_owner() OR public.is_manager());

CREATE OR REPLACE FUNCTION public.record_management_override(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_action TEXT,
  p_actor_id UUID,
  p_reason TEXT,
  p_end_time TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  previous_record JSONB;
  updated_record JSONB;
  effective_end_time TIMESTAMPTZ;
  audit_id UUID;
BEGIN
  IF p_entity_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'An operation and actor are required.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(btrim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'An audit reason between 5 and 1,000 characters is required.';
  END IF;

  IF p_entity_type = 'shift' AND p_action = 'force_clock_out' THEN
    SELECT to_jsonb(shift_row)
      INTO previous_record
      FROM public.master_shifts AS shift_row
      WHERE shift_row.id = p_entity_id
        AND shift_row.status = 'active'
        AND shift_row.end_time IS NULL
      FOR UPDATE;

    IF previous_record IS NULL THEN
      RAISE EXCEPTION 'The active shift was not found or has already ended.';
    END IF;

    effective_end_time := COALESCE(p_end_time, statement_timestamp());
    IF effective_end_time < (previous_record ->> 'start_time')::TIMESTAMPTZ
       OR effective_end_time > statement_timestamp() THEN
      RAISE EXCEPTION 'Clock-out time must be between shift start and the current time.';
    END IF;

    UPDATE public.master_shifts
      SET end_time = effective_end_time,
          status = 'completed',
          overridden_by = p_actor_id,
          override_reason = btrim(p_reason),
          updated_at = statement_timestamp()
      WHERE id = p_entity_id
      RETURNING to_jsonb(master_shifts) INTO updated_record;
  ELSIF p_entity_type = 'task' AND p_action IN ('force_complete_task', 'cancel_task') THEN
    SELECT to_jsonb(log_row)
      INTO previous_record
      FROM public.work_logs AS log_row
      WHERE log_row.id = p_entity_id
        AND log_row.status = 'active'
        AND log_row.end_time IS NULL
        AND log_row.deleted_at IS NULL
        AND log_row.cancelled_at IS NULL
      FOR UPDATE;

    IF previous_record IS NULL THEN
      RAISE EXCEPTION 'The active task was not found or has already ended.';
    END IF;

    effective_end_time := COALESCE(p_end_time, statement_timestamp());
    IF effective_end_time < (previous_record ->> 'start_time')::TIMESTAMPTZ
       OR effective_end_time > statement_timestamp() THEN
      RAISE EXCEPTION 'Task end time must be between task start and the current time.';
    END IF;

    UPDATE public.work_logs
      SET end_time = effective_end_time,
          status = 'completed',
          cancelled_at = CASE WHEN p_action = 'cancel_task' THEN statement_timestamp() ELSE NULL END,
          overridden_by = p_actor_id,
          override_reason = btrim(p_reason),
          updated_at = statement_timestamp()
      WHERE id = p_entity_id
      RETURNING to_jsonb(work_logs) INTO updated_record;
  ELSE
    RAISE EXCEPTION 'Unsupported management override.';
  END IF;

  INSERT INTO public.operations_override_audit (
    entity_type, entity_id, action, actor_id, override_reason, previous_values, new_values
  )
  VALUES (
    p_entity_type, p_entity_id, p_action, p_actor_id, btrim(p_reason), previous_record, updated_record
  )
  RETURNING id INTO audit_id;

  RETURN jsonb_build_object('audit_id', audit_id, 'record', updated_record);
END;
$$;

REVOKE ALL ON FUNCTION public.record_management_override(TEXT, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_management_override(TEXT, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT SELECT ON public.operations_override_audit TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'master_shifts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.master_shifts;
  END IF;
END
$$;

ALTER TABLE public.master_shifts REPLICA IDENTITY FULL;
ALTER TABLE public.work_logs REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
