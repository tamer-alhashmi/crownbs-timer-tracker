BEGIN;

ALTER TABLE public.user_hotel_assignments
  ADD COLUMN IF NOT EXISTS id UUID,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.user_hotel_assignments
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.user_hotel_assignments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

DO $$
DECLARE
  primary_key_name TEXT;
BEGIN
  SELECT constraint_row.conname
  INTO primary_key_name
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.user_hotel_assignments'::regclass
    AND constraint_row.contype = 'p';

  IF primary_key_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_hotel_assignments DROP CONSTRAINT %I', primary_key_name);
  END IF;
END
$$;

ALTER TABLE public.user_hotel_assignments
  ADD CONSTRAINT user_hotel_assignments_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS user_hotel_assignments_user_hotel_key
  ON public.user_hotel_assignments (user_id, hotel_id);

INSERT INTO public.user_hotel_assignments (user_id, hotel_id, is_primary)
SELECT id, primary_hotel_id, TRUE
FROM public.users
WHERE primary_hotel_id IS NOT NULL
ON CONFLICT (user_id, hotel_id) DO UPDATE SET is_primary = TRUE;

UPDATE public.user_hotel_assignments assignment
SET is_primary = (assignment.hotel_id = profile.primary_hotel_id)
FROM public.users profile
WHERE profile.id = assignment.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS user_hotel_assignments_one_primary_per_user
  ON public.user_hotel_assignments (user_id)
  WHERE is_primary;

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS floors_sections JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS total_rooms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS floor_section TEXT,
  ADD COLUMN IF NOT EXISTS max_capacity INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS adults_capacity INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS children_capacity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bedroom_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bed_configuration TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS room_amenities JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS room_photos JSONB NOT NULL DEFAULT '[]'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rooms'::regclass
      AND conname = 'rooms_capacity_nonnegative'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_capacity_nonnegative CHECK (
        max_capacity >= 0 AND adults_capacity >= 0 AND children_capacity >= 0 AND bedroom_count >= 0
      );
  END IF;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rooms',
  'rooms',
  FALSE,
  12582912,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.user_hotel_assignments ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
