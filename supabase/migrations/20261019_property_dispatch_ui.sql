BEGIN;

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS floor_count INTEGER NOT NULL DEFAULT 0 CHECK (floor_count >= 0);

ALTER TABLE public.services_config
  ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES public.hotels(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS services_config_hotel_name_key
  ON public.services_config(hotel_id, name)
  WHERE hotel_id IS NOT NULL;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'low'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

DROP POLICY IF EXISTS "Users can read tenant service catalog" ON public.services_config;
CREATE POLICY "Users can read tenant service catalog"
ON public.services_config FOR SELECT
USING (
  owner_id IS NULL
  OR public.is_admin()
  OR owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.owner_id = services_config.owner_id
      AND (
        h.id = public.current_app_user_primary_hotel_id()
        OR public.is_user_assigned_to_hotel(auth.uid(), h.id)
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = services_config.hotel_id
      AND (
        h.owner_id = auth.uid()
        OR h.manager_id = auth.uid()
        OR h.id = public.current_app_user_primary_hotel_id()
        OR public.is_user_assigned_to_hotel(auth.uid(), h.id)
      )
  )
);

DROP POLICY IF EXISTS "Owners and admins create tenant services" ON public.services_config;
CREATE POLICY "Owners and admins create tenant services"
ON public.services_config FOR INSERT
WITH CHECK (
  public.is_admin()
  OR (
    owner_id = auth.uid()
    AND (hotel_id IS NULL OR EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = services_config.hotel_id AND h.owner_id = auth.uid()
    ))
  )
);

DROP POLICY IF EXISTS "Owners and admins update tenant services" ON public.services_config;
CREATE POLICY "Owners and admins update tenant services"
ON public.services_config FOR UPDATE
USING (public.is_admin() OR owner_id = auth.uid())
WITH CHECK (
  public.is_admin()
  OR (
    owner_id = auth.uid()
    AND (hotel_id IS NULL OR EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = services_config.hotel_id AND h.owner_id = auth.uid()
    ))
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
