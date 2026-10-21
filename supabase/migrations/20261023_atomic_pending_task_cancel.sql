CREATE OR REPLACE FUNCTION public.cancel_pending_dispatch_task(
  p_task_id UUID,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_record JSONB;
  updated_record JSONB;
  audit_id UUID;
BEGIN
  IF p_task_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A task and actor are required.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(btrim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'A cancellation reason between 5 and 1,000 characters is required.';
  END IF;

  SELECT to_jsonb(log_row)
    INTO previous_record
    FROM public.work_logs AS log_row
    WHERE log_row.id = p_task_id
      AND log_row.status = 'assigned'
      AND log_row.deleted_at IS NULL
      AND log_row.cancelled_at IS NULL
    FOR UPDATE;

  IF previous_record IS NULL THEN
    RAISE EXCEPTION 'The pending task was not found or has already changed.';
  END IF;

  UPDATE public.work_logs
    SET cancelled_at = statement_timestamp(),
        overridden_by = p_actor_id,
        override_reason = btrim(p_reason),
        updated_at = statement_timestamp()
    WHERE id = p_task_id
    RETURNING to_jsonb(work_logs) INTO updated_record;

  INSERT INTO public.operations_override_audit (
    entity_type, entity_id, action, actor_id, override_reason, previous_values, new_values
  )
  VALUES (
    'task', p_task_id, 'cancel_task', p_actor_id, btrim(p_reason), previous_record, updated_record
  )
  RETURNING id INTO audit_id;

  RETURN jsonb_build_object('audit_id', audit_id, 'record', updated_record);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pending_dispatch_task(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_dispatch_task(UUID, UUID, TEXT) TO service_role;
