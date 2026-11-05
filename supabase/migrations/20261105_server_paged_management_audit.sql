BEGIN;

CREATE INDEX IF NOT EXISTS idx_operations_override_audit_created_at
  ON public.operations_override_audit (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operations_override_audit_action_created_at
  ON public.operations_override_audit (action, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operations_override_audit_actor_created_at
  ON public.operations_override_audit (actor_id, created_at DESC, id DESC);

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
  WITH filtered AS MATERIALIZED (
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
      CASE
        WHEN audit.entity_type = 'task' THEN (
          SELECT COALESCE(hotel.name, 'Task')
          FROM public.work_logs AS log
          LEFT JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
          WHERE log.id = audit.entity_id
        )
        ELSE (
          SELECT COALESCE(hotel.name, 'Shift')
          FROM public.master_shifts AS shift
          LEFT JOIN public.users AS cleaner ON cleaner.id = shift.user_id
          LEFT JOIN public.hotels AS hotel ON hotel.id = cleaner.primary_hotel_id
          WHERE shift.id = audit.entity_id
        )
      END AS target_label
    FROM public.operations_override_audit AS audit
    LEFT JOIN public.users AS actor ON actor.id = audit.actor_id
    WHERE
      (
        p_hotel_ids IS NULL
        OR (
          audit.entity_type = 'task'
          AND EXISTS (
            SELECT 1
            FROM public.work_logs AS log
            WHERE log.id = audit.entity_id
              AND log.hotel_id = ANY(p_hotel_ids)
          )
        )
        OR (
          audit.entity_type = 'shift'
          AND (
            EXISTS (
              SELECT 1
              FROM public.master_shifts AS shift
              JOIN public.users AS cleaner ON cleaner.id = shift.user_id
              WHERE shift.id = audit.entity_id
                AND cleaner.primary_hotel_id = ANY(p_hotel_ids)
            )
            OR EXISTS (
              SELECT 1
              FROM public.master_shifts AS shift
              JOIN public.work_logs AS log ON log.shift_id = shift.id
              WHERE shift.id = audit.entity_id
                AND log.hotel_id = ANY(p_hotel_ids)
            )
          )
        )
      )
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
    OFFSET (
      GREATEST(COALESCE(p_page, 1), 1)::BIGINT
      - 1
    ) * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50)
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

CREATE OR REPLACE FUNCTION public.get_management_dashboard_summary(
  p_hotel_ids UUID[],
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_worker UUID DEFAULT NULL,
  p_property UUID DEFAULT NULL,
  p_tenant UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_logs AS MATERIALIZED (
    SELECT
      log.id,
      log.hotel_id,
      hotel.name AS hotel_name,
      log.user_id,
      log.owner_id,
      log.task_date,
      log.status,
      log.is_locked,
      log.rooms_completed,
      log.cost_override,
      log.start_time,
      log.end_time,
      COALESCE(log.service_name_snapshot, service.name, 'Service') AS service_name,
      service.unit AS service_unit,
      service.default_rate,
      CASE
        WHEN service.unit IN ('hourly', 'per_room', 'fixed') THEN service.unit
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) IN ('cleaning (per room)', 'linen distribution')
          OR COALESCE(log.service_name_snapshot, service.name, '') ILIKE '%per room%'
          THEN 'per_room'
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'product delivery'
          THEN 'fixed'
        ELSE 'hourly'
      END AS billing_unit,
      CASE
        WHEN service.default_rate > 0 THEN service.default_rate
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (hourly)' THEN 15
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (per room)' THEN 8.5
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'linen distribution' THEN 10
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'maintenance' THEN 18
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'night shift' THEN 20
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'product delivery' THEN 9.5
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'reception' THEN 16
        ELSE 12
      END AS rate
    FROM public.work_logs AS log
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    LEFT JOIN public.services_config AS service ON service.id = log.service_id
    WHERE log.deleted_at IS NULL
      AND log.cancelled_at IS NULL
      AND (p_hotel_ids IS NULL OR log.hotel_id = ANY(p_hotel_ids))
      AND (p_from IS NULL OR log.task_date >= p_from)
      AND (p_to IS NULL OR log.task_date <= p_to)
      AND (p_worker IS NULL OR log.user_id = p_worker)
      AND (p_property IS NULL OR log.hotel_id = p_property)
      AND (p_tenant IS NULL OR log.owner_id = p_tenant)
  ),
  completed_logs AS MATERIALIZED (
    SELECT
      filtered_logs.*,
      CASE
        WHEN cost_override IS NOT NULL THEN cost_override
        WHEN billing_unit = 'per_room' THEN GREATEST(COALESCE(rooms_completed, 0), 0) * rate
        WHEN billing_unit = 'fixed' THEN rate
        ELSE GREATEST(EXTRACT(EPOCH FROM (COALESCE(end_time, start_time) - start_time)) / 3600, 0) * rate
      END AS labor_cost
    FROM filtered_logs
    WHERE status = 'completed'
  ),
  active_staff AS (
    SELECT COUNT(DISTINCT shift.user_id) AS count
    FROM public.master_shifts AS shift
    JOIN public.users AS cleaner ON cleaner.id = shift.user_id AND cleaner.role = 'cleaner'
    WHERE shift.status = 'active'
      AND shift.end_time IS NULL
      AND (
        p_hotel_ids IS NULL
        OR cleaner.primary_hotel_id = ANY(p_hotel_ids)
        OR EXISTS (
          SELECT 1
          FROM public.work_logs AS log
          WHERE log.shift_id = shift.id
            AND log.deleted_at IS NULL
            AND log.cancelled_at IS NULL
            AND log.hotel_id = ANY(p_hotel_ids)
        )
      )
  ),
  property_summary AS (
    SELECT hotel_id, hotel_name, COUNT(*) FILTER (WHERE status = 'completed') AS completed_logs,
      SUM(rooms_completed) FILTER (WHERE status = 'completed') AS completed_rooms,
      SUM(labor_cost) FILTER (WHERE status = 'completed') AS labor_cost
    FROM completed_logs
    GROUP BY hotel_id, hotel_name
  )
  SELECT jsonb_build_object(
    'totalLogs', (SELECT COUNT(*) FROM filtered_logs),
    'completedLogs', (SELECT COUNT(*) FROM completed_logs),
    'awaitingApprovalLogs', (
      SELECT COUNT(*)
      FROM filtered_logs
      WHERE status = 'completed'
        AND is_locked = FALSE
    ),
    'activeStaff', (SELECT count FROM active_staff),
    'laborCost', COALESCE((SELECT SUM(labor_cost) FROM completed_logs), 0),
    'completedRooms', COALESCE((SELECT SUM(rooms_completed) FROM completed_logs), 0),
    'lockedPayrollLiability', COALESCE((SELECT SUM(labor_cost) FROM completed_logs WHERE is_locked = TRUE), 0),
    'properties', COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'id', hotel_id,
          'name', hotel_name,
          'completedLogs', completed_logs,
          'rooms', COALESCE(completed_rooms, 0),
          'cost', COALESCE(labor_cost, 0)
        ) ORDER BY labor_cost DESC, hotel_name)
        FROM property_summary
      ),
      '[]'::JSONB
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_management_dashboard_summary(UUID[], DATE, DATE, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_dashboard_summary(UUID[], DATE, DATE, UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_management_responsibility_history_page(
  p_hotel_ids UUID[],
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20,
  p_filters JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH records AS MATERIALIZED (
    SELECT
      log.id,
      log.user_id,
      log.hotel_id,
      log.service_id,
      log.shift_id,
      COALESCE(NULLIF(BTRIM(worker.full_name), ''), NULLIF(BTRIM(worker.email), ''), 'Unknown worker') AS cleaner_name,
      hotel.name AS hotel_name,
      COALESCE(worker.role, 'cleaner') AS assignee_role,
      log.start_time,
      log.end_time,
      log.task_date,
      log.status,
      log.cancelled_at,
      COALESCE(log.rooms_completed, 0) AS rooms_completed,
      log.room_number,
      COALESCE(log.room_numbers, ARRAY[]::TEXT[]) AS room_numbers,
      COALESCE(log.room_ids, ARRAY[]::UUID[]) AS room_ids,
      room_refs.reference AS room_reference,
      log.service_name_snapshot,
      log.service_description_snapshot,
      log.notes,
      log.cost_override,
      log.owner_id,
      log.owner_name,
      log.manager_id,
      log.manager_name,
      log.responsibility_recorded_at,
      COALESCE(log.manager_approved, FALSE) AS manager_approved,
      COALESCE(log.owner_approved, FALSE) AS owner_approved,
      COALESCE(log.manager_rejected, FALSE) AS manager_rejected,
      COALESCE(log.owner_rejected, FALSE) AS owner_rejected,
      COALESCE(log.is_locked, FALSE) AS is_locked,
      log.rejection_notes,
      jsonb_build_array(jsonb_build_object(
        'name', COALESCE(log.service_name_snapshot, service.name, 'Service'),
        'description', COALESCE(log.service_description_snapshot, service.description, ''),
        'default_rate', COALESCE(service.default_rate, 0),
        'unit', COALESCE(service.unit, 'hourly')
      )) AS services_config,
      CASE
        WHEN service.unit IN ('hourly', 'per_room', 'fixed') THEN service.unit
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) IN ('cleaning (per room)', 'linen distribution')
          OR COALESCE(log.service_name_snapshot, service.name, '') ILIKE '%per room%'
          THEN 'per_room'
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'product delivery'
          THEN 'fixed'
        ELSE 'hourly'
      END AS billing_unit,
      CASE
        WHEN service.default_rate > 0 THEN service.default_rate
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (hourly)' THEN 15
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (per room)' THEN 8.5
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'linen distribution' THEN 10
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'maintenance' THEN 18
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'night shift' THEN 20
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'product delivery' THEN 9.5
        WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'reception' THEN 16
        ELSE 12
      CASE
        WHEN log.cancelled_at IS NOT NULL OR log.status = 'cancelled' THEN 'Cancelled'
        WHEN log.status = 'active' THEN 'Active'
        WHEN log.status = 'completed' THEN 'Completed'
        ELSE 'Pending'
      END AS lifecycle_status,
      'Manager: '
        || CASE WHEN COALESCE(log.manager_approved, FALSE) THEN 'Approved' WHEN COALESCE(log.manager_rejected, FALSE) THEN 'Rejected' ELSE 'Pending' END
        || ' · Owner: '
        || CASE WHEN COALESCE(log.owner_approved, FALSE) THEN 'Approved' WHEN COALESCE(log.owner_rejected, FALSE) THEN 'Rejected' ELSE 'Pending' END
        AS approval_summary,
      CASE
        WHEN log.end_time IS NULL THEN 0
        ELSE GREATEST(EXTRACT(EPOCH FROM (log.end_time - log.start_time)) / 3600, 0)
      END AS duration_hours,
      CASE
        WHEN log.cost_override IS NOT NULL THEN log.cost_override
        WHEN service.unit = 'per_room'
          OR (
            COALESCE(service.unit, '') NOT IN ('hourly', 'per_room', 'fixed')
            AND (
              LOWER(COALESCE(log.service_name_snapshot, service.name, '')) IN ('cleaning (per room)', 'linen distribution')
              OR COALESCE(log.service_name_snapshot, service.name, '') ILIKE '%per room%'
            )
          )
          THEN GREATEST(COALESCE(log.rooms_completed, 0), 0) * CASE
            WHEN service.default_rate > 0 THEN service.default_rate
            WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (per room)' THEN 8.5
            WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'linen distribution' THEN 10
            ELSE 12
          END
        WHEN service.unit = 'fixed'
          OR (
            COALESCE(service.unit, '') NOT IN ('hourly', 'per_room', 'fixed')
            AND LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'product delivery'
          )
          THEN CASE
            WHEN service.default_rate > 0 THEN service.default_rate
            ELSE 9.5
          END
        ELSE GREATEST(COALESCE(EXTRACT(EPOCH FROM (log.end_time - log.start_time)) / 3600, 0), 0) * CASE
          WHEN service.default_rate > 0 THEN service.default_rate
          WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'cleaning (hourly)' THEN 15
          WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'maintenance' THEN 18
          WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'night shift' THEN 20
          WHEN LOWER(COALESCE(log.service_name_snapshot, service.name, '')) = 'reception' THEN 16
          ELSE 12
        END
      END AS financial_value
    FROM public.work_logs AS log
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    LEFT JOIN public.users AS worker ON worker.id = log.user_id
    LEFT JOIN public.services_config AS service ON service.id = log.service_id
    LEFT JOIN LATERAL (
      SELECT string_agg(room.room_name || CASE WHEN NULLIF(room.floor_section, '') IS NOT NULL THEN ' · ' || room.floor_section ELSE '' END, ', ' ORDER BY room.room_name) AS reference
      FROM public.rooms AS room
      WHERE room.id = ANY(COALESCE(log.room_ids, ARRAY[]::UUID[]))
    ) AS room_refs ON TRUE
    WHERE log.deleted_at IS NULL
      AND (p_hotel_ids IS NULL OR log.hotel_id = ANY(p_hotel_ids))
  ),
  filtered AS MATERIALIZED (
    SELECT *
    FROM records
    WHERE
      (
        COALESCE(jsonb_array_length(p_filters #> '{worker,selected}'), 0) = 0
        OR cleaner_name = ANY(SELECT jsonb_array_elements_text(p_filters #> '{worker,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{facility,selected}'), 0) = 0
        OR hotel_name = ANY(SELECT jsonb_array_elements_text(p_filters #> '{facility,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{owner,selected}'), 0) = 0
        OR COALESCE(owner_name, 'Unassigned owner') = ANY(SELECT jsonb_array_elements_text(p_filters #> '{owner,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{manager,selected}'), 0) = 0
        OR COALESCE(manager_name, 'Unassigned manager') = ANY(SELECT jsonb_array_elements_text(p_filters #> '{manager,selected}'))
      )
      AND (
        COALESCE(p_filters #>> '{date,from}', '') = ''
        OR task_date >= (p_filters #>> '{date,from}')::DATE
      )
      AND (
        COALESCE(p_filters #>> '{date,to}', '') = ''
        OR task_date <= (p_filters #>> '{date,to}')::DATE
      )
      AND (
        COALESCE(p_filters #>> '{snapshot,from}', '') = ''
        OR COALESCE(responsibility_recorded_at, start_time)::DATE >= (p_filters #>> '{snapshot,from}')::DATE
      )
      AND (
        COALESCE(p_filters #>> '{snapshot,to}', '') = ''
        OR COALESCE(responsibility_recorded_at, start_time)::DATE <= (p_filters #>> '{snapshot,to}')::DATE
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{service,selected}'), 0) = 0
        OR COALESCE(service_name_snapshot, services_config->0->>'name', 'Service') = ANY(SELECT jsonb_array_elements_text(p_filters #> '{service,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{status,selected}'), 0) = 0
        OR lifecycle_status = ANY(SELECT jsonb_array_elements_text(p_filters #> '{status,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{approvals,selected}'), 0) = 0
        OR approval_summary = ANY(SELECT jsonb_array_elements_text(p_filters #> '{approvals,selected}'))
      )
      AND (
        COALESCE(jsonb_array_length(p_filters #> '{room,selected}'), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(room_ids) AS selected_room_id
          JOIN public.rooms AS selected_room ON selected_room.id = selected_room_id
          WHERE selected_room.room_name || CASE
            WHEN NULLIF(selected_room.floor_section, '') IS NOT NULL THEN ' · ' || selected_room.floor_section
            ELSE ''
          END = ANY(SELECT jsonb_array_elements_text(p_filters #> '{room,selected}'))
        )
        OR room_numbers && ARRAY(SELECT jsonb_array_elements_text(p_filters #> '{room,selected}'))
        OR room_number = ANY(SELECT jsonb_array_elements_text(p_filters #> '{room,selected}'))
        OR (room_ids = ARRAY[]::UUID[] AND COALESCE(room_reference, NULLIF(array_to_string(room_numbers, ', '), ''), NULLIF(room_number, ''), 'No room or zone')
          = ANY(SELECT jsonb_array_elements_text(p_filters #> '{room,selected}')))
      )
      AND (
        COALESCE(p_filters #>> '{hours,min}', '') = ''
        OR duration_hours >= (p_filters #>> '{hours,min}')::NUMERIC
      )
      AND (
        COALESCE(p_filters #>> '{hours,max}', '') = ''
        OR duration_hours <= (p_filters #>> '{hours,max}')::NUMERIC
      )
      AND (
        COALESCE(p_filters #>> '{value,min}', '') = ''
        OR financial_value >= (p_filters #>> '{value,min}')::NUMERIC
      )
      AND (
        COALESCE(p_filters #>> '{value,max}', '') = ''
        OR financial_value <= (p_filters #>> '{value,max}')::NUMERIC
      )
  ),
  page_rows AS (
    SELECT
      id, user_id, hotel_id, service_id, shift_id,
      cleaner_name AS "cleanerName",
      hotel_name AS "hotelName",
      assignee_role AS "assigneeRole",
      start_time, end_time, task_date, status, cancelled_at, rooms_completed,
      room_number, room_numbers, room_ids,
      CASE WHEN room_reference IS NULL THEN '[]'::JSONB ELSE (
        SELECT jsonb_agg(jsonb_build_object('name', room.room_name, 'floor', COALESCE(room.floor_section, 'Unassigned section')) ORDER BY room.room_name)
        FROM public.rooms AS room
        WHERE room.id = ANY(room_ids)
      ) END AS "roomDetails",
      service_name_snapshot, service_description_snapshot, notes, cost_override,
      owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at,
      manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, rejection_notes,
      services_config
    FROM filtered
    ORDER BY start_time DESC, id DESC
    OFFSET (GREATEST(COALESCE(p_page, 1), 1)::BIGINT - 1) * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50)
    LIMIT LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 50)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT COUNT(*) FROM filtered),
    'records', COALESCE(
      (SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.start_time DESC, page_rows.id DESC) FROM page_rows),
      '[]'::JSONB
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_management_responsibility_history_page(UUID[], INTEGER, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_responsibility_history_page(UUID[], INTEGER, INTEGER, JSONB)
  TO service_role;

COMMIT;
