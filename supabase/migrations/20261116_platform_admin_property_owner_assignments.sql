BEGIN;

CREATE OR REPLACE FUNCTION public.manage_property_owner_assignment(
  p_property_id UUID,
  p_owner_id UUID,
  p_actor_id UUID,
  p_assignment TEXT,
  p_expected_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  property_owner_id UUID;
  actor_role TEXT;
  owner_is_active BOOLEAN;
  owner_email_verified BOOLEAN;
BEGIN
  SELECT role::TEXT INTO actor_role
  FROM public.users
  WHERE id = p_actor_id AND is_active = TRUE;

  IF actor_role IS NULL OR actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'An active Platform Admin is required to manage property owners.'
      USING ERRCODE = '42501';
  END IF;

  SELECT owner_id INTO property_owner_id
  FROM public.hotels
  WHERE id = p_property_id AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property is not available.';
  END IF;

  IF p_assignment IS NULL OR p_assignment NOT IN ('primary', 'transfer', 'primary_remove', 'co_owner_add', 'co_owner_remove') THEN
    RAISE EXCEPTION 'Choose a valid property owner assignment.';
  END IF;

  IF p_assignment <> 'primary_remove' THEN
    SELECT is_active, email_verified INTO owner_is_active, owner_email_verified
    FROM public.users
    WHERE id = p_owner_id AND role::TEXT = 'owner';

    IF NOT FOUND OR owner_is_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Choose an active Owner account.';
    END IF;

    IF p_assignment = 'co_owner_add' AND owner_email_verified IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Property partners must be verified Owner accounts.';
    END IF;
  END IF;

  IF p_assignment IN ('primary', 'transfer') THEN
    IF p_assignment = 'primary' AND property_owner_id IS NOT NULL AND property_owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'The property already has a primary owner.';
    END IF;

    IF p_assignment = 'transfer' AND property_owner_id IS DISTINCT FROM p_expected_owner_id THEN
      RAISE EXCEPTION 'Property ownership changed while you were assigning it. Refresh and try again.';
    END IF;

    UPDATE public.hotels
    SET owner_id = p_owner_id
    WHERE id = p_property_id;

    IF property_owner_id IS DISTINCT FROM p_owner_id THEN
      UPDATE public.users
      SET primary_hotel_id = NULL
      WHERE id = property_owner_id AND primary_hotel_id = p_property_id;

      UPDATE public.users
      SET primary_hotel_id = p_property_id
      WHERE id = p_owner_id AND primary_hotel_id IS NULL;

      UPDATE public.property_co_owners
      SET removed_at = statement_timestamp()
      WHERE property_id = p_property_id
        AND owner_id = p_owner_id
        AND removed_at IS NULL;
    END IF;
  ELSIF p_assignment = 'primary_remove' THEN
    IF property_owner_id IS DISTINCT FROM p_owner_id THEN
      RAISE EXCEPTION 'This user is not the primary owner of the property.';
    END IF;

    UPDATE public.hotels
    SET owner_id = NULL
    WHERE id = p_property_id;

    UPDATE public.users
    SET primary_hotel_id = NULL
    WHERE id = p_owner_id AND primary_hotel_id = p_property_id;
  ELSIF p_assignment = 'co_owner_add' THEN
    IF property_owner_id = p_owner_id THEN
      RAISE EXCEPTION 'The primary property owner cannot also be added as a partner.';
    END IF;

    INSERT INTO public.property_co_owners (property_id, owner_id, added_by)
    SELECT p_property_id, p_owner_id, p_actor_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.property_co_owners
      WHERE property_id = p_property_id
        AND owner_id = p_owner_id
        AND removed_at IS NULL
    );
  ELSE
    UPDATE public.property_co_owners
    SET removed_at = statement_timestamp()
    WHERE property_id = p_property_id
      AND owner_id = p_owner_id
      AND removed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This user is not linked as a property partner.';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_property_owner_assignment(UUID, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_property_owner_assignment(UUID, UUID, UUID, TEXT, UUID)
  TO service_role;

COMMIT;
