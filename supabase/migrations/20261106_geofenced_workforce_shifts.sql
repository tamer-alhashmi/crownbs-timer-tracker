BEGIN;

ALTER TABLE public.master_shifts
  ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES public.hotels(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS role_at_shift TEXT,
  ADD COLUMN IF NOT EXISTS clock_in_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_in_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_in_accuracy DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.master_shifts'::regclass
      AND conname = 'master_shifts_role_at_shift_check'
  ) THEN
    ALTER TABLE public.master_shifts
      ADD CONSTRAINT master_shifts_role_at_shift_check
      CHECK (role_at_shift IS NULL OR role_at_shift IN ('cleaner', 'housekeeping_admin', 'manager'));
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.master_shifts'::regclass
      AND conname = 'master_shifts_clock_in_coordinates_check'
  ) THEN
    ALTER TABLE public.master_shifts
      ADD CONSTRAINT master_shifts_clock_in_coordinates_check
      CHECK (
        (clock_in_lat IS NULL AND clock_in_lng IS NULL)
        OR (
          clock_in_lat BETWEEN -90 AND 90
          AND clock_in_lng BETWEEN -180 AND 180
          AND clock_in_accuracy >= 0
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_geofenced_workforce_shift(
  p_user_id UUID,
  p_property_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION
)
RETURNS UUID
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
  shift_id UUID;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
    OR p_lat NOT BETWEEN -90 AND 90
    OR p_lng NOT BETWEEN -180 AND 180
    OR p_accuracy IS NULL OR p_accuracy < 0 THEN
    RAISE EXCEPTION 'A valid device location is required to clock in.'
      USING ERRCODE = '22023';
  END IF;
  IF p_accuracy > 30 THEN
    RAISE EXCEPTION 'Location accuracy is too low (±%m). Calibrate location or step outside for a stronger GPS lock, then try again.', ROUND(p_accuracy)::INTEGER
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role::TEXT
  INTO actor_role
  FROM public.users AS profile
  WHERE profile.id = p_user_id
    AND profile.is_active = TRUE
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('cleaner', 'manager', 'housekeeping_admin', 'hk_admin') THEN
    RAISE EXCEPTION 'Only active property workforce members can clock in.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.hotels AS property
    WHERE property.id = p_property_id
      AND property.is_active = TRUE
      AND property.archived_at IS NULL
      AND property.latitude IS NOT NULL
      AND property.longitude IS NOT NULL
      AND (
        (actor_role = 'manager' AND property.manager_id = p_user_id)
        OR (
          actor_role IN ('housekeeping_admin', 'hk_admin')
          AND (
            property.id = (SELECT profile.primary_hotel_id FROM public.users AS profile WHERE profile.id = p_user_id)
            OR EXISTS (
              SELECT 1 FROM public.user_hotel_assignments AS assignment
              WHERE assignment.user_id = p_user_id AND assignment.hotel_id = property.id
            )
          )
        )
        OR (
          actor_role = 'cleaner'
          AND (
            property.id = (SELECT profile.primary_hotel_id FROM public.users AS profile WHERE profile.id = p_user_id)
            OR EXISTS (
              SELECT 1 FROM public.user_hotel_assignments AS assignment
              WHERE assignment.user_id = p_user_id AND assignment.hotel_id = property.id
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Choose an active property assigned to your workforce account, with a recorded map location.'
      USING ERRCODE = '22023';
  END IF;

  SELECT property.name, property.latitude, property.longitude
  INTO property_name, property_lat, property_lng
  FROM public.hotels AS property
  WHERE property.id = p_property_id;

  distance_meters := 2 * 6371000 * ASIN(SQRT(LEAST(1.0, GREATEST(0.0,
    POWER(SIN(RADIANS(p_lat - property_lat) / 2), 2)
    + COS(RADIANS(property_lat)) * COS(RADIANS(p_lat))
      * POWER(SIN(RADIANS(p_lng - property_lng) / 2), 2)
  ))));
  IF distance_meters > 20 THEN
    RAISE EXCEPTION 'Location Mismatch: You are %m away from %. Clock-in is restricted to within 20m of the property.',
      ROUND(distance_meters)::INTEGER, property_name
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.master_shifts AS existing
    WHERE existing.user_id = p_user_id
      AND existing.status = 'active'
      AND existing.end_time IS NULL
  ) THEN
    RAISE EXCEPTION 'A master shift is already active.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.master_shifts (
    user_id, hotel_id, role_at_shift, clock_in_lat, clock_in_lng,
    clock_in_accuracy, start_time, status
  )
  VALUES (
    p_user_id,
    p_property_id,
    CASE WHEN actor_role = 'hk_admin' THEN 'housekeeping_admin' ELSE actor_role END,
    p_lat,
    p_lng,
    p_accuracy,
    NOW(),
    'active'
  )
  RETURNING id INTO shift_id;

  RETURN shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_geofenced_workforce_shift(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_geofenced_workforce_shift(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO service_role;

COMMIT;
