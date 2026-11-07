BEGIN;

ALTER TABLE public.services_config
  ADD COLUMN IF NOT EXISTS service_category TEXT,
  ADD COLUMN IF NOT EXISTS billing_model TEXT,
  ADD COLUMN IF NOT EXISTS billing_unit_label TEXT,
  ADD COLUMN IF NOT EXISTS benchmark_quantity NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS spatial_mode TEXT,
  ADD COLUMN IF NOT EXISTS requires_asset_reference BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checklist_blueprint JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.services_config'::regclass
      AND conname = 'services_config_billing_model_check'
  ) THEN
    ALTER TABLE public.services_config
      ADD CONSTRAINT services_config_billing_model_check
      CHECK (billing_model IS NULL OR billing_model IN ('duration', 'quantity', 'fixed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.services_config'::regclass
      AND conname = 'services_config_spatial_mode_check'
  ) THEN
    ALTER TABLE public.services_config
      ADD CONSTRAINT services_config_spatial_mode_check
      CHECK (spatial_mode IS NULL OR spatial_mode IN ('units', 'open_zone', 'general'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.services_config'::regclass
      AND conname = 'services_config_benchmark_quantity_check'
  ) THEN
    ALTER TABLE public.services_config
      ADD CONSTRAINT services_config_benchmark_quantity_check
      CHECK (benchmark_quantity IS NULL OR benchmark_quantity >= 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.property_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_levels_name_nonempty CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS property_levels_hotel_name_key
  ON public.property_levels (hotel_id, name);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES public.property_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS space_type TEXT;

INSERT INTO public.property_levels (hotel_id, name)
SELECT DISTINCT room.hotel_id, btrim(room.floor_section)
FROM public.rooms AS room
WHERE NULLIF(btrim(room.floor_section), '') IS NOT NULL
ON CONFLICT (hotel_id, name) DO NOTHING;

UPDATE public.rooms AS room
SET level_id = level.id
FROM public.property_levels AS level
WHERE room.level_id IS NULL
  AND NULLIF(btrim(room.floor_section), '') IS NOT NULL
  AND level.hotel_id = room.hotel_id
  AND level.name = btrim(room.floor_section);

UPDATE public.rooms
SET space_type = NULLIF(btrim(category), '')
WHERE space_type IS NULL AND NULLIF(btrim(category), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_room_property_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(btrim(NEW.floor_section), '') IS NULL THEN
    NEW.level_id := NULL;
    RETURN NEW;
  END IF;

  INSERT INTO public.property_levels (hotel_id, name)
  VALUES (NEW.hotel_id, btrim(NEW.floor_section))
  ON CONFLICT (hotel_id, name) DO UPDATE
    SET updated_at = NOW()
  RETURNING id INTO NEW.level_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_sync_property_level ON public.rooms;
CREATE TRIGGER rooms_sync_property_level
  BEFORE INSERT OR UPDATE OF hotel_id, floor_section
  ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_room_property_level();

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS service_blueprint_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS billable_quantity NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS execution_checklist JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE public.room_media
  ALTER COLUMN room_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_work_log_blueprint_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  checklist_items JSONB;
  checklist_item RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' THEN
    checklist_items := NEW.service_blueprint_snapshot #> '{checklist,items}';
    IF jsonb_typeof(checklist_items) = 'array' THEN
      FOR checklist_item IN
        SELECT item.value, item.ordinality
        FROM jsonb_array_elements(checklist_items) WITH ORDINALITY AS item(value, ordinality)
      LOOP
        IF NEW.execution_checklist -> (checklist_item.ordinality - 1) IS DISTINCT FROM 'true'::JSONB THEN
          RAISE EXCEPTION 'Complete every required inspection item before completing this task.'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;

    IF COALESCE((NEW.service_blueprint_snapshot #>> '{checklist,requirePhoto}')::BOOLEAN, FALSE)
      AND NOT EXISTS (
        SELECT 1
        FROM public.room_media AS media
        WHERE media.work_log_id = NEW.id
          AND media.media_type = 'image'
      ) THEN
      RAISE EXCEPTION 'Add required photo evidence before completing this task.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_logs_enforce_blueprint_requirements ON public.work_logs;
CREATE TRIGGER work_logs_enforce_blueprint_requirements
  BEFORE UPDATE OF status
  ON public.work_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_log_blueprint_requirements();

ALTER TABLE public.property_levels ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_levels TO service_role;

DROP POLICY IF EXISTS "Cleaners can attach evidence to their active selected rooms" ON public.room_media;
DROP POLICY IF EXISTS "Assigned users can attach evidence to active tasks" ON public.room_media;
CREATE POLICY "Assigned users can attach evidence to active tasks" ON public.room_media
FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid()
  AND bucket_id = 'room-media'
  AND (
    (
      room_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.work_logs AS log
        WHERE log.id = room_media.work_log_id
          AND log.user_id = auth.uid()
          AND log.status = 'active'
      )
    )
    OR EXISTS (
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
  )
);

DROP POLICY IF EXISTS "Room media storage objects can be uploaded to selected rooms" ON storage.objects;
DROP POLICY IF EXISTS "Assigned users can upload evidence for active tasks" ON storage.objects;
CREATE POLICY "Assigned users can upload evidence for active tasks" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'room-media'
  AND (
    EXISTS (
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
    OR (
      storage.objects.name ~* '^tasks/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|webm)$'
      AND EXISTS (
        SELECT 1
        FROM public.work_logs AS log
        WHERE log.id::TEXT = split_part(storage.objects.name, '/', 2)
          AND log.user_id = auth.uid()
          AND log.status = 'active'
      )
    )
  )
);

REVOKE ALL ON FUNCTION public.sync_room_property_level() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_work_log_blueprint_requirements() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
