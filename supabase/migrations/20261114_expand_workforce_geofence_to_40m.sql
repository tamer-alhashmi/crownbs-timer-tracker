BEGIN;

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
    ELSIF distance_meters > 40 THEN
      message := format('Location Mismatch: You are %sm away from %s. Clock-in is restricted to within 40m of the property.', ROUND(distance_meters)::INTEGER, property_name);
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

REVOKE ALL ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workforce_clock_in(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
