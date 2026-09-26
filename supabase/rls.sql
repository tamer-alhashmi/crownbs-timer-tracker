-- Row Level Security for Hotel Time Tracker
-- Enable RLS on core tables.
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE services_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_log_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Helper functions for role checks.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'admin';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'owner';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_manager()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'manager';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_cleaner()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'cleaner';
$$ LANGUAGE SQL STABLE;

-- Public read access for service catalog configuration.
CREATE POLICY "Services visible to all authorized users"
ON services_config
FOR SELECT
USING (auth.role() = 'authenticated');

-- Users can read their own profile and admin/owner/manager can view all profiles.
CREATE POLICY "Users can read own profile"
ON users
FOR SELECT
USING (auth.uid() = id OR is_admin() OR is_owner() OR is_manager());

CREATE POLICY "Users can update own profile"
ON users
FOR UPDATE
USING (auth.uid() = id OR is_admin() OR is_owner() OR is_manager());

-- Hotels visible to admin/owner/manager and assigned cleaner.
DROP POLICY IF EXISTS "Hotels visible to authorized roles" ON hotels;
CREATE POLICY "Hotels visible to authorized roles"
ON hotels
FOR SELECT
USING (is_admin() OR auth.uid() = owner_id OR auth.uid() = manager_id OR (is_cleaner() AND is_active = TRUE));

-- Work logs: cleaners can only access their own logs; managers/admins/owners can access all.
DROP POLICY IF EXISTS "Cleaners manage own work logs" ON work_logs;
CREATE POLICY "Cleaners manage own work logs"
ON work_logs
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Management roles can manage all work logs" ON work_logs;
CREATE POLICY "Management roles can manage all work logs"
ON work_logs
FOR ALL
USING (
  is_admin()
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = work_logs.hotel_id AND hotels.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = work_logs.hotel_id AND hotels.manager_id = auth.uid())
)
WITH CHECK (
  is_admin()
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = work_logs.hotel_id AND hotels.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = work_logs.hotel_id AND hotels.manager_id = auth.uid())
);

CREATE POLICY "Management can read work log audit history"
ON work_log_audit
FOR SELECT
USING (is_admin() OR is_owner() OR is_manager() OR auth.uid() = actor_id);

CREATE POLICY "Management can append work log audit history"
ON work_log_audit
FOR INSERT
WITH CHECK (is_admin() OR is_owner() OR is_manager());

CREATE POLICY "Authorized users can read rooms"
ON rooms
FOR SELECT
USING (
  is_admin()
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = rooms.hotel_id AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid()))
  OR (is_cleaner() AND EXISTS (SELECT 1 FROM hotels WHERE hotels.id = rooms.hotel_id AND hotels.is_active = TRUE))
);

CREATE POLICY "Management can manage rooms"
ON rooms
FOR ALL
USING (
  is_admin()
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = rooms.hotel_id AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid()))
)
WITH CHECK (
  is_admin()
  OR EXISTS (SELECT 1 FROM hotels WHERE hotels.id = rooms.hotel_id AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid()))
);

CREATE POLICY "Users can manage own master shifts"
ON master_shifts
FOR ALL
USING (auth.uid() = user_id OR is_admin() OR is_owner() OR is_manager())
WITH CHECK (auth.uid() = user_id OR is_admin() OR is_owner() OR is_manager());

-- Managers/admins can manage hotels and services.
CREATE POLICY "Admin owner manager can manage hotels"
ON hotels
FOR ALL
USING (is_admin() OR auth.uid() = owner_id OR auth.uid() = manager_id)
WITH CHECK (is_admin() OR auth.uid() = owner_id OR auth.uid() = manager_id);

CREATE POLICY "Admin owner manager can manage services"
ON services_config
FOR ALL
USING (is_admin() OR is_owner() OR is_manager());

DROP POLICY IF EXISTS "Room media participants can read evidence" ON room_media;
CREATE POLICY "Room media participants can read evidence"
ON room_media
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM work_logs AS log
    JOIN hotels AS hotel ON hotel.id = log.hotel_id
    WHERE log.id = room_media.work_log_id
      AND (log.user_id = auth.uid() OR hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid() OR is_admin())
  )
);

DROP POLICY IF EXISTS "Cleaners can attach evidence to their active selected rooms" ON room_media;
CREATE POLICY "Cleaners can attach evidence to their active selected rooms"
ON room_media
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM work_logs AS log
    JOIN rooms AS room ON room.id = room_media.room_id
    WHERE log.id = room_media.work_log_id
      AND log.user_id = auth.uid()
      AND log.status = 'active'
      AND log.hotel_id = room.hotel_id
      AND room.status = 'active'
      AND room.id = ANY(log.room_ids)
  )
);

DROP POLICY IF EXISTS "Cleaners can delete their own active-task evidence" ON room_media;
CREATE POLICY "Cleaners can delete their own active-task evidence"
ON room_media
FOR DELETE TO authenticated
USING (
  uploaded_by = auth.uid()
  AND EXISTS (SELECT 1 FROM work_logs AS log WHERE log.id = room_media.work_log_id AND log.user_id = auth.uid() AND log.status = 'active')
);

DROP POLICY IF EXISTS "Room media storage objects can be uploaded to selected rooms" ON storage.objects;
CREATE POLICY "Room media storage objects can be uploaded to selected rooms"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM rooms AS room
    JOIN work_logs AS log ON log.id::TEXT = split_part(storage.objects.name, '/', 2)
    WHERE room.id::TEXT = split_part(storage.objects.name, '/', 1)
      AND room.hotel_id = log.hotel_id
      AND room.id = ANY(log.room_ids)
      AND room.status = 'active'
      AND log.user_id = auth.uid()
      AND log.status = 'active'
  )
);

DROP POLICY IF EXISTS "Room media storage objects can be read by evidence participants" ON storage.objects;
CREATE POLICY "Room media storage objects can be read by evidence participants"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM room_media AS media
    JOIN work_logs AS log ON log.id = media.work_log_id
    JOIN hotels AS hotel ON hotel.id = log.hotel_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND (log.user_id = auth.uid() OR hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid() OR is_admin())
  )
);

DROP POLICY IF EXISTS "Cleaners can delete their own room media storage objects" ON storage.objects;
CREATE POLICY "Cleaners can delete their own room media storage objects"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM room_media AS media
    JOIN work_logs AS log ON log.id = media.work_log_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND media.uploaded_by = auth.uid()
      AND log.user_id = auth.uid()
      AND log.status = 'active'
  )
);
