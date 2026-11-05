BEGIN;

INSERT INTO public.user_hotel_assignments (user_id, hotel_id)
SELECT property.manager_id, property.id
FROM public.hotels AS property
JOIN public.users AS worker ON worker.id = property.manager_id
WHERE worker.role::TEXT IN ('housekeeping_admin', 'hk_admin')
ON CONFLICT (user_id, hotel_id) DO NOTHING;

UPDATE public.hotels AS property
SET manager_id = NULL
FROM public.users AS worker
WHERE worker.id = property.manager_id
  AND worker.role::TEXT IN ('housekeeping_admin', 'hk_admin');

CREATE OR REPLACE FUNCTION public.update_tenant_property_assignments(
  p_owner_id UUID,
  p_property_id UUID,
  p_manager_id UUID,
  p_housekeeping_admin_id UUID,
  p_cleaner_ids UUID[],
  p_assigned_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_property_count INTEGER;
  selected_cleaner_ids UUID[] := COALESCE(p_cleaner_ids, ARRAY[]::UUID[]);
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS admin
    WHERE admin.id = p_assigned_by
      AND admin.role::TEXT = 'super_admin'
      AND admin.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'An active super administrator is required.'
      USING ERRCODE = '42501';
  END IF;

  IF cardinality(selected_cleaner_ids) > 500 THEN
    RAISE EXCEPTION 'Too many cleaners were selected.';
  END IF;

  IF p_manager_id IS NOT NULL AND (
    p_manager_id = p_housekeeping_admin_id
    OR p_manager_id = ANY(selected_cleaner_ids)
    OR NOT EXISTS (
      SELECT 1
      FROM public.users AS manager
      WHERE manager.id = p_manager_id
        AND manager.role::TEXT = 'manager'
        AND manager.is_active = TRUE
    )
  ) THEN
    RAISE EXCEPTION 'Choose an active Property Manager.';
  END IF;

  IF p_housekeeping_admin_id IS NOT NULL AND (
    p_housekeeping_admin_id = ANY(selected_cleaner_ids)
    OR NOT EXISTS (
      SELECT 1
      FROM public.users AS supervisor
      WHERE supervisor.id = p_housekeeping_admin_id
        AND supervisor.role::TEXT IN ('housekeeping_admin', 'hk_admin')
        AND supervisor.is_active = TRUE
    )
  ) THEN
    RAISE EXCEPTION 'Choose an active Housekeeping Admin.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(selected_cleaner_ids) AS selected(id)
    LEFT JOIN public.users AS cleaner
      ON cleaner.id = selected.id
      AND cleaner.role::TEXT = 'cleaner'
      AND cleaner.is_active = TRUE
    WHERE cleaner.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every assigned worker must be an active Cleaner.';
  END IF;

  UPDATE public.hotels
  SET manager_id = p_manager_id
  WHERE id = p_property_id
    AND owner_id = p_owner_id
    AND archived_at IS NULL;

  GET DIAGNOSTICS updated_property_count = ROW_COUNT;
  IF updated_property_count = 0 THEN
    RAISE EXCEPTION 'The property does not belong to the requested tenant.';
  END IF;

  IF p_housekeeping_admin_id IS NOT NULL THEN
    INSERT INTO public.user_hotel_assignments (user_id, hotel_id, assigned_by)
    VALUES (p_housekeeping_admin_id, p_property_id, p_assigned_by)
    ON CONFLICT (user_id, hotel_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_hotel_assignments (user_id, hotel_id, assigned_by)
  SELECT DISTINCT selected.id, p_property_id, p_assigned_by
  FROM unnest(selected_cleaner_ids) AS selected(id)
  ON CONFLICT (user_id, hotel_id) DO NOTHING;

  DELETE FROM public.user_hotel_assignments AS assignment
  USING public.users AS worker
  WHERE assignment.hotel_id = p_property_id
    AND assignment.user_id = worker.id
    AND worker.role::TEXT IN ('cleaner', 'housekeeping_admin', 'hk_admin')
    AND (
      (worker.role::TEXT = 'cleaner' AND NOT (worker.id = ANY(selected_cleaner_ids)))
      OR (
        worker.role::TEXT IN ('housekeeping_admin', 'hk_admin')
        AND (p_housekeeping_admin_id IS NULL OR worker.id <> p_housekeeping_admin_id)
      )
    );

  UPDATE public.users AS worker
  SET primary_hotel_id = NULL
  WHERE worker.primary_hotel_id = p_property_id
    AND (
      (worker.role::TEXT = 'cleaner' AND NOT (worker.id = ANY(selected_cleaner_ids)))
      OR (
        worker.role::TEXT IN ('housekeeping_admin', 'hk_admin')
        AND (p_housekeeping_admin_id IS NULL OR worker.id <> p_housekeeping_admin_id)
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_property_assignments(UUID, UUID, UUID, UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_property_assignments(UUID, UUID, UUID, UUID, UUID[], UUID)
  TO service_role;

COMMIT;
