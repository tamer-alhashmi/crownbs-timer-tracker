ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 12.00;

UPDATE public.users
SET
    hourly_rate = 12.00
WHERE
    hourly_rate IS NULL;

ALTER TABLE public.users
ALTER COLUMN hourly_rate
SET DEFAULT 12.00,
ALTER COLUMN hourly_rate
SET
    NOT NULL;