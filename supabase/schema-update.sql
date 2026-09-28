-- Hotel Time Tracker: Supabase schema update
-- Run this after the original schema has already been created.
-- Safe to run more than once.

ALTER TABLE public.hotels
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 12.00;

CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    hotel_id UUID NOT NULL REFERENCES public.hotels (id) ON DELETE CASCADE,
    room_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    max_capacity INTEGER NOT NULL DEFAULT 0 CHECK (max_capacity >= 0),
    adult INTEGER NOT NULL DEFAULT 0 CHECK (adult >= 0),
    children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
    bedroom INTEGER NOT NULL DEFAULT 0 CHECK (bedroom >= 0),
    bed_configs TEXT NOT NULL DEFAULT '',
    photos TEXT NOT NULL DEFAULT '',
    amenities TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rooms_hotel_room_category_key UNIQUE (hotel_id, room_name, category)
);

ALTER TABLE public.services_config
ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'hourly';

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

CREATE TABLE IF NOT EXISTS public.master_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    status work_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT master_shifts_valid_time CHECK (
        end_time IS NULL
        OR end_time >= start_time
    )
);

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.master_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS room_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_date DATE,
  ADD COLUMN IF NOT EXISTS room_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS service_description_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manager_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_notes TEXT,
  ADD COLUMN IF NOT EXISTS import_key TEXT,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.work_logs AS log
SET room_ids = ARRAY(
  SELECT room.id
  FROM public.rooms AS room
  WHERE room.hotel_id = log.hotel_id
    AND room.room_name = ANY(COALESCE(log.room_numbers, '{}'::TEXT[]))
)
WHERE cardinality(COALESCE(log.room_ids, '{}'::UUID[])) = 0;

CREATE TABLE IF NOT EXISTS public.work_log_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    work_log_id UUID NOT NULL REFERENCES public.work_logs (id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (
        action IN (
            'created',
            'edited',
            'approved',
            'rejected',
            'unapproved'
        )
    ),
    previous_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.room_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    work_log_id UUID NOT NULL REFERENCES public.work_logs (id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
    bucket_id TEXT NOT NULL DEFAULT 'room-media',
    storage_path TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (
        media_type IN ('image', 'video')
    ),
    content_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (
        file_size_bytes > 0
        AND file_size_bytes <= 52428800
    ),
    uploaded_by UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT room_media_bucket_path_key UNIQUE (bucket_id, storage_path)
);

ALTER TABLE public.room_media
ADD COLUMN IF NOT EXISTS work_log_id UUID,
ADD COLUMN IF NOT EXISTS content_type TEXT,
ADD COLUMN IF NOT EXISTS original_name TEXT,
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- Repair any old invalid active rows before applying the lock trigger.
UPDATE public.work_logs
SET
    is_locked = FALSE,
    manager_approved = FALSE,
    owner_approved = FALSE,
    manager_approved_at = NULL,
    owner_approved_at = NULL
WHERE
    status <> 'completed'
    AND is_locked = TRUE;

CREATE INDEX IF NOT EXISTS idx_rooms_hotel_id ON public.rooms (hotel_id);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms (status);

CREATE INDEX IF NOT EXISTS idx_master_shifts_user_id ON public.master_shifts (user_id);

CREATE INDEX IF NOT EXISTS idx_master_shifts_status ON public.master_shifts (status);

CREATE INDEX IF NOT EXISTS idx_work_logs_shift_id ON public.work_logs (shift_id);

CREATE INDEX IF NOT EXISTS idx_work_logs_task_date ON public.work_logs (task_date);

CREATE INDEX IF NOT EXISTS idx_work_logs_room_ids ON public.work_logs USING GIN (room_ids);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_media_bucket_path ON public.room_media (bucket_id, storage_path);

CREATE INDEX IF NOT EXISTS idx_room_media_work_log_room ON public.room_media (
    work_log_id,
    room_id,
    created_at DESC
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_import_key ON public.work_logs (import_key)
WHERE
    import_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_log_audit_log_id ON public.work_log_audit (work_log_id);

CREATE INDEX IF NOT EXISTS idx_users_email_pin_code ON public.users (email, pin_code);

CREATE INDEX IF NOT EXISTS idx_work_logs_user_status ON public.work_logs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_work_logs_shift_status ON public.work_logs (shift_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_master_shift_per_user ON public.master_shifts (user_id)
WHERE
    status = 'active';

CREATE OR REPLACE FUNCTION public.enforce_work_log_approval_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Management edits are permitted after payroll lock and remain fully audited.
  NEW.is_locked := NEW.manager_approved AND NEW.owner_approved;

  IF NEW.is_locked AND (NEW.status <> 'completed' OR NEW.end_time IS NULL) THEN
    RAISE EXCEPTION 'Only completed work logs can be locked for payroll';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_log_approval_lock ON public.work_logs;

CREATE TRIGGER work_log_approval_lock
BEFORE UPDATE ON public.work_logs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_log_approval_lock();

UPDATE public.services_config
SET
    description = CASE name
        WHEN 'Cleaning (Hourly)' THEN 'Cleaning service paid by recorded hours.'
        WHEN 'Cleaning (Per Room)' THEN 'Room-based cleaning service paid per completed room.'
        WHEN 'Maintenance' THEN 'Maintenance and repair work for selected rooms.'
        WHEN 'Linen Distribution' THEN 'Linen distribution service.'
        WHEN 'Product Delivery' THEN 'Hotel product delivery service.'
        ELSE name
    END
WHERE
    description = '';

UPDATE public.work_logs AS wl
SET task_date = COALESCE(wl.task_date, (wl.start_time AT TIME ZONE 'Europe/London')::date),
    room_numbers = CASE
      WHEN cardinality(wl.room_numbers) > 0 THEN wl.room_numbers
      ELSE ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(wl.room_number, ''), ',')) AS value WHERE btrim(value) <> '')
    END,
    service_name_snapshot = COALESCE(wl.service_name_snapshot, service.name, 'Unknown service'),
    service_description_snapshot = COALESCE(wl.service_description_snapshot, NULLIF(service.description, ''), service.name, 'Unknown service')
FROM public.services_config AS service
WHERE service.id = wl.service_id;

ALTER TABLE public.work_logs
ALTER COLUMN task_date
SET
    NOT NULL,
ALTER COLUMN service_name_snapshot
SET
    NOT NULL,
ALTER COLUMN service_description_snapshot
SET
    NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_work_log_task_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_service_name TEXT;
  selected_service_description TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.task_date := (NEW.start_time AT TIME ZONE 'Europe/London')::date;
    SELECT name, COALESCE(NULLIF(description, ''), name)
    INTO selected_service_name, selected_service_description
    FROM public.services_config
    WHERE id = NEW.service_id;
    NEW.service_name_snapshot := COALESCE(NEW.service_name_snapshot, selected_service_name, 'Unknown service');
    NEW.service_description_snapshot := COALESCE(NEW.service_description_snapshot, selected_service_description, 'Unknown service');
    NEW.room_numbers := COALESCE(NEW.room_numbers, '{}'::TEXT[]);
    IF cardinality(NEW.room_numbers) = 0 AND NULLIF(NEW.room_number, '') IS NOT NULL THEN
      NEW.room_numbers := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(NEW.room_number, ',')) AS value WHERE btrim(value) <> '');
    END IF;
  ELSE
    IF NEW.task_date IS DISTINCT FROM OLD.task_date THEN
      RAISE EXCEPTION 'Task date is immutable';
    END IF;
    IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
      SELECT name, COALESCE(NULLIF(description, ''), name)
      INTO selected_service_name, selected_service_description
      FROM public.services_config
      WHERE id = NEW.service_id;
      NEW.service_name_snapshot := COALESCE(selected_service_name, 'Unknown service');
      NEW.service_description_snapshot := COALESCE(selected_service_description, 'Unknown service');
    END IF;
    IF NEW.room_number IS DISTINCT FROM OLD.room_number AND NEW.room_numbers IS NOT DISTINCT FROM OLD.room_numbers THEN
      NEW.room_numbers := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(NEW.room_number, ''), ',')) AS value WHERE btrim(value) <> '');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_log_task_context ON public.work_logs;

CREATE TRIGGER work_log_task_context
BEFORE INSERT OR UPDATE ON public.work_logs
FOR EACH ROW
EXECUTE FUNCTION public.capture_work_log_task_context();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('room-media', 'room-media', FALSE, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']::TEXT[])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

NOTIFY pgrst, 'reload schema';