BEGIN;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'vacant';

UPDATE public.rooms
SET availability_status = CASE
  WHEN status = 'maintenance' THEN 'maintenance'
  WHEN status = 'inactive' THEN 'out_of_order'
  ELSE 'vacant'
END
WHERE availability_status = 'vacant';

UPDATE public.rooms
SET housekeeping_status = 'in_progress'
WHERE status = 'cleaning'
  AND housekeeping_status = 'clean';

ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_availability_status_check;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_availability_status_check
  CHECK (availability_status IN ('vacant', 'occupied', 'maintenance', 'out_of_order'));

NOTIFY pgrst, 'reload schema';

COMMIT;
