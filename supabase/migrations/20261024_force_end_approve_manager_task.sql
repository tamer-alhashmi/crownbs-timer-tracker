BEGIN;

CREATE OR REPLACE FUNCTION public.force_end_approve_manager_task(
  p_task_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_record public.work_logs%ROWTYPE;
  updated_record public.work_logs%ROWTYPE;
  v_actor_role public.user_role;
  effective_end_time TIMESTAMPTZ := statement_timestamp();
  v_override_reason TEXT;
  operations_audit_id UUID;
  work_log_audit_id UUID;
BEGIN
  IF p_task_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A task and actor are required.';
  END IF;

  SELECT role
    INTO v_actor_role
    FROM public.users
    WHERE id = p_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'Only a Platform Admin or Property Owner can force-end and approve a Manager task.';
  END IF;

  SELECT *
    INTO previous_record
    FROM public.work_logs
    WHERE id = p_task_id
      AND status IN ('assigned', 'active')
      AND is_locked = FALSE
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The pending or active Manager task was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.users
      WHERE id = previous_record.user_id
        AND role = 'manager'
  ) THEN
    RAISE EXCEPTION 'This action is only available for tasks assigned to a Manager.';
  END IF;

  IF v_actor_role = 'owner' AND NOT EXISTS (
    SELECT 1
      FROM public.hotels
      WHERE id = previous_record.hotel_id
        AND owner_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'This task is outside the Owner property scope.';
  END IF;

  IF previous_record.start_time > effective_end_time THEN
    RAISE EXCEPTION 'The task start time is in the future and cannot be finalized.';
  END IF;

  IF previous_record.shift_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.master_shifts
      WHERE id = previous_record.shift_id
        AND status = 'active'
        AND end_time IS NULL
        AND start_time > effective_end_time
  ) THEN
    RAISE EXCEPTION 'The linked shift starts in the future and cannot be finalized.';
  END IF;

  v_override_reason := format(
    'Force-ended and approved by %s.',
    CASE WHEN v_actor_role = 'owner' THEN 'Owner' ELSE 'Admin' END
  );

  IF previous_record.shift_id IS NOT NULL THEN
    UPDATE public.master_shifts
      SET end_time = effective_end_time,
          status = 'completed',
          overridden_by = p_actor_id,
          override_reason = v_override_reason,
          updated_at = effective_end_time
      WHERE id = previous_record.shift_id
        AND status = 'active'
        AND end_time IS NULL;
  END IF;

  UPDATE public.work_logs
    SET status = 'completed',
        end_time = effective_end_time,
        rooms_completed = GREATEST(COALESCE(rooms_completed, 0), 0),
        manager_approved = TRUE,
        manager_rejected = FALSE,
        manager_approved_at = COALESCE(manager_approved_at, effective_end_time),
        owner_approved = TRUE,
        owner_rejected = FALSE,
        owner_approved_at = COALESCE(owner_approved_at, effective_end_time),
        is_locked = TRUE,
        cancelled_at = NULL,
        overridden_by = p_actor_id,
        override_reason = v_override_reason,
        updated_at = effective_end_time
    WHERE id = p_task_id
    RETURNING * INTO updated_record;

  INSERT INTO public.work_log_audit (
    work_log_id, actor_id, action, previous_values, new_values
  )
  VALUES (
    p_task_id,
    p_actor_id,
    'approved',
    to_jsonb(previous_record),
    to_jsonb(updated_record) || jsonb_build_object('audit_note', v_override_reason)
  )
  RETURNING id INTO work_log_audit_id;

  INSERT INTO public.operations_override_audit (
    entity_type, entity_id, action, actor_id, override_reason, previous_values, new_values
  )
  VALUES (
    'task',
    p_task_id,
    'force_complete_task',
    p_actor_id,
    v_override_reason,
    to_jsonb(previous_record),
    to_jsonb(updated_record)
  )
  RETURNING id INTO operations_audit_id;

  RETURN jsonb_build_object(
    'work_log_audit_id', work_log_audit_id,
    'operations_audit_id', operations_audit_id,
    'record', to_jsonb(updated_record)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.force_end_approve_manager_task(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_end_approve_manager_task(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_dispatch_task(
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
  previous_record public.work_logs%ROWTYPE;
  updated_record public.work_logs%ROWTYPE;
  actor_role public.user_role;
  assignee_role public.user_role;
  effective_end_time TIMESTAMPTZ := statement_timestamp();
  audit_reason TEXT := btrim(p_reason);
  work_log_audit_id UUID;
  operations_audit_id UUID;
  manager_auto_approved BOOLEAN;
BEGIN
  IF p_task_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A task and actor are required.';
  END IF;
  IF p_reason IS NULL OR length(audit_reason) < 5 OR length(audit_reason) > 1000 THEN
    RAISE EXCEPTION 'An audit reason between 5 and 1,000 characters is required.';
  END IF;

  SELECT role INTO actor_role FROM public.users WHERE id = p_actor_id;
  IF actor_role IS NULL OR actor_role NOT IN ('admin', 'owner', 'manager', 'hk_admin') THEN
    RAISE EXCEPTION 'Management access is required to complete this task.';
  END IF;

  SELECT *
    INTO previous_record
    FROM public.work_logs
    WHERE id = p_task_id
      AND status = 'active'
      AND end_time IS NULL
      AND is_locked = FALSE
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active task was not found or has already ended.';
  END IF;
  IF previous_record.start_time > effective_end_time THEN
    RAISE EXCEPTION 'Task start time is in the future and cannot be completed.';
  END IF;

  SELECT role INTO assignee_role FROM public.users WHERE id = previous_record.user_id;
  IF assignee_role IS NULL THEN
    RAISE EXCEPTION 'The assigned user could not be found.';
  END IF;
  manager_auto_approved := assignee_role = 'manager';

  UPDATE public.work_logs
    SET status = 'completed',
        end_time = effective_end_time,
        rooms_completed = GREATEST(COALESCE(rooms_completed, 0), 0),
        manager_approved = CASE WHEN manager_auto_approved THEN TRUE ELSE manager_approved END,
        manager_rejected = CASE WHEN manager_auto_approved THEN FALSE ELSE manager_rejected END,
        manager_approved_at = CASE
          WHEN manager_auto_approved THEN COALESCE(manager_approved_at, effective_end_time)
          ELSE manager_approved_at
        END,
        overridden_by = p_actor_id,
        override_reason = audit_reason,
        updated_at = effective_end_time
    WHERE id = p_task_id
    RETURNING * INTO updated_record;

  INSERT INTO public.work_log_audit (
    work_log_id, actor_id, action, previous_values, new_values
  )
  VALUES (
    p_task_id,
    p_actor_id,
    CASE WHEN manager_auto_approved THEN 'approved' ELSE 'edited' END,
    to_jsonb(previous_record),
    CASE
      WHEN manager_auto_approved THEN
        to_jsonb(updated_record) || jsonb_build_object(
          'audit_note',
          'Manager approval was recorded automatically when the managerial task was force-completed.'
        )
      ELSE to_jsonb(updated_record)
    END
  )
  RETURNING id INTO work_log_audit_id;

  INSERT INTO public.operations_override_audit (
    entity_type, entity_id, action, actor_id, override_reason, previous_values, new_values
  )
  VALUES (
    'task',
    p_task_id,
    'force_complete_task',
    p_actor_id,
    audit_reason,
    to_jsonb(previous_record),
    to_jsonb(updated_record)
  )
  RETURNING id INTO operations_audit_id;

  RETURN jsonb_build_object(
    'work_log_audit_id', work_log_audit_id,
    'operations_audit_id', operations_audit_id,
    'record', to_jsonb(updated_record)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_dispatch_task(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_dispatch_task(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
