ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.reassign_tenant_worker(
  p_owner_id UUID,
  p_worker_id UUID,
  p_property_id UUID,
  p_assigned_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_role TEXT;
  updated_property_count INTEGER;
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

  SELECT worker.role::TEXT
  INTO worker_role
  FROM public.users AS worker
  WHERE worker.id = p_worker_id
    AND worker.is_active = TRUE
    AND worker.role::TEXT IN ('manager', 'housekeeping_admin', 'hk_admin', 'cleaner');

  IF worker_role IS NULL THEN
    RAISE EXCEPTION 'Choose an active manager or cleaner.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.hotels AS property
    WHERE property.id = p_property_id
      AND property.owner_id = p_owner_id
      AND property.is_active = TRUE
      AND property.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Choose an active property belonging to this tenant.'
      USING ERRCODE = '22023';
  END IF;

  IF worker_role = 'cleaner' THEN
    UPDATE public.user_hotel_assignments
    SET is_primary = FALSE
    WHERE user_id = p_worker_id
      AND is_primary = TRUE;

    INSERT INTO public.user_hotel_assignments (user_id, hotel_id, assigned_by, is_primary)
    VALUES (p_worker_id, p_property_id, p_assigned_by, TRUE)
    ON CONFLICT (user_id, hotel_id)
    DO UPDATE SET assigned_by = EXCLUDED.assigned_by, is_primary = TRUE;

    UPDATE public.users
    SET primary_hotel_id = p_property_id
    WHERE id = p_worker_id;
  ELSE
    UPDATE public.hotels
    SET manager_id = p_worker_id
    WHERE id = p_property_id
      AND owner_id = p_owner_id
      AND archived_at IS NULL;

    GET DIAGNOSTICS updated_property_count = ROW_COUNT;
    IF updated_property_count = 0 THEN
      RAISE EXCEPTION 'The property is no longer available.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_tenant_worker(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_tenant_worker(UUID, UUID, UUID, UUID) TO service_role;
