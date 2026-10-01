-- Hotel Time Tracker | Production schema draft
-- Date and time are stored in UTC in Supabase and rendered in local time zones in the app.

CREATE TYPE user_role AS ENUM ('admin', 'owner', 'manager', 'cleaner');

CREATE TYPE work_status AS ENUM ('active', 'completed');

CREATE TABLE IF NOT EXISTS hotels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    owner_id UUID,
    manager_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hotels
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    email TEXT UNIQUE NOT NULL,
    pin_code TEXT,
    role user_role NOT NULL,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    avatar_url TEXT,
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 12.00 CHECK (hourly_rate >= 0),
    primary_hotel_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_primary_hotel FOREIGN KEY (primary_hotel_id) REFERENCES hotels (id) ON DELETE SET NULL
);

ALTER TABLE hotels
ADD CONSTRAINT fk_hotel_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL,
ADD CONSTRAINT fk_hotel_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS services_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'hourly' CHECK (unit IN ('hourly', 'per_room', 'fixed')),
    default_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    hotel_id UUID NOT NULL REFERENCES hotels (id) ON DELETE CASCADE,
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
    UNIQUE (hotel_id, room_name, category)
);

CREATE TABLE IF NOT EXISTS master_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    status work_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        end_time IS NULL
        OR end_time >= start_time
    )
);

CREATE TABLE IF NOT EXISTS work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services_config(id) ON DELETE RESTRICT,
  shift_id UUID REFERENCES master_shifts(id) ON DELETE SET NULL,
  room_ids UUID[] NOT NULL DEFAULT '{}',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  task_date DATE,
  rooms_completed INTEGER DEFAULT 0,
  room_number TEXT,
  room_numbers TEXT[] NOT NULL DEFAULT '{}',
  service_name_snapshot TEXT,
  service_description_snapshot TEXT,
  notes TEXT,
  travel_time_included BOOLEAN NOT NULL DEFAULT FALSE,
  status work_status NOT NULL DEFAULT 'active',
  manager_approved BOOLEAN NOT NULL DEFAULT FALSE,
  owner_approved BOOLEAN NOT NULL DEFAULT FALSE,
  manager_approved_at TIMESTAMPTZ,
  owner_approved_at TIMESTAMPTZ,
  manager_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  owner_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  manager_rejected_at TIMESTAMPTZ,
  owner_rejected_at TIMESTAMPTZ,
  rejection_notes TEXT,
  owner_id UUID,
  owner_name TEXT,
  manager_id UUID,
  manager_name TEXT,
  responsibility_recorded_at TIMESTAMPTZ,
  import_key TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (rooms_completed >= 0),
  CHECK (end_time IS NULL OR end_time >= start_time),
  CHECK (NOT is_locked OR (status = 'completed' AND manager_approved AND owner_approved)),
  CHECK (NOT manager_approved OR manager_approved_at IS NOT NULL),
  CHECK (NOT owner_approved OR owner_approved_at IS NOT NULL)
);

ALTER TABLE work_logs
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID,
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS responsibility_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS room_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_date DATE,
  ADD COLUMN IF NOT EXISTS room_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS service_description_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES master_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_rejected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manager_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE work_logs
SET
    is_locked = FALSE,
    manager_approved = FALSE,
    owner_approved = FALSE,
    manager_approved_at = NULL,
    owner_approved_at = NULL
WHERE
    status <> 'completed'
    AND is_locked = TRUE;

CREATE TABLE IF NOT EXISTS work_log_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    work_log_id UUID NOT NULL REFERENCES work_logs (id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS room_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    work_log_id UUID NOT NULL REFERENCES work_logs (id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
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
    uploaded_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT room_media_bucket_path_key UNIQUE (bucket_id, storage_path)
);

-- Recommended indexes for reporting and performance.
CREATE INDEX IF NOT EXISTS idx_hotels_owner_id ON hotels (owner_id);

CREATE INDEX IF NOT EXISTS idx_hotels_manager_id ON hotels (manager_id);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE INDEX IF NOT EXISTS idx_users_primary_hotel_id ON users (primary_hotel_id);

CREATE INDEX IF NOT EXISTS idx_work_logs_user_id ON work_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_work_logs_hotel_id ON work_logs (hotel_id);

CREATE INDEX IF NOT EXISTS idx_work_logs_service_id ON work_logs (service_id);

CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs (status);

CREATE INDEX IF NOT EXISTS idx_work_logs_locked ON work_logs (is_locked);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_import_key ON work_logs (import_key)
WHERE
    import_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_log_audit_log_id ON work_log_audit (work_log_id);

CREATE INDEX IF NOT EXISTS idx_rooms_hotel_id ON rooms (hotel_id);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);

CREATE INDEX IF NOT EXISTS idx_master_shifts_user_id ON master_shifts (user_id);

CREATE INDEX IF NOT EXISTS idx_master_shifts_status ON master_shifts (status);

CREATE INDEX IF NOT EXISTS idx_work_logs_shift_id ON work_logs (shift_id);

CREATE INDEX IF NOT EXISTS idx_users_email_pin_code ON users (email, pin_code);

CREATE INDEX IF NOT EXISTS idx_work_logs_user_status ON work_logs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_work_logs_shift_status ON work_logs (shift_id, status);

CREATE INDEX IF NOT EXISTS idx_work_logs_owner_snapshot ON work_logs (owner_id, start_time);

CREATE INDEX IF NOT EXISTS idx_work_logs_manager_snapshot ON work_logs (manager_id, start_time);

CREATE INDEX IF NOT EXISTS idx_work_logs_responsibility_recorded_at ON work_logs (responsibility_recorded_at);

CREATE INDEX IF NOT EXISTS idx_work_logs_task_date ON work_logs (task_date);

CREATE INDEX IF NOT EXISTS idx_work_logs_room_ids ON work_logs USING GIN (room_ids);

CREATE INDEX IF NOT EXISTS idx_room_media_work_log_room ON room_media (
    work_log_id,
    room_id,
    created_at DESC
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_master_shift_per_user ON master_shifts (user_id)
WHERE
    status = 'active';

CREATE TABLE IF NOT EXISTS user_feature_permissions (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL CHECK (
        feature_key IN (
            'dashboard',
            'work_log_approvals',
            'payroll',
            'rooms',
            'historical_import',
            'user_management',
            'settings'
        )
    ),
    can_view BOOLEAN NOT NULL DEFAULT FALSE,
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, feature_key)
);

ALTER TABLE user_feature_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_work_log_approval_lock()
RETURNS TRIGGER AS $$
BEGIN
  -- Management edits are permitted after payroll lock and remain fully audited.
  NEW.is_locked := NEW.manager_approved AND NEW.owner_approved;
  IF NEW.is_locked AND (NEW.status <> 'completed' OR NEW.end_time IS NULL) THEN
    RAISE EXCEPTION 'Only completed work logs can be locked for payroll';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_log_approval_lock ON work_logs;

CREATE TRIGGER work_log_approval_lock
BEFORE UPDATE ON work_logs
FOR EACH ROW EXECUTE FUNCTION enforce_work_log_approval_lock();

CREATE OR REPLACE FUNCTION capture_work_log_responsibility_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_owner_id UUID;
  assigned_owner_name TEXT;
  assigned_manager_id UUID;
  assigned_manager_name TEXT;
BEGIN
  SELECT h.owner_id, owner.full_name, h.manager_id, manager.full_name
  INTO assigned_owner_id, assigned_owner_name, assigned_manager_id, assigned_manager_name
  FROM hotels AS h
  LEFT JOIN users AS owner ON owner.id = h.owner_id
  LEFT JOIN users AS manager ON manager.id = h.manager_id
  WHERE h.id = NEW.hotel_id;

  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := assigned_owner_id;
    NEW.owner_name := COALESCE(assigned_owner_name, 'Unassigned owner at time of work');
    NEW.manager_id := assigned_manager_id;
    NEW.manager_name := COALESCE(assigned_manager_name, 'Unassigned manager at time of work');
    NEW.responsibility_recorded_at := COALESCE(NEW.responsibility_recorded_at, NOW());
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.owner_name IS DISTINCT FROM OLD.owner_name
    OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
    OR NEW.manager_name IS DISTINCT FROM OLD.manager_name
    OR NEW.responsibility_recorded_at IS DISTINCT FROM OLD.responsibility_recorded_at THEN
    RAISE EXCEPTION 'Responsibility snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_log_responsibility_snapshot ON work_logs;

CREATE TRIGGER work_log_responsibility_snapshot
BEFORE INSERT OR UPDATE ON work_logs
FOR EACH ROW EXECUTE FUNCTION capture_work_log_responsibility_snapshot();

INSERT INTO services_config (name, description, unit, default_rate, is_active)
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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('room-media', 'room-media', FALSE, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']::TEXT[])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE services_config
ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'hourly';

UPDATE services_config
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

UPDATE work_logs AS wl
SET task_date = COALESCE(wl.task_date, (wl.start_time AT TIME ZONE 'Europe/London')::date),
    room_numbers = CASE
      WHEN cardinality(wl.room_numbers) > 0 THEN wl.room_numbers
      ELSE ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(wl.room_number, ''), ',')) AS value WHERE btrim(value) <> '')
    END,
    service_name_snapshot = COALESCE(wl.service_name_snapshot, service.name, 'Unknown service'),
    service_description_snapshot = COALESCE(wl.service_description_snapshot, NULLIF(service.description, ''), service.name, 'Unknown service')
FROM services_config AS service
WHERE service.id = wl.service_id;

ALTER TABLE work_logs
ALTER COLUMN task_date
SET
    NOT NULL,
ALTER COLUMN service_name_snapshot
SET
    NOT NULL,
ALTER COLUMN service_description_snapshot
SET
    NOT NULL;

CREATE OR REPLACE FUNCTION capture_work_log_task_context()
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
    FROM services_config
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
      FROM services_config
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

DROP TRIGGER IF EXISTS work_log_task_context ON work_logs;

CREATE TRIGGER work_log_task_context
BEFORE INSERT OR UPDATE ON work_logs
FOR EACH ROW EXECUTE FUNCTION capture_work_log_task_context();