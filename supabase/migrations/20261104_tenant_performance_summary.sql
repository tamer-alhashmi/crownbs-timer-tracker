CREATE OR REPLACE FUNCTION public.get_tenant_performance_summary(
  p_owner_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE (
  task_count BIGINT,
  completed_tasks BIGINT,
  completed_hours NUMERIC,
  labor_cost NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tenant_logs AS (
    SELECT
      work_log.status,
      work_log.start_time,
      work_log.end_time,
      work_log.rooms_completed,
      work_log.cost_override,
      COALESCE(work_log.service_name_snapshot, service.name, 'Service') AS service_name,
      COALESCE(service.unit, 'hourly') AS billing_unit,
      COALESCE(service.default_rate, 0) AS configured_rate
    FROM public.work_logs AS work_log
    JOIN public.hotels AS hotel ON hotel.id = work_log.hotel_id
    LEFT JOIN public.services_config AS service ON service.id = work_log.service_id
    WHERE hotel.owner_id = p_owner_id
      AND work_log.deleted_at IS NULL
      AND work_log.cancelled_at IS NULL
      AND (p_from IS NULL OR COALESCE(work_log.task_date, work_log.start_time::DATE) >= p_from)
      AND (p_to IS NULL OR COALESCE(work_log.task_date, work_log.start_time::DATE) <= p_to)
  ),
  priced_logs AS (
    SELECT *,
      CASE
        WHEN cost_override IS NOT NULL AND cost_override >= 0 THEN cost_override
        ELSE
          CASE billing_unit
            WHEN 'per_room' THEN rooms_completed * resolved_rate
            WHEN 'fixed' THEN resolved_rate
            ELSE GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(end_time, start_time) - start_time)) / 3600) * resolved_rate
          END
      END AS calculated_cost
    FROM (
      SELECT *,
        CASE
          WHEN configured_rate > 0 THEN configured_rate
          ELSE CASE lower(btrim(service_name))
            WHEN 'cleaning (hourly)' THEN 15
            WHEN 'cleaning (per room)' THEN 8.5
            WHEN 'linen distribution' THEN 10
            WHEN 'maintenance' THEN 18
            WHEN 'night shift' THEN 20
            WHEN 'product delivery' THEN 9.5
            WHEN 'reception' THEN 16
            ELSE 12
          END
        END AS resolved_rate
      FROM tenant_logs
    ) AS rated_logs
  )
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT,
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (end_time - start_time)) / 3600))
      FILTER (WHERE status = 'completed'), 0)::NUMERIC,
    COALESCE(SUM(calculated_cost) FILTER (WHERE status = 'completed'), 0)::NUMERIC
  FROM priced_logs;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_performance_summary(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_performance_summary(UUID, DATE, DATE) TO service_role;
