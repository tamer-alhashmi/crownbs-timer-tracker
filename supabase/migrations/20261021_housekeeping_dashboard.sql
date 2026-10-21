BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS housekeeping_status TEXT NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS inspection_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_housekeeping_status_check;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_housekeeping_status_check
    CHECK (housekeeping_status IN ('dirty', 'in_progress', 'inspect_ready', 'clean'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;
END
$$;

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
NOTIFY pgrst, 'reload schema';

COMMIT;
