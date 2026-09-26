BEGIN;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS room_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS room_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.work_logs AS log
SET room_ids = ARRAY(
  SELECT room.id
  FROM public.rooms AS room
  WHERE room.hotel_id = log.hotel_id
    AND room.room_name = ANY(
      COALESCE(log.room_numbers, '{}'::TEXT[])
      || ARRAY(SELECT btrim(value) FROM unnest(string_to_array(COALESCE(log.room_number, ''), ',')) AS value WHERE btrim(value) <> '')
    )
)
WHERE cardinality(COALESCE(log.room_ids, '{}'::UUID[])) = 0;

CREATE TABLE IF NOT EXISTS public.room_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_log_id UUID NOT NULL REFERENCES public.work_logs(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL DEFAULT 'room-media',
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  content_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800),
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT room_media_bucket_path_key UNIQUE (bucket_id, storage_path)
);

ALTER TABLE public.room_media
  ADD COLUMN IF NOT EXISTS work_log_id UUID,
  ADD COLUMN IF NOT EXISTS room_id UUID,
  ADD COLUMN IF NOT EXISTS bucket_id TEXT NOT NULL DEFAULT 'room-media',
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS original_name TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_media'::regclass AND conname = 'room_media_work_log_id_fkey') THEN
    ALTER TABLE public.room_media ADD CONSTRAINT room_media_work_log_id_fkey FOREIGN KEY (work_log_id) REFERENCES public.work_logs(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_media'::regclass AND conname = 'room_media_room_id_fkey') THEN
    ALTER TABLE public.room_media ADD CONSTRAINT room_media_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_media'::regclass AND conname = 'room_media_uploaded_by_fkey') THEN
    ALTER TABLE public.room_media ADD CONSTRAINT room_media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_media_bucket_path ON public.room_media(bucket_id, storage_path);
CREATE INDEX IF NOT EXISTS idx_work_logs_room_ids ON public.work_logs USING GIN(room_ids);
CREATE INDEX IF NOT EXISTS idx_room_media_work_log_room ON public.room_media(work_log_id, room_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'room-media',
  'room-media',
  FALSE,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.room_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON TABLE public.room_media TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.room_media TO service_role;

DROP POLICY IF EXISTS "Room media participants can read evidence" ON public.room_media;
CREATE POLICY "Room media participants can read evidence" ON public.room_media
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.work_logs AS log
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    WHERE log.id = room_media.work_log_id
      AND (
        log.user_id = auth.uid()
        OR hotel.owner_id = auth.uid()
        OR hotel.manager_id = auth.uid()
        OR COALESCE((auth.jwt() ->> 'role'), '') = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Cleaners can attach evidence to their active selected rooms" ON public.room_media;
CREATE POLICY "Cleaners can attach evidence to their active selected rooms" ON public.room_media
FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid()
  AND bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1
    FROM public.work_logs AS log
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
CREATE POLICY "Cleaners can delete their own active-task evidence" ON public.room_media
FOR DELETE TO authenticated USING (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.work_logs AS log
    WHERE log.id = room_media.work_log_id
      AND log.user_id = auth.uid()
      AND log.status = 'active'
  )
);

DROP POLICY IF EXISTS "Room media storage objects can be uploaded to selected rooms" ON storage.objects;
CREATE POLICY "Room media storage objects can be uploaded to selected rooms" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1
    FROM public.rooms AS room
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
CREATE POLICY "Room media storage objects can be read by evidence participants" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1
    FROM public.room_media AS media
    JOIN public.work_logs AS log ON log.id = media.work_log_id
    JOIN public.hotels AS hotel ON hotel.id = log.hotel_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND (log.user_id = auth.uid() OR hotel.owner_id = auth.uid() OR hotel.manager_id = auth.uid() OR COALESCE((auth.jwt() ->> 'role'), '') = 'admin')
  )
);

DROP POLICY IF EXISTS "Cleaners can delete their own room media storage objects" ON storage.objects;
CREATE POLICY "Cleaners can delete their own room media storage objects" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'room-media'
  AND EXISTS (
    SELECT 1
    FROM public.room_media AS media
    JOIN public.work_logs AS log ON log.id = media.work_log_id
    WHERE media.bucket_id = storage.objects.bucket_id
      AND media.storage_path = storage.objects.name
      AND media.uploaded_by = auth.uid()
      AND log.user_id = auth.uid()
      AND log.status = 'active'
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
