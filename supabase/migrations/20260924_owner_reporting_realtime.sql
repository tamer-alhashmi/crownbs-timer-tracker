-- Owner reporting and realtime support.
-- Revenue is derived from completed work logs and service rates in this schema.
CREATE INDEX IF NOT EXISTS idx_work_logs_hotel_start_time
  ON public.work_logs(hotel_id, start_time);

CREATE INDEX IF NOT EXISTS idx_work_logs_hotel_locked_status
  ON public.work_logs(hotel_id, is_locked, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'work_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_logs;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'hotels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hotels;
  END IF;
END
$$;

ALTER TABLE public.work_logs REPLICA IDENTITY FULL;
ALTER TABLE public.hotels REPLICA IDENTITY FULL;
