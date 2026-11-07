BEGIN;

CREATE OR REPLACE FUNCTION public.write_workforce_shift_notifications(
  p_event_id UUID,
  p_user_id UUID,
  p_property_id UUID,
  p_event_type TEXT,
  p_severity TEXT,
  p_body TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT profile.role::TEXT INTO user_role
  FROM public.users AS profile
  WHERE profile.id = p_user_id;

  INSERT INTO public.workforce_shift_notifications (
    shift_event_id, recipient_id, severity, title, body
  )
  SELECT p_event_id,
         target.id,
         p_severity,
         CASE
           WHEN p_event_type = 'geofence_breach' THEN 'Geofence breach attempt'
           WHEN p_event_type = 'clock_in' THEN 'Clock-in confirmed'
           ELSE 'Clock-out confirmed'
         END,
         p_body
  FROM (
    SELECT property.owner_id AS id
    FROM public.hotels AS property
    WHERE property.id = p_property_id
    UNION
    SELECT co_owner.owner_id
    FROM public.property_co_owners AS co_owner
    WHERE co_owner.property_id = p_property_id
      AND co_owner.removed_at IS NULL
    UNION
    SELECT property.manager_id
    FROM public.hotels AS property
    WHERE property.id = p_property_id
    UNION
    SELECT assignment.user_id
    FROM public.user_hotel_assignments AS assignment
    WHERE assignment.hotel_id = p_property_id
    UNION
    SELECT profile.id
    FROM public.users AS profile
    WHERE profile.primary_hotel_id = p_property_id
  ) AS recipient
  JOIN public.users AS target ON target.id = recipient.id
  WHERE recipient.id IS NOT NULL
    AND recipient.id <> p_user_id
    AND target.is_active = TRUE
    AND target.email_verified = TRUE
    AND (
      (target.role::TEXT = 'owner' AND user_role IN ('cleaner', 'manager', 'hk_admin', 'housekeeping_admin'))
      OR (target.role::TEXT = 'manager' AND user_role IN ('cleaner', 'hk_admin', 'housekeeping_admin'))
      OR (target.role::TEXT IN ('hk_admin', 'housekeeping_admin') AND user_role = 'cleaner')
    )
  ON CONFLICT (shift_event_id, recipient_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_workforce_clock_in(
  p_user_id UUID,
  p_property_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  property_name TEXT;
  property_lat DOUBLE PRECISION;
  property_lng DOUBLE PRECISION;
  distance_meters DOUBLE PRECISION;
  event_id UUID;
  shift_id UUID;
  message TEXT;
  event_kind TEXT;
BEGIN
  SELECT profile.role::TEXT INTO actor_role
  FROM public.users AS profile
  WHERE profile.id = p_user_id AND profile.is_active = TRUE
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('cleaner', 'manager', 'housekeeping_admin', 'hk_admin') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Only active property workforce members can clock in.');
  END IF;

  SELECT property.name, property.latitude, property.longitude
  INTO property_name, property_lat, property_lng
  FROM public.hotels AS property
  WHERE property.id = p_property_id
    AND property.is_active = TRUE
    AND property.archived_at IS NULL
    AND (
      (actor_role = 'manager' AND (
        property.manager_id = p_user_id
        OR property.id = (SELECT profile.primary_hotel_id FROM public.users AS profile WHERE profile.id = p_user_id)
        OR EXISTS (
          SELECT 1 FROM public.user_hotel_assignments AS assignment
          WHERE assignment.user_id = p_user_id AND assignment.hotel_id = property.id
        )
      ))
      OR (
        actor_role IN ('housekeeping_admin', 'hk_admin', 'cleaner')
        AND (
          property.id = (SELECT profile.primary_hotel_id FROM public.users AS profile WHERE profile.id = p_user_id)
          OR EXISTS (
            SELECT 1 FROM public.user_hotel_assignments AS assignment
            WHERE assignment.user_id = p_user_id AND assignment.hotel_id = property.id
          )
        )
      )
    );
  IF property_name IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Choose an active property assigned to your workforce account.');
  END IF;
  IF property_lat IS NULL OR property_lng IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'This property needs a saved map location before staff can clock in.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.master_shifts AS existing
    WHERE existing.user_id = p_user_id AND existing.status = 'active' AND existing.end_time IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'A master shift is already active.');
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy IS NULL
    OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy < 0 THEN
    message := 'A valid device location is required to clock in.';
    event_kind := 'geofence_breach';
    distance_meters := NULL;
  ELSE
    distance_meters := 2 * 6371000 * ASIN(SQRT(LEAST(1.0, GREATEST(0.0,
      POWER(SIN(RADIANS(p_lat - property_lat) / 2), 2)
      + COS(RADIANS(property_lat)) * COS(RADIANS(p_lat))
        * POWER(SIN(RADIANS(p_lng - property_lng) / 2), 2)
    ))));
    IF p_accuracy > 30 THEN
      message := format('Location accuracy is too low (±%sm). Calibrate location or step outside for a stronger GPS lock, then try again.', ROUND(p_accuracy)::INTEGER);
      event_kind := 'geofence_breach';
    ELSIF distance_meters > 20 THEN
      message := format('Location Mismatch: You are %sm away from %s. Clock-in is restricted to within 20m of the property.', ROUND(distance_meters)::INTEGER, property_name);
      event_kind := 'geofence_breach';
    END IF;
  END IF;

  IF event_kind = 'geofence_breach' THEN
    INSERT INTO public.workforce_shift_events (
      user_id, property_id, event_type, latitude, longitude, accuracy, distance_meters, compliant, details
    ) VALUES (
      p_user_id, p_property_id, event_kind, p_lat, p_lng, p_accuracy, distance_meters, FALSE,
      jsonb_build_object('reason', message)
    ) RETURNING id INTO event_id;
    INSERT INTO public.workforce_security_incidents (
      shift_event_id, user_id, property_id, incident_type, latitude, longitude, distance_meters, details
    ) VALUES (
      event_id, p_user_id, p_property_id, event_kind, p_lat, p_lng, distance_meters,
      jsonb_build_object('reason', message, 'accuracy', p_accuracy)
    );
    PERFORM public.write_workforce_shift_notifications(
      event_id, p_user_id, p_property_id, event_kind, 'high',
      format('%s · %s · %s · %s', message, p_lat, p_lng, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );
    RETURN jsonb_build_object('success', FALSE, 'error', message, 'eventId', event_id);
  END IF;

  INSERT INTO public.master_shifts (
    user_id, hotel_id, role_at_shift, clock_in_lat, clock_in_lng,
    clock_in_accuracy, start_time, status
  ) VALUES (
    p_user_id, p_property_id,
    CASE WHEN actor_role = 'hk_admin' THEN 'housekeeping_admin' ELSE actor_role END,
    p_lat, p_lng, p_accuracy, NOW(), 'active'
  ) RETURNING id INTO shift_id;

  INSERT INTO public.workforce_shift_events (
    user_id, property_id, event_type, latitude, longitude, accuracy, distance_meters, compliant
  ) VALUES (
    p_user_id, p_property_id, 'clock_in', p_lat, p_lng, p_accuracy, distance_meters, TRUE
  ) RETURNING id INTO event_id;
  PERFORM public.write_workforce_shift_notifications(
    event_id, p_user_id, p_property_id, 'clock_in', 'info',
    format('Clock-in confirmed: %s at %s', (SELECT full_name FROM public.users WHERE id = p_user_id), property_name)
  );
  RETURN jsonb_build_object('success', TRUE, 'shiftId', shift_id, 'eventId', event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_shift_close_with_open_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active'
    AND OLD.end_time IS NULL
    AND (NEW.end_time IS NOT NULL OR NEW.status <> 'active')
    AND EXISTS (
      SELECT 1
      FROM public.work_logs AS task
      WHERE task.user_id = OLD.user_id
        AND (task.shift_id = OLD.id OR task.shift_id IS NULL)
        AND task.status IN ('active', 'paused')
        AND task.end_time IS NULL
        AND task.deleted_at IS NULL
        AND task.cancelled_at IS NULL
    ) THEN
    RAISE EXCEPTION 'Complete all active and paused tasks before clocking out.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS master_shifts_prevent_close_with_open_tasks ON public.master_shifts;
CREATE TRIGGER master_shifts_prevent_close_with_open_tasks
BEFORE UPDATE OF status, end_time ON public.master_shifts
FOR EACH ROW EXECUTE FUNCTION public.prevent_shift_close_with_open_tasks();

CREATE OR REPLACE FUNCTION public.prevent_self_start_while_task_paused()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_resuming_paused_task BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    is_resuming_paused_task := OLD.status = 'paused';
  END IF;
  IF NEW.status = 'active'
    AND NEW.assigned_by IS NULL
    AND NOT is_resuming_paused_task
    AND EXISTS (
      SELECT 1
      FROM public.work_logs AS task
      WHERE task.user_id = NEW.user_id
        AND task.status = 'paused'
        AND task.end_time IS NULL
        AND task.deleted_at IS NULL
        AND task.cancelled_at IS NULL
        AND task.id IS DISTINCT FROM NEW.id
    ) THEN
    RAISE EXCEPTION 'Complete your dispatched task before starting another task yourself.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_logs_prevent_self_start_while_paused ON public.work_logs;
CREATE TRIGGER work_logs_prevent_self_start_while_paused
BEFORE INSERT OR UPDATE OF status ON public.work_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_start_while_task_paused();

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
  resumed_record JSONB;
  resumed_task_id UUID;
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

    SELECT id INTO resumed_task_id
    FROM public.work_logs
    WHERE user_id = (previous_record ->> 'user_id')::UUID
      AND shift_id IS NOT DISTINCT FROM NULLIF(previous_record ->> 'shift_id', '')::UUID
      AND hotel_id = (previous_record ->> 'hotel_id')::UUID
      AND status = 'paused'
      AND end_time IS NULL
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
    ORDER BY paused_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
    FOR UPDATE;
    IF resumed_task_id IS NOT NULL THEN
      UPDATE public.work_logs
      SET status = 'active', paused_at = NULL, updated_at = statement_timestamp()
      WHERE id = resumed_task_id
      RETURNING to_jsonb(work_logs) INTO resumed_record;
      INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
      VALUES (
        resumed_task_id, p_actor_id, 'edited',
        jsonb_build_object('status', 'paused'),
        jsonb_build_object('status', 'active', 'execution_event', 'suspended_task_resumed', 'property_id', resumed_record ->> 'hotel_id')
      );
    END IF;
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

  RETURN jsonb_build_object(
    'audit_id', audit_id,
    'record', updated_record,
    'resumed_task_id', resumed_task_id
  );
END;
$$;

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
  resumed_record public.work_logs%ROWTYPE;
  resumed_task_id UUID;
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

  SELECT id INTO resumed_task_id
  FROM public.work_logs
  WHERE user_id = previous_record.user_id
    AND shift_id IS NOT DISTINCT FROM previous_record.shift_id
    AND hotel_id = previous_record.hotel_id
    AND status = 'paused'
    AND end_time IS NULL
    AND deleted_at IS NULL
    AND cancelled_at IS NULL
  ORDER BY paused_at DESC NULLS LAST, updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF resumed_task_id IS NOT NULL THEN
    UPDATE public.work_logs
    SET status = 'active', paused_at = NULL, updated_at = effective_end_time
    WHERE id = resumed_task_id
    RETURNING * INTO resumed_record;
    INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
    VALUES (
      resumed_task_id, p_actor_id, 'edited',
      jsonb_build_object('status', 'paused'),
      jsonb_build_object('status', 'active', 'execution_event', 'suspended_task_resumed', 'property_id', resumed_record.hotel_id)
    );
  END IF;

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
    'record', to_jsonb(updated_record),
    'resumed_task_id', resumed_task_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_workforce_shift_notifications(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
