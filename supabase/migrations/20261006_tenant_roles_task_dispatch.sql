BEGIN;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hk_admin' AFTER 'manager';
ALTER TYPE public.work_status ADD VALUE IF NOT EXISTS 'assigned' BEFORE 'active';

COMMIT;
BEGIN;

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS room_count INTEGER NOT NULL DEFAULT 0 CHECK (room_count >= 0);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language_preference TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.services_config
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.services_config
  DROP CONSTRAINT IF EXISTS services_config_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS services_config_owner_name_key
  ON public.services_config(owner_id, name)
  WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS services_config_global_name_key
  ON public.services_config(name)
  WHERE owner_id IS NULL;

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.user_hotel_assignments (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, hotel_id)
);

INSERT INTO public.user_hotel_assignments(user_id, hotel_id, assigned_by)
SELECT id, primary_hotel_id, id
FROM public.users
WHERE role = 'hk_admin' AND primary_hotel_id IS NOT NULL
ON CONFLICT (user_id, hotel_id) DO NOTHING;

ALTER TABLE public.user_hotel_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_user_assigned_to_hotel(p_user_id UUID, p_hotel_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_hotel_assignments
    WHERE user_id = p_user_id AND hotel_id = p_hotel_id
  )
$$;

REVOKE ALL ON FUNCTION public.is_user_assigned_to_hotel(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_assigned_to_hotel(UUID, UUID) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_work_logs_assigned_to_status
  ON public.work_logs(assigned_to, status, assigned_at DESC)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_logs_assigned_by_status
  ON public.work_logs(assigned_by, status, assigned_at DESC)
  WHERE assigned_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_single_active_work_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.end_time IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::TEXT, 0));
    IF EXISTS (
      SELECT 1 FROM public.work_logs existing
      WHERE existing.user_id = NEW.user_id
        AND existing.status = 'active'
        AND existing.end_time IS NULL
        AND existing.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'You already have an active running task. Please complete or pause your current task before starting a new one.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_logs_single_active_task ON public.work_logs;
CREATE TRIGGER work_logs_single_active_task
BEFORE INSERT OR UPDATE OF status, user_id, end_time ON public.work_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_work_log();

CREATE OR REPLACE FUNCTION public.current_app_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::TEXT FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.app_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::TEXT FROM public.users WHERE id = p_user_id
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_primary_hotel_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT primary_hotel_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'owner'
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'manager'
$$;

CREATE OR REPLACE FUNCTION public.is_hk_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'hk_admin'
$$;

CREATE OR REPLACE FUNCTION public.is_cleaner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'cleaner'
$$;

DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Tenant users can read operational circle" ON public.users;
CREATE POLICY "Tenant users can read operational circle"
ON public.users FOR SELECT
USING (
  auth.uid() = id OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
      AND (
        users.primary_hotel_id = h.id
        OR users.id = h.owner_id
        OR users.id = h.manager_id
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE public.is_user_assigned_to_hotel(users.id, h.id)
      AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
  )
  OR (
    public.is_hk_admin()
    AND users.primary_hotel_id = public.current_app_user_primary_hotel_id()
    AND users.role IN ('owner', 'manager', 'cleaner')
  )
  OR (
    public.is_hk_admin()
    AND public.is_user_assigned_to_hotel(auth.uid(), users.primary_hotel_id)
    AND users.role IN ('owner', 'manager', 'cleaner')
  )
  OR (
    public.is_hk_admin()
    AND users.id IN (
      SELECT h.owner_id FROM public.hotels h
      WHERE h.id = public.current_app_user_primary_hotel_id()
      UNION
      SELECT h.manager_id FROM public.hotels h
      WHERE h.id = public.current_app_user_primary_hotel_id()
    )
  )
  OR (
    public.is_hk_admin()
    AND users.id IN (
      SELECT h.owner_id FROM public.hotels h
      WHERE public.is_user_assigned_to_hotel(auth.uid(), h.id)
      UNION
      SELECT h.manager_id FROM public.hotels h
      WHERE public.is_user_assigned_to_hotel(auth.uid(), h.id)
    )
  )
  OR (
    public.is_cleaner()
    AND users.primary_hotel_id = public.current_app_user_primary_hotel_id()
    AND users.role = 'hk_admin'
  )
  OR (
    public.is_cleaner()
    AND users.id IN (
      SELECT h.manager_id FROM public.hotels h
      WHERE h.id = public.current_app_user_primary_hotel_id()
    )
  )
);

DROP POLICY IF EXISTS "Users can update own profile or admin" ON public.users;
CREATE POLICY "Tenant owners and managers can manage scoped staff"
ON public.users FOR UPDATE
USING (
  auth.uid() = id
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (
      h.id = users.primary_hotel_id
      OR public.is_user_assigned_to_hotel(users.id, h.id)
    )
      AND (
        (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid() AND users.role IN ('manager', 'hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
        OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid() AND users.role IN ('hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
      )
  )
)
WITH CHECK (
  public.is_admin()
  OR (
    auth.uid() = id
    AND role::TEXT = public.current_app_user_role()
    AND primary_hotel_id IS NOT DISTINCT FROM public.current_app_user_primary_hotel_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (
      h.id = users.primary_hotel_id
      OR public.is_user_assigned_to_hotel(users.id, h.id)
    )
      AND (
        (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid() AND users.role IN ('manager', 'hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
        OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid() AND users.role IN ('hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
      )
  )
);

DROP POLICY IF EXISTS "Tenant owners and managers can create scoped staff" ON public.users;
CREATE POLICY "Tenant owners and managers can create scoped staff"
ON public.users FOR INSERT
WITH CHECK (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (
      h.id = users.primary_hotel_id
      OR public.is_user_assigned_to_hotel(users.id, h.id)
    )
      AND (
        (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid() AND users.role IN ('manager', 'hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
        OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid() AND users.role IN ('hk_admin', 'cleaner')
          AND (users.primary_hotel_id = h.id OR public.is_user_assigned_to_hotel(users.id, h.id)))
      )
  )
);

DROP POLICY IF EXISTS "Tenant owners and managers can remove scoped staff" ON public.users;
CREATE POLICY "Tenant owners and managers can remove scoped staff"
ON public.users FOR DELETE
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (
      h.id = users.primary_hotel_id
      OR public.is_user_assigned_to_hotel(users.id, h.id)
    )
      AND (
        (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid() AND users.role IN ('manager', 'hk_admin', 'cleaner'))
        OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid() AND users.role IN ('hk_admin', 'cleaner'))
      )
  )
);

DROP POLICY IF EXISTS "Hotels visible to authorized roles" ON public.hotels;
DROP POLICY IF EXISTS "Admin owner manager can manage hotels" ON public.hotels;
DROP POLICY IF EXISTS "Tenant users can read assigned hotels" ON public.hotels;
CREATE POLICY "Tenant users can read assigned hotels"
ON public.hotels FOR SELECT
USING (
  public.is_admin()
  OR owner_id = auth.uid()
  OR manager_id = auth.uid()
  OR (
    public.current_app_user_role() = 'cleaner'
    AND public.current_app_user_primary_hotel_id() = hotels.id
  )
  OR (
    public.is_hk_admin()
    AND (
      public.current_app_user_primary_hotel_id() = hotels.id
      OR public.is_user_assigned_to_hotel(auth.uid(), hotels.id)
    )
  )
);

DROP POLICY IF EXISTS "Owners and admins manage hotels" ON public.hotels;
DROP POLICY IF EXISTS "Owners and admins create hotels" ON public.hotels;
CREATE POLICY "Owners and admins create hotels"
ON public.hotels FOR INSERT
WITH CHECK (public.is_admin() OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners and admins update hotels" ON public.hotels;
CREATE POLICY "Owners and admins update hotels"
ON public.hotels FOR UPDATE
USING (public.is_admin() OR owner_id = auth.uid())
WITH CHECK (public.is_admin() OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Services visible to all authorized users" ON public.services_config;
DROP POLICY IF EXISTS "Admin owner manager can manage services" ON public.services_config;
DROP POLICY IF EXISTS "Users can read tenant service catalog" ON public.services_config;
CREATE POLICY "Users can read tenant service catalog"
ON public.services_config FOR SELECT
USING (
  owner_id IS NULL
  OR public.is_admin()
  OR owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE (
      h.id = public.current_app_user_primary_hotel_id()
      OR public.is_user_assigned_to_hotel(auth.uid(), h.id)
    )
      AND h.owner_id = services_config.owner_id
  )
);

DROP POLICY IF EXISTS "Owners and admins manage tenant services" ON public.services_config;
DROP POLICY IF EXISTS "Owners and admins create tenant services" ON public.services_config;
CREATE POLICY "Owners and admins create tenant services"
ON public.services_config FOR INSERT
WITH CHECK (public.is_admin() OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners and admins update tenant services" ON public.services_config;
CREATE POLICY "Owners and admins update tenant services"
ON public.services_config FOR UPDATE
USING (public.is_admin() OR owner_id = auth.uid())
WITH CHECK (public.is_admin() OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can read scoped hotel assignments" ON public.user_hotel_assignments;
CREATE POLICY "Users can read scoped hotel assignments"
ON public.user_hotel_assignments FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = user_hotel_assignments.hotel_id
      AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Owners and managers assign housekeeping admins" ON public.user_hotel_assignments;
CREATE POLICY "Owners and managers assign housekeeping admins"
ON public.user_hotel_assignments FOR INSERT
WITH CHECK (
  public.is_admin()
  OR (
    public.app_user_role(user_id) = 'hk_admin'
    AND EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = user_hotel_assignments.hotel_id
        AND (
          (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid())
          OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid())
        )
    )
  )
);

DROP POLICY IF EXISTS "Owners and managers unassign housekeeping admins" ON public.user_hotel_assignments;
CREATE POLICY "Owners and managers unassign housekeeping admins"
ON public.user_hotel_assignments FOR DELETE
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = user_hotel_assignments.hotel_id
      AND (
        (public.current_app_user_role() = 'owner' AND h.owner_id = auth.uid())
        OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "Cleaners manage own work logs" ON public.work_logs;
DROP POLICY IF EXISTS "Management roles can manage all work logs" ON public.work_logs;
DROP POLICY IF EXISTS "Assignees and authorized managers read work assignments" ON public.work_logs;
CREATE POLICY "Assignees and authorized managers read work assignments"
ON public.work_logs FOR SELECT
USING (
  user_id = auth.uid()
  OR assigned_to = auth.uid()
  OR assigned_by = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = work_logs.hotel_id
      AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
  )
  OR (
    public.is_hk_admin()
    AND (
      public.current_app_user_primary_hotel_id() = work_logs.hotel_id
      OR public.is_user_assigned_to_hotel(auth.uid(), work_logs.hotel_id)
    )
  )
);

DROP POLICY IF EXISTS "Authorized roles dispatch tasks" ON public.work_logs;
CREATE POLICY "Authorized roles dispatch tasks"
ON public.work_logs FOR INSERT
WITH CHECK (
  (user_id = auth.uid() AND status <> 'assigned')
  OR public.is_admin()
  OR (
    assigned_by = auth.uid()
    AND assigned_to IS NOT NULL
    AND assigned_at IS NOT NULL
    AND status = 'assigned'
    AND EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = work_logs.hotel_id
        AND (
          (public.current_app_user_role() IN ('admin', 'owner')
            AND (public.is_admin() OR h.owner_id = auth.uid()))
          OR (public.current_app_user_role() = 'manager' AND h.manager_id = auth.uid())
          OR (public.is_hk_admin() AND (
            public.current_app_user_primary_hotel_id() = h.id
            OR public.is_user_assigned_to_hotel(auth.uid(), h.id)
          ))
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.users target
      WHERE target.id = work_logs.assigned_to
        AND (
          (public.current_app_user_role() IN ('admin', 'owner') AND target.role IN ('manager', 'hk_admin', 'cleaner'))
          OR (public.current_app_user_role() = 'manager' AND target.role IN ('hk_admin', 'cleaner'))
          OR (public.is_hk_admin() AND target.role = 'cleaner')
        )
        AND (
          target.primary_hotel_id = work_logs.hotel_id
          OR public.is_user_assigned_to_hotel(target.id, work_logs.hotel_id)
          OR target.id = (
          SELECT h.manager_id FROM public.hotels h WHERE h.id = work_logs.hotel_id
        ))
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = work_logs.hotel_id
      AND status <> 'assigned'
      AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Assignees can transition assigned tasks" ON public.work_logs;
CREATE POLICY "Assignees can transition assigned tasks"
ON public.work_logs FOR UPDATE
USING (
  user_id = auth.uid()
  OR assigned_to = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = work_logs.hotel_id
      AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
  )
)
WITH CHECK (
  (
    user_id = auth.uid()
    OR assigned_to = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = work_logs.hotel_id
        AND (h.owner_id = auth.uid() OR h.manager_id = auth.uid())
    )
  )
  AND (
    status <> 'assigned'
    OR (
      assigned_by = auth.uid()
      AND assigned_to = user_id
      AND assigned_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.hotels h
        JOIN public.users target ON target.id = work_logs.assigned_to
        WHERE h.id = work_logs.hotel_id
          AND (
            (public.current_app_user_role() IN ('admin', 'owner')
              AND (public.is_admin() OR h.owner_id = auth.uid())
              AND target.role IN ('manager', 'hk_admin', 'cleaner'))
            OR (public.current_app_user_role() = 'manager'
              AND h.manager_id = auth.uid()
              AND target.role IN ('hk_admin', 'cleaner'))
            OR (public.is_hk_admin()
              AND (
                public.current_app_user_primary_hotel_id() = h.id
                OR public.is_user_assigned_to_hotel(auth.uid(), h.id)
              )
              AND target.role = 'cleaner')
          )
          AND (
            target.primary_hotel_id = h.id
            OR public.is_user_assigned_to_hotel(target.id, h.id)
            OR target.id = h.manager_id
          )
      )
    )
  )
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'work_logs'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_logs;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
