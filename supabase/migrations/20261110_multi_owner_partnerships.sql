BEGIN;

CREATE TABLE IF NOT EXISTS public.property_co_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  added_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS property_co_owners_active_property_owner_idx
  ON public.property_co_owners (property_id, owner_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS property_co_owners_owner_property_idx
  ON public.property_co_owners (owner_id, property_id);

ALTER TABLE public.property_co_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_co_owners FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.property_co_owners TO service_role;

CREATE OR REPLACE FUNCTION public.is_verified_property_owner(
  p_property_id UUID,
  p_owner_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_owner_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.hotels AS property
      JOIN public.users AS owner ON owner.id = p_owner_id
      WHERE property.id = p_property_id
        AND property.is_active = TRUE
        AND property.archived_at IS NULL
        AND owner.role::TEXT = 'owner'
        AND owner.is_active = TRUE
        AND (
          property.owner_id = p_owner_id
          OR (
            owner.email_verified = TRUE
            AND EXISTS (
              SELECT 1
              FROM public.property_co_owners AS partner
              WHERE partner.property_id = property.id
                AND partner.owner_id = p_owner_id
                AND partner.removed_at IS NULL
            )
          )
        )
    )
$$;

REVOKE ALL ON FUNCTION public.is_verified_property_owner(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_verified_property_owner(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "Verified property co-owners read operational users" ON public.users;
CREATE POLICY "Verified property co-owners read operational users"
  ON public.users FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.hotels AS property
      WHERE public.is_verified_property_owner(property.id, auth.uid())
        AND (
          users.id = property.owner_id
          OR users.id = property.manager_id
          OR users.primary_hotel_id = property.id
          OR public.is_user_assigned_to_hotel(users.id, property.id)
        )
    )
  );

DROP POLICY IF EXISTS "Verified property co-owners read assigned hotels" ON public.hotels;
CREATE POLICY "Verified property co-owners read assigned hotels"
  ON public.hotels FOR SELECT TO authenticated
  USING (public.is_verified_property_owner(id, auth.uid()));

DROP POLICY IF EXISTS "Verified property co-owners read rooms" ON public.rooms;
CREATE POLICY "Verified property co-owners read rooms"
  ON public.rooms FOR SELECT TO authenticated
  USING (public.is_verified_property_owner(hotel_id, auth.uid()));

DROP POLICY IF EXISTS "Verified property co-owners read work logs" ON public.work_logs;
CREATE POLICY "Verified property co-owners read work logs"
  ON public.work_logs FOR SELECT TO authenticated
  USING (public.is_verified_property_owner(hotel_id, auth.uid()));

DROP POLICY IF EXISTS "Verified property co-owners read shifts" ON public.master_shifts;
CREATE POLICY "Verified property co-owners read shifts"
  ON public.master_shifts FOR SELECT TO authenticated
  USING (
    public.is_verified_property_owner(hotel_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.work_logs AS log
      WHERE log.shift_id = master_shifts.id
        AND public.is_verified_property_owner(log.hotel_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Verified property co-owners read tenant services" ON public.services_config;
CREATE POLICY "Verified property co-owners read tenant services"
  ON public.services_config FOR SELECT TO authenticated
  USING (
    (hotel_id IS NOT NULL AND public.is_verified_property_owner(hotel_id, auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.hotels AS property
      WHERE (
        property.owner_id = services_config.owner_id
        OR EXISTS (
          SELECT 1
          FROM public.property_co_owners AS partner
          WHERE partner.property_id = property.id
            AND partner.owner_id = services_config.owner_id
            AND partner.removed_at IS NULL
        )
      )
        AND public.is_verified_property_owner(property.id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Verified property co-owners read assignments" ON public.user_hotel_assignments;
CREATE POLICY "Verified property co-owners read assignments"
  ON public.user_hotel_assignments FOR SELECT TO authenticated
  USING (public.is_verified_property_owner(hotel_id, auth.uid()));

DROP POLICY IF EXISTS "Verified property co-owners read work-log audit" ON public.work_log_audit;
CREATE POLICY "Verified property co-owners read work-log audit"
  ON public.work_log_audit FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_logs AS log
      WHERE log.id = work_log_audit.work_log_id
        AND public.is_verified_property_owner(log.hotel_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Verified property co-owners read intervention audit" ON public.operations_override_audit;
CREATE POLICY "Verified property co-owners read intervention audit"
  ON public.operations_override_audit FOR SELECT TO authenticated
  USING (
    (entity_type = 'task' AND EXISTS (
      SELECT 1 FROM public.work_logs AS log
      WHERE log.id = operations_override_audit.entity_id
        AND public.is_verified_property_owner(log.hotel_id, auth.uid())
    ))
    OR (entity_type = 'shift' AND EXISTS (
      SELECT 1 FROM public.master_shifts AS shift
      WHERE shift.id = operations_override_audit.entity_id
        AND (
          public.is_verified_property_owner(shift.hotel_id, auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.work_logs AS log
            WHERE log.shift_id = shift.id
              AND public.is_verified_property_owner(log.hotel_id, auth.uid())
          )
        )
    ))
  );

DROP POLICY IF EXISTS "Verified property co-owners read room evidence" ON public.room_media;
CREATE POLICY "Verified property co-owners read room evidence"
  ON public.room_media FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_logs AS log
      WHERE log.id = room_media.work_log_id
        AND public.is_verified_property_owner(log.hotel_id, auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.replace_property_co_owners(
  p_property_id UUID,
  p_owner_ids UUID[],
  p_actor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_owner_ids UUID[] := COALESCE(p_owner_ids, ARRAY[]::UUID[]);
  canonical_owner_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_actor_id AND role::TEXT IN ('super_admin', 'admin') AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'An active Super Admin is required to manage property partnerships.'
      USING ERRCODE = '42501';
  END IF;

  SELECT owner_id INTO canonical_owner_id
  FROM public.hotels
  WHERE id = p_property_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property is not available.';
  END IF;

  IF cardinality(selected_owner_ids) <> (
    SELECT COUNT(DISTINCT selected.id) FROM unnest(selected_owner_ids) AS selected(id)
  ) THEN
    RAISE EXCEPTION 'Partner owners must be unique.';
  END IF;
  IF canonical_owner_id = ANY(selected_owner_ids) THEN
    RAISE EXCEPTION 'The primary property owner cannot also be added as a partner.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(selected_owner_ids) AS selected(id)
    LEFT JOIN public.users AS owner
      ON owner.id = selected.id
      AND owner.role::TEXT = 'owner'
      AND owner.is_active = TRUE
      AND owner.email_verified = TRUE
    WHERE owner.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every property partner must be an active, verified Owner.';
  END IF;

  UPDATE public.property_co_owners
  SET removed_at = statement_timestamp()
  WHERE property_id = p_property_id AND removed_at IS NULL;
  INSERT INTO public.property_co_owners (property_id, owner_id, added_by)
  SELECT p_property_id, selected.id, p_actor_id
  FROM unnest(selected_owner_ids) AS selected(id);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_property_co_owners(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_property_co_owners(UUID, UUID[], UUID)
  TO service_role;

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

  SELECT role INTO v_actor_role
  FROM public.users
  WHERE id = p_actor_id AND is_active = TRUE;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'super_admin', 'owner') THEN
    RAISE EXCEPTION 'Only a Platform Admin or Property Owner can force-end and approve a Manager task.';
  END IF;

  SELECT * INTO previous_record
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

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = previous_record.user_id AND role = 'manager') THEN
    RAISE EXCEPTION 'This action is only available for tasks assigned to a Manager.';
  END IF;

  IF v_actor_role = 'owner' AND NOT EXISTS (
    SELECT 1
    FROM public.hotels AS property
    JOIN public.users AS owner ON owner.id = p_actor_id
    WHERE property.id = previous_record.hotel_id
      AND property.is_active = TRUE
      AND property.archived_at IS NULL
      AND (
        property.owner_id = p_actor_id
        OR (
          owner.email_verified = TRUE
          AND EXISTS (
            SELECT 1 FROM public.property_co_owners AS partner
            WHERE partner.property_id = property.id
              AND partner.owner_id = p_actor_id
              AND partner.removed_at IS NULL
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'This task is outside the Owner property scope.';
  END IF;
  IF previous_record.start_time > effective_end_time THEN
    RAISE EXCEPTION 'The task start time is in the future and cannot be finalized.';
  END IF;
  IF previous_record.shift_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.master_shifts
    WHERE id = previous_record.shift_id
      AND status = 'active'
      AND end_time IS NULL
      AND start_time > effective_end_time
  ) THEN
    RAISE EXCEPTION 'The linked shift starts in the future and cannot be finalized.';
  END IF;

  v_override_reason := format(
    'Force-ended and approved by %s.',
    CASE WHEN v_actor_role = 'super_admin' THEN 'Super Admin'
      WHEN v_actor_role = 'owner' THEN 'Owner'
      ELSE 'Admin' END
  );
  IF previous_record.shift_id IS NOT NULL THEN
    UPDATE public.master_shifts
    SET end_time = effective_end_time, status = 'completed', overridden_by = p_actor_id,
        override_reason = v_override_reason, updated_at = effective_end_time
    WHERE id = previous_record.shift_id AND status = 'active' AND end_time IS NULL;
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

  INSERT INTO public.work_log_audit (work_log_id, actor_id, action, previous_values, new_values)
  VALUES (
    p_task_id, p_actor_id, 'approved', to_jsonb(previous_record),
    to_jsonb(updated_record) || jsonb_build_object('audit_note', v_override_reason)
  )
  RETURNING id INTO work_log_audit_id;
  INSERT INTO public.operations_override_audit (
    entity_type, entity_id, action, actor_id, override_reason, previous_values, new_values
  )
  VALUES ('task', p_task_id, 'force_complete_task', p_actor_id, v_override_reason, to_jsonb(previous_record), to_jsonb(updated_record))
  RETURNING id INTO operations_audit_id;

  RETURN jsonb_build_object(
    'work_log_audit_id', work_log_audit_id,
    'operations_audit_id', operations_audit_id,
    'record', to_jsonb(updated_record)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.force_end_approve_manager_task(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_end_approve_manager_task(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_management_override_audit_page(
  p_hotel_ids UUID[],
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20,
  p_action TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH audit_items AS (
    SELECT
      audit.id,
      audit.entity_type,
      audit.entity_id,
      audit.action,
      audit.actor_id,
      audit.override_reason,
      audit.previous_values,
      audit.new_values,
      audit.created_at
    FROM public.operations_override_audit AS audit
    UNION ALL
    SELECT
      audit.id,
      'task'::TEXT AS entity_type,
      audit.work_log_id AS entity_id,
      audit.action,
      audit.actor_id,
      COALESCE(audit.new_values ->> 'audit_note', 'Work-log action') AS override_reason,
      audit.previous_values,
      audit.new_values,
      audit.created_at
    FROM public.work_log_audit AS audit
  ),
  scoped AS MATERIALIZED (
    SELECT
      audit.*,
      CASE
        WHEN audit.entity_type = 'task' THEN COALESCE(
          NULLIF(audit.new_values ->> 'hotel_id', '')::UUID,
          NULLIF(audit.previous_values ->> 'hotel_id', '')::UUID,
          (SELECT log.hotel_id FROM public.work_logs AS log WHERE log.id = audit.entity_id)
        )
        ELSE (
          SELECT COALESCE(
            NULLIF(audit.new_values ->> 'hotel_id', '')::UUID,
            NULLIF(audit.previous_values ->> 'hotel_id', '')::UUID,
            shift.hotel_id,
            cleaner.primary_hotel_id,
            (SELECT log.hotel_id FROM public.work_logs AS log WHERE log.shift_id = shift.id LIMIT 1)
          )
          FROM public.master_shifts AS shift
          LEFT JOIN public.users AS cleaner ON cleaner.id = shift.user_id
          WHERE shift.id = audit.entity_id
        )
      END AS property_id
    FROM audit_items AS audit
  ),
  filtered AS MATERIALIZED (
    SELECT
      audit.id,
      audit.entity_type,
      audit.entity_id,
      audit.action,
      audit.actor_id,
      COALESCE(NULLIF(BTRIM(actor.full_name), ''), NULLIF(BTRIM(actor.email), ''), 'Unknown user') AS actor_name,
      audit.override_reason,
      audit.previous_values,
      audit.new_values,
      audit.created_at,
      audit.property_id,
      EXISTS (
        SELECT 1
        FROM public.property_co_owners AS partner
        WHERE partner.property_id = audit.property_id
          AND partner.owner_id = audit.actor_id
          AND partner.created_at <= audit.created_at
          AND (partner.removed_at IS NULL OR partner.removed_at >= audit.created_at)
      ) AS is_co_owner_action,
      CASE
        WHEN audit.entity_type = 'task' THEN (
          SELECT COALESCE(hotel.name, 'Task')
          FROM public.hotels AS hotel
          WHERE hotel.id = audit.property_id
        )
        ELSE (
          SELECT COALESCE(hotel.name, 'Shift')
          FROM public.hotels AS hotel
          WHERE hotel.id = audit.property_id
        )
      END AS target_label
    FROM scoped AS audit
    LEFT JOIN public.users AS actor ON actor.id = audit.actor_id
    WHERE
      (p_hotel_ids IS NULL OR audit.property_id = ANY(p_hotel_ids))
      AND (p_action IS NULL OR audit.action = p_action)
      AND (
        p_actor IS NULL
        OR actor.full_name ILIKE '%' || p_actor || '%'
        OR actor.email ILIKE '%' || p_actor || '%'
      )
      AND (p_start_date IS NULL OR audit.created_at >= (p_start_date::TIMESTAMP AT TIME ZONE 'Africa/Cairo'))
      AND (p_end_date IS NULL OR audit.created_at < ((p_end_date + 1)::TIMESTAMP AT TIME ZONE 'Africa/Cairo'))
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC, id DESC
    OFFSET (GREATEST(COALESCE(p_page, 1), 1)::BIGINT - 1)
      * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50)
    LIMIT LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT COUNT(*) FROM filtered),
    'records', COALESCE(
      (SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.created_at DESC, page_rows.id DESC) FROM page_rows),
      '[]'::JSONB
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_management_override_audit_page(UUID[], INTEGER, INTEGER, TEXT, TEXT, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_override_audit_page(UUID[], INTEGER, INTEGER, TEXT, TEXT, DATE, DATE)
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
    SELECT partner.owner_id
    FROM public.property_co_owners AS partner
    JOIN public.users AS partner_user ON partner_user.id = partner.owner_id
    WHERE partner.property_id = p_property_id
      AND partner.removed_at IS NULL
      AND partner_user.role::TEXT = 'owner'
      AND partner_user.is_active = TRUE
      AND partner_user.email_verified = TRUE
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
    AND (target.role::TEXT <> 'owner' OR target.email_verified = TRUE)
  ON CONFLICT (shift_event_id, recipient_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.write_workforce_shift_notifications(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_workforce_shift_notifications(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;
