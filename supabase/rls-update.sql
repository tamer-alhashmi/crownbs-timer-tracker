-- Hotel Time Tracker: Supabase RLS update
-- Run this after supabase/schema-update.sql.
-- Safe to run more than once.

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_log_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'owner';
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'manager';
$$;

CREATE OR REPLACE FUNCTION public.is_cleaner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'role'), '') = 'cleaner';
$$;

-- Services
DROP POLICY IF EXISTS "Services visible to all authorized users" ON public.services_config;
CREATE POLICY "Services visible to all authorized users"
ON public.services_config
FOR SELECT
USING (auth.role() = 'authenticated' OR public.is_admin() OR public.is_owner() OR public.is_manager() OR public.is_cleaner());

DROP POLICY IF EXISTS "Admin owner manager can manage services" ON public.services_config;
CREATE POLICY "Admin owner manager can manage services"
ON public.services_config
FOR ALL
USING (public.is_admin() OR public.is_owner() OR public.is_manager())
WITH CHECK (public.is_admin() OR public.is_owner() OR public.is_manager());

-- Users
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile"
ON public.users
FOR SELECT
USING (auth.uid() = id OR public.is_admin() OR public.is_owner() OR public.is_manager());

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
USING (auth.uid() = id OR public.is_admin() OR public.is_owner() OR public.is_manager())
WITH CHECK (auth.uid() = id OR public.is_admin() OR public.is_owner() OR public.is_manager());

-- Hotels
DROP POLICY IF EXISTS "Hotels visible to authorized roles" ON public.hotels;
CREATE POLICY "Hotels visible to authorized roles"
ON public.hotels
FOR SELECT
USING (
  public.is_admin()
  OR auth.uid() = owner_id
  OR auth.uid() = manager_id
  OR (public.is_cleaner() AND is_active = TRUE)
);

DROP POLICY IF EXISTS "Admin owner manager can manage hotels" ON public.hotels;
CREATE POLICY "Admin owner manager can manage hotels"
ON public.hotels
FOR ALL
USING (public.is_admin() OR auth.uid() = owner_id OR auth.uid() = manager_id)
WITH CHECK (public.is_admin() OR auth.uid() = owner_id OR auth.uid() = manager_id);

-- Rooms
DROP POLICY IF EXISTS "Authorized users can read rooms" ON public.rooms;
CREATE POLICY "Authorized users can read rooms"
ON public.rooms
FOR SELECT
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels
    WHERE hotels.id = rooms.hotel_id
      AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid())
  )
  OR (
    public.is_cleaner()
    AND EXISTS (
      SELECT 1 FROM public.hotels
      WHERE hotels.id = rooms.hotel_id AND hotels.is_active = TRUE
    )
  )
);

DROP POLICY IF EXISTS "Management can manage rooms" ON public.rooms;
CREATE POLICY "Management can manage rooms"
ON public.rooms
FOR ALL
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels
    WHERE hotels.id = rooms.hotel_id
      AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid())
  )
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels
    WHERE hotels.id = rooms.hotel_id
      AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid())
  )
);

-- Master shifts
DROP POLICY IF EXISTS "Users can manage own master shifts" ON public.master_shifts;
CREATE POLICY "Users can manage own master shifts"
ON public.master_shifts
FOR ALL
USING (
  auth.uid() = user_id
  OR public.is_admin()
  OR public.is_owner()
  OR public.is_manager()
)
WITH CHECK (
  auth.uid() = user_id
  OR public.is_admin()
  OR public.is_owner()
  OR public.is_manager()
);

-- Work logs: cleaners own their logs; management is limited to assigned hotels.
DROP POLICY IF EXISTS "Cleaners manage own work logs" ON public.work_logs;
CREATE POLICY "Cleaners manage own work logs"
ON public.work_logs
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Management roles can manage all work logs" ON public.work_logs;
CREATE POLICY "Management roles can manage all work logs"
ON public.work_logs
FOR ALL
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels
    WHERE hotels.id = work_logs.hotel_id
      AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid())
  )
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels
    WHERE hotels.id = work_logs.hotel_id
      AND (hotels.owner_id = auth.uid() OR hotels.manager_id = auth.uid())
  )
);

-- Audit history
DROP POLICY IF EXISTS "Management can read work log audit history" ON public.work_log_audit;
CREATE POLICY "Management can read work log audit history"
ON public.work_log_audit
FOR SELECT
USING (public.is_admin() OR public.is_owner() OR public.is_manager() OR auth.uid() = actor_id);

DROP POLICY IF EXISTS "Management can append work log audit history" ON public.work_log_audit;
CREATE POLICY "Management can append work log audit history"
ON public.work_log_audit
FOR INSERT
WITH CHECK (public.is_admin() OR public.is_owner() OR public.is_manager() OR auth.uid() = actor_id);

DROP POLICY IF EXISTS "Room media participants can read evidence" ON public.room_media;
CREATE POLICY "Room media participants can read evidence"
ON public.room_media
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.work_logs AS log
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    WHERE log.id = room_media.work_log_id
      AND (log.user_id = auth.uid() OR hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "Cleaners can attach evidence to their active selected rooms" ON public.room_media;
CREATE POLICY "Cleaners can attach evidence to their active selected rooms"
ON public.room_media
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM public.work_logs AS log
    JOIN public.rooms AS room ON room.id = room_media.room_id
    WHERE log.id = room_media.work_log_id
      AND log.user_id = auth.uid()
      AND log.status = 'active'
      AND log.hotel_id = room.hotel_id
      AND room.status = 'active'
      AND room.id = ANY(log.room_ids)
  )
);

DROP POLICY IF EXISTS "Cleaners can delete their own active-task evidence" ON public.room_media;
CREATE POLICY "Cleaners can delete their own active-task evidence"
ON public.room_media
FOR DELETE TO authenticated
USING (
  uploaded_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.work_logs AS log WHERE log.id = room_media.work_log_id AND log.user_id = auth.uid() AND log.status = 'active')
);

DROP POLICY IF EXISTS "Room media storage objects can be uploaded to selected rooms" ON storage.objects;
CREATE POLICY "Room media storage objects can be uploaded to selected rooms"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM public.rooms AS room
    JOIN public.work_logs AS log ON log.id::TEXT = split_part(storage.objects.name, '/', 2)
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
    SELECT 1 FROM public.room_media AS media
    JOIN public.work_logs AS log ON log.id = media.work_log_id
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND (log.user_id = auth.uid() OR hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "Cleaners can delete their own room media storage objects" ON storage.objects;
CREATE POLICY "Cleaners can delete their own room media storage objects"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1 FROM public.room_media AS media
    JOIN public.work_logs AS log ON log.id = media.work_log_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND media.uploaded_by = auth.uid()
      AND log.user_id = auth.uid()
      AND log.status = 'active'
  )
);

NOTIFY pgrst, 'reload schema';
