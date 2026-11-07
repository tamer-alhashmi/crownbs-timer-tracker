BEGIN;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_duration_seconds BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.work_log_time_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_log_id UUID NOT NULL REFERENCES public.work_logs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_log_time_segments_one_open_segment
  ON public.work_log_time_segments(work_log_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS work_log_time_segments_log_started_idx
  ON public.work_log_time_segments(work_log_id, started_at);

ALTER TABLE public.work_log_time_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_log_time_segments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.work_log_time_segments TO service_role;

INSERT INTO public.work_log_time_segments (work_log_id, started_at, ended_at)
SELECT id, start_time, end_time
FROM public.work_logs
WHERE status IN ('active', 'completed')
  AND start_time IS NOT NULL
  AND (status = 'active' OR end_time IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.work_log_time_segments AS segment
    WHERE segment.work_log_id = work_logs.id
  )
ON CONFLICT DO NOTHING;

UPDATE public.work_logs AS log
SET active_duration_seconds = COALESCE((
  SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (segment.ended_at - segment.started_at)))::BIGINT)
  FROM public.work_log_time_segments AS segment
  WHERE segment.work_log_id = log.id
), 0)
WHERE log.status = 'completed';

CREATE OR REPLACE FUNCTION public.enforce_single_active_work_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  worker_role TEXT;
BEGIN
  IF NEW.status = 'active' AND NEW.end_time IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::TEXT, 0));
    IF EXISTS (
      SELECT 1 FROM public.work_logs AS existing
      WHERE existing.user_id = NEW.user_id
        AND existing.status = 'active'
        AND existing.end_time IS NULL
        AND existing.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Only one task can be active at a time.'
        USING ERRCODE = '23505';
    END IF;

    SELECT role::TEXT INTO worker_role
    FROM public.users
    WHERE id = NEW.user_id AND is_active = TRUE;
    IF worker_role = 'cleaner' AND NOT EXISTS (
      SELECT 1 FROM public.master_shifts AS shift
      WHERE shift.id = NEW.shift_id
        AND shift.user_id = NEW.user_id
        AND shift.hotel_id = NEW.hotel_id
        AND shift.status = 'active'
        AND shift.end_time IS NULL
    ) THEN
      RAISE EXCEPTION 'A task must match your active shift property.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.track_work_log_execution_segments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transition_time TIMESTAMPTZ := statement_timestamp();
  segment_start TIMESTAMPTZ;
  elapsed_seconds BIGINT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    INSERT INTO public.work_log_time_segments (work_log_id, started_at)
    VALUES (NEW.id, COALESCE(NEW.start_time, transition_time));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'active' AND NEW.status IN ('paused', 'completed') THEN
      UPDATE public.work_log_time_segments
      SET ended_at = transition_time
      WHERE work_log_id = NEW.id AND ended_at IS NULL
      RETURNING started_at INTO segment_start;
      IF segment_start IS NOT NULL THEN
        elapsed_seconds := OLD.active_duration_seconds + GREATEST(0, EXTRACT(EPOCH FROM (transition_time - segment_start))::BIGINT);
        UPDATE public.work_logs
        SET active_duration_seconds = elapsed_seconds,
            start_time = transition_time - make_interval(secs => elapsed_seconds::DOUBLE PRECISION),
            paused_at = CASE WHEN NEW.status = 'paused' THEN transition_time ELSE NULL END
        WHERE id = NEW.id;
      END IF;
    ELSIF NEW.status = 'active' AND OLD.status IN ('assigned', 'paused') THEN
      INSERT INTO public.work_log_time_segments (work_log_id, started_at)
      VALUES (NEW.id, transition_time);
      IF OLD.status = 'paused' THEN
        UPDATE public.work_logs
        SET paused_at = NULL,
            start_time = transition_time - make_interval(secs => OLD.active_duration_seconds::DOUBLE PRECISION)
        WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_logs_execution_segments ON public.work_logs;
CREATE TRIGGER work_logs_execution_segments
AFTER INSERT OR UPDATE OF status ON public.work_logs
FOR EACH ROW EXECUTE FUNCTION public.track_work_log_execution_segments();

CREATE OR REPLACE FUNCTION public.accept_assigned_work_log(
  p_task_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_task public.work_logs%ROWTYPE;
  active_task public.work_logs%ROWTYPE;
  active_shift public.master_shifts%ROWTYPE;
  accepted_at TIMESTAMPTZ := statement_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  PERFORM 1 FROM public.users
  WHERE id = p_user_id AND role::TEXT = 'cleaner' AND is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an active cleaner can accept a dispatched task.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO active_shift
  FROM public.master_shifts
  WHERE user_id = p_user_id AND status = 'active' AND end_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
  FOR UPDATE;
  IF active_shift.id IS NULL THEN
    RAISE EXCEPTION 'Clock in before accepting a dispatched task.';
  END IF;

  SELECT * INTO selected_task
  FROM public.work_logs
  WHERE id = p_task_id
    AND user_id = p_user_id
    AND assigned_to = p_user_id
    AND status = 'assigned'
    AND end_time IS NULL
    AND deleted_at IS NULL
    AND cancelled_at IS NULL
  FOR UPDATE;
  IF selected_task.id IS NULL THEN
    RAISE EXCEPTION 'This task is no longer waiting to be started.';
  END IF;
  IF selected_task.hotel_id <> active_shift.hotel_id THEN
    RAISE EXCEPTION 'This dispatched task is not for your active shift property.';
  END IF;

  SELECT * INTO active_task
  FROM public.work_logs
  WHERE user_id = p_user_id
    AND status = 'active'
    AND end_time IS NULL
    AND deleted_at IS NULL
    AND cancelled_at IS NULL
  LIMIT 1
  FOR UPDATE;
  IF active_task.id IS NOT NULL THEN
    IF active_task.hotel_id <> active_shift.hotel_id THEN
      RAISE EXCEPTION 'Your active task does not match your current shift property.';
    END IF;
    UPDATE public.work_logs
    SET status = 'paused', paused_at = accepted_at, updated_at = accepted_at
    WHERE id = active_task.id;
  END IF;

  UPDATE public.work_logs
  SET status = 'active',
      start_time = accepted_at,
      shift_id = active_shift.id,
      paused_at = NULL,
      updated_at = accepted_at
  WHERE id = selected_task.id
  RETURNING * INTO selected_task;

  INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
  VALUES (
    selected_task.id, p_user_id, 'edited',
    jsonb_build_object('status', 'assigned'),
    jsonb_build_object('status', 'active', 'execution_event', 'dispatched_task_accepted', 'property_id', selected_task.hotel_id)
  );
  IF active_task.id IS NOT NULL THEN
    INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
    VALUES (
      active_task.id, p_user_id, 'edited',
      jsonb_build_object('status', 'active'),
      jsonb_build_object('status', 'paused', 'execution_event', 'task_paused_for_dispatch', 'property_id', active_task.hotel_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'accepted_task_id', selected_task.id,
    'paused_task_id', active_task.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_active_work_log(
  p_task_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_shift public.master_shifts%ROWTYPE;
  active_task public.work_logs%ROWTYPE;
  resumed_task public.work_logs%ROWTYPE;
  completed_at TIMESTAMPTZ := statement_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  SELECT * INTO active_shift
  FROM public.master_shifts
  WHERE user_id = p_user_id AND status = 'active' AND end_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
  FOR UPDATE;
  IF active_shift.id IS NULL THEN
    RAISE EXCEPTION 'An active shift is required to complete a task.';
  END IF;

  SELECT * INTO active_task
  FROM public.work_logs
  WHERE id = p_task_id
    AND user_id = p_user_id
    AND status = 'active'
    AND shift_id = active_shift.id
    AND hotel_id = active_shift.hotel_id
    AND end_time IS NULL
    AND is_locked = FALSE
    AND deleted_at IS NULL
    AND cancelled_at IS NULL
  FOR UPDATE;
  IF active_task.id IS NULL THEN
    RAISE EXCEPTION 'The active task was not found for your current shift.';
  END IF;

  UPDATE public.work_logs
  SET end_time = completed_at, status = 'completed',
      notes = COALESCE(p_notes, ''), updated_at = completed_at
  WHERE id = active_task.id;

  INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
  VALUES (
    active_task.id, p_user_id, 'edited',
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'completed', 'execution_event', 'task_completed', 'property_id', active_task.hotel_id)
  );

  SELECT * INTO resumed_task
  FROM public.work_logs
  WHERE user_id = p_user_id
    AND shift_id = active_shift.id
    AND hotel_id = active_shift.hotel_id
    AND status = 'paused'
    AND end_time IS NULL
    AND deleted_at IS NULL
    AND cancelled_at IS NULL
  ORDER BY paused_at DESC NULLS LAST, updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF resumed_task.id IS NOT NULL THEN
    UPDATE public.work_logs
    SET status = 'active', paused_at = NULL, updated_at = completed_at
    WHERE id = resumed_task.id;
    INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
    VALUES (
      resumed_task.id, p_user_id, 'edited',
      jsonb_build_object('status', 'paused'),
      jsonb_build_object('status', 'active', 'execution_event', 'suspended_task_resumed', 'property_id', resumed_task.hotel_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'completed_task_id', active_task.id,
    'resumed_task_id', resumed_task.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_workforce_clock_out(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  shift public.master_shifts%ROWTYPE;
  event_id UUID;
  ended_at TIMESTAMPTZ := statement_timestamp();
  property_name TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  SELECT * INTO shift
  FROM public.master_shifts
  WHERE user_id = p_user_id AND status = 'active' AND end_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
  FOR UPDATE;
  IF shift.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'There is no active shift to clock out from.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_logs
    WHERE user_id = p_user_id
      AND shift_id = shift.id
      AND status IN ('active', 'paused')
      AND end_time IS NULL
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Complete all active and paused tasks before clocking out.');
  END IF;

  UPDATE public.master_shifts
  SET end_time = ended_at, status = 'completed', updated_at = ended_at
  WHERE id = shift.id;
  SELECT name INTO property_name FROM public.hotels WHERE id = shift.hotel_id;
  INSERT INTO public.workforce_shift_events (
    user_id, property_id, event_type, latitude, longitude, accuracy, compliant
  ) VALUES (
    p_user_id, shift.hotel_id, 'clock_out', NULL, NULL, NULL, TRUE
  ) RETURNING id INTO event_id;
  PERFORM public.write_workforce_shift_notifications(
    event_id, p_user_id, shift.hotel_id, 'clock_out', 'info',
    format('Clock-out confirmed: %s at %s', (SELECT full_name FROM public.users WHERE id = p_user_id), COALESCE(property_name, 'property'))
  );
  RETURN jsonb_build_object('success', TRUE, 'shiftId', shift.id, 'eventId', event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_property_workforce_assignments(
  p_owner_id UUID,
  p_property_id UUID,
  p_manager_ids UUID[],
  p_housekeeping_leader_ids UUID[],
  p_cleaner_ids UUID[],
  p_assigned_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_manager_ids UUID[] := COALESCE(p_manager_ids, ARRAY[]::UUID[]);
  selected_leader_ids UUID[] := COALESCE(p_housekeeping_leader_ids, ARRAY[]::UUID[]);
  selected_cleaner_ids UUID[] := COALESCE(p_cleaner_ids, ARRAY[]::UUID[]);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_assigned_by AND role::TEXT = 'super_admin' AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'An active super administrator is required.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hotels
    WHERE id = p_property_id AND owner_id = p_owner_id AND archived_at IS NULL
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'The property does not belong to the requested tenant.';
  END IF;
  IF cardinality(selected_manager_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(selected_manager_ids) AS selected(id))
    OR cardinality(selected_leader_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(selected_leader_ids) AS selected(id))
    OR cardinality(selected_cleaner_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(selected_cleaner_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'Each property role assignment must be unique.';
  END IF;
  IF selected_manager_ids && selected_leader_ids
    OR selected_manager_ids && selected_cleaner_ids
    OR selected_leader_ids && selected_cleaner_ids THEN
    RAISE EXCEPTION 'A team member can only be assigned to their own role.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(selected_manager_ids) AS selected(id)
    LEFT JOIN public.users AS member ON member.id = selected.id
      AND member.role::TEXT = 'manager' AND member.is_active = TRUE
    WHERE member.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM unnest(selected_leader_ids) AS selected(id)
    LEFT JOIN public.users AS member ON member.id = selected.id
      AND member.role::TEXT IN ('housekeeping_admin', 'hk_admin') AND member.is_active = TRUE
    WHERE member.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM unnest(selected_cleaner_ids) AS selected(id)
    LEFT JOIN public.users AS member ON member.id = selected.id
      AND member.role::TEXT = 'cleaner' AND member.is_active = TRUE
    WHERE member.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Choose active users with the matching property role.';
  END IF;

  UPDATE public.hotels
  SET manager_id = selected_manager_ids[1]
  WHERE id = p_property_id;

  INSERT INTO public.user_hotel_assignments (user_id, hotel_id, assigned_by)
  SELECT selected.id, p_property_id, p_assigned_by
  FROM (
    SELECT unnest(selected_manager_ids) AS id
    UNION SELECT unnest(selected_leader_ids)
    UNION SELECT unnest(selected_cleaner_ids)
  ) AS selected
  ON CONFLICT (user_id, hotel_id) DO NOTHING;

  DELETE FROM public.user_hotel_assignments AS assignment
  USING public.users AS member
  WHERE assignment.hotel_id = p_property_id
    AND assignment.user_id = member.id
    AND member.role::TEXT IN ('manager', 'housekeeping_admin', 'hk_admin', 'cleaner')
    AND NOT (
      assignment.user_id = ANY(selected_manager_ids)
      OR assignment.user_id = ANY(selected_leader_ids)
      OR assignment.user_id = ANY(selected_cleaner_ids)
    );

  UPDATE public.users AS member
  SET primary_hotel_id = NULL
  WHERE member.primary_hotel_id = p_property_id
    AND member.role::TEXT IN ('manager', 'housekeeping_admin', 'hk_admin', 'cleaner')
    AND NOT (
      member.id = ANY(selected_manager_ids)
      OR member.id = ANY(selected_leader_ids)
      OR member.id = ANY(selected_cleaner_ids)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_hotel_assignments AS assignment
      WHERE assignment.user_id = member.id AND assignment.hotel_id = p_property_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_assigned_work_log(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_active_work_log(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_property_workforce_assignments(UUID, UUID, UUID[], UUID[], UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_assigned_work_log(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_active_work_log(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_property_workforce_assignments(UUID, UUID, UUID[], UUID[], UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workforce_clock_out(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
