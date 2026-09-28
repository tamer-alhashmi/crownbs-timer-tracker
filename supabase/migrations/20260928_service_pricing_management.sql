BEGIN;

CREATE TABLE IF NOT EXISTS public.services_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'hourly',
  default_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.services_config
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS default_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.services_config
  DROP CONSTRAINT IF EXISTS services_config_unit_check;

UPDATE public.services_config
SET unit = CASE
  WHEN lower(btrim(coalesce(unit, ''))) IN ('per_room', 'per room', 'per-room', 'room', 'rooms', 'room_based') THEN 'per_room'
  WHEN lower(btrim(coalesce(unit, ''))) IN ('fixed', 'per_task', 'per task', 'one_off', 'one-off', 'flat') THEN 'fixed'
  WHEN lower(btrim(coalesce(unit, ''))) IN ('hourly', 'hour', 'hours', 'per_hour', 'per hour') THEN 'hourly'
  WHEN lower(name) IN ('cleaning (per room)', 'linen distribution') THEN 'per_room'
  WHEN lower(name) = 'product delivery' THEN 'fixed'
  ELSE 'hourly'
END
WHERE unit IS NULL OR unit NOT IN ('hourly', 'per_room', 'fixed');

ALTER TABLE public.services_config
  ADD CONSTRAINT services_config_unit_check CHECK (unit IN ('hourly', 'per_room', 'fixed'));

CREATE UNIQUE INDEX IF NOT EXISTS services_config_name_unique_idx
  ON public.services_config (name);

INSERT INTO public.services_config (name, description, unit, default_rate, is_active)
VALUES
  ('Cleaning (Hourly)', 'Cleaning service charged for each recorded hour.', 'hourly', 15.00, TRUE),
  ('Cleaning (Per Room)', 'Cleaning service charged for each completed room.', 'per_room', 8.50, TRUE),
  ('Linen Distribution', 'Linen distribution charged per completed room.', 'per_room', 10.00, TRUE),
  ('Maintenance', 'Maintenance and repair work charged for each recorded hour.', 'hourly', 18.00, TRUE),
  ('Night Shift', 'Night shift service charged for each recorded hour.', 'hourly', 20.00, TRUE),
  ('Product Delivery', 'Product delivery charged as a fixed task rate.', 'fixed', 9.50, TRUE),
  ('Reception', 'Reception service charged for each recorded hour.', 'hourly', 16.00, TRUE)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  default_rate = EXCLUDED.default_rate,
  is_active = TRUE,
  updated_at = NOW();

COMMIT;