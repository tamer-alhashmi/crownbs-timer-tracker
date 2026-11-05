BEGIN;

CREATE TABLE IF NOT EXISTS public.workforce_shift_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'geofence_breach')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  compliant BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK (accuracy IS NULL OR accuracy >= 0),
  CHECK (distance_meters IS NULL OR distance_meters >= 0)
);

CREATE INDEX IF NOT EXISTS workforce_shift_events_property_time_idx
  ON public.workforce_shift_events (property_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.workforce_security_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_event_id UUID NOT NULL UNIQUE REFERENCES public.workforce_shift_events(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE RESTRICT,
  incident_type TEXT NOT NULL CHECK (incident_type = 'geofence_breach'),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS workforce_security_incidents_property_time_idx
  ON public.workforce_security_incidents (property_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.workforce_shift_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_event_id UUID NOT NULL REFERENCES public.workforce_shift_events(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'high')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shift_event_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS workforce_shift_notifications_recipient_idx
  ON public.workforce_shift_notifications (recipient_id, created_at DESC);

ALTER TABLE public.workforce_shift_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_shift_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workforce_shift_events, public.workforce_security_incidents, public.workforce_shift_notifications
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workforce_shift_events, public.workforce_security_incidents, public.workforce_shift_notifications
  TO service_role;

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
  property_owner UUID;
  property_manager UUID;
BEGIN
  SELECT profile.role::TEXT INTO user_role
  FROM public.users AS profile WHERE profile.id = p_user_id;

  SELECT property.owner_id, property.manager_id INTO property_owner, property_manager
  FROM public.hotels AS property WHERE property.id = p_property_id;

  INSERT INTO public.workforce_shift_notifications (
    shift_event_id, recipient_id, severity, title, body
  )
  SELECT p_event_id,
         recipient.id,
         p_severity,
         CASE
           WHEN p_event_type = 'geofence_breach' THEN 'Geofence breach attempt'
           WHEN p_event_type = 'clock_in' THEN 'Clock-in confirmed'
           ELSE 'Clock-out confirmed'
         END,
         p_body
  FROM (
    SELECT property_owner AS id
    UNION
    SELECT property_manager WHERE user_role IN ('cleaner', 'hk_admin', 'housekeeping_admin')
    UNION
    SELECT assignment.user_id
    FROM public.user_hotel_assignments AS assignment
    JOIN public.users AS supervisor ON supervisor.id = assignment.user_id
    WHERE assignment.hotel_id = p_property_id
      AND user_role = 'cleaner'
      AND supervisor.role::TEXT IN ('hk_admin', 'housekeeping_admin')
    UNION
    SELECT property_owner WHERE user_role IN ('cleaner', 'hk_admin', 'housekeeping_admin', 'manager')
  ) AS recipient
  JOIN public.users AS target ON target.id = recipient.id
  WHERE recipient.id IS NOT NULL
    AND recipient.id <> p_user_id
    AND target.is_active = TRUE
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
      (actor_role = 'manager' AND property.manager_id = p_user_id)
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

CREATE OR REPLACE FUNCTION public.record_workforce_clock_out(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  shift public.master_shifts%ROWTYPE;
  event_id UUID;
  ended_at TIMESTAMPTZ := NOW();
  property_name TEXT;
  active_task_id UUID;
BEGIN
  SELECT * INTO shift
  FROM public.master_shifts
  WHERE user_id = p_user_id AND status = 'active' AND end_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
  FOR UPDATE;
  IF shift.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'There is no active shift to clock out from.');
  END IF;

  SELECT id INTO active_task_id
  FROM public.work_logs
  WHERE user_id = p_user_id AND status = 'active' AND end_time IS NULL
    AND deleted_at IS NULL AND cancelled_at IS NULL
  LIMIT 1;
  IF active_task_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'End your active task before clocking out.');
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

CREATE OR REPLACE FUNCTION public.get_workforce_attendance_summary(p_property_ids UUID[])
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_properties AS (
    SELECT property.id
    FROM public.hotels AS property
    WHERE p_property_ids IS NULL OR property.id = ANY(p_property_ids)
  ), event_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE event.event_type = 'clock_in' AND event.compliant) AS compliant_clock_ins,
      COUNT(*) FILTER (WHERE event.event_type = 'geofence_breach') AS breach_attempts
    FROM public.workforce_shift_events AS event
    JOIN scoped_properties AS property ON property.id = event.property_id
  )
  SELECT jsonb_build_object(
    'activeShifts',
    (SELECT COUNT(*) FROM public.master_shifts AS shift JOIN scoped_properties AS property ON property.id = shift.hotel_id WHERE shift.status = 'active' AND shift.end_time IS NULL),
    'compliantClockIns',
    event_totals.compliant_clock_ins,
    'breachAttempts',
    event_totals.breach_attempts,
    'compliancePercent',
    CASE
      WHEN event_totals.compliant_clock_ins + event_totals.breach_attempts = 0 THEN NULL
      ELSE ROUND(100.0 * event_totals.compliant_clock_ins
        / (event_totals.compliant_clock_ins + event_totals.breach_attempts), 1)
    END
  )
  FROM event_totals;
$$;

REVOKE ALL ON FUNCTION public.write_workforce_shift_notifications(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workforce_clock_out(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_workforce_attendance_summary(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workforce_clock_out(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_workforce_attendance_summary(UUID[])
  TO service_role;

COMMIT;
