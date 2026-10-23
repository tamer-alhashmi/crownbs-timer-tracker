BEGIN;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'housekeeping_admin';

COMMIT;

BEGIN;

DO $$
DECLARE
  matching_accounts INTEGER;
BEGIN
  SELECT COUNT(*) INTO matching_accounts
  FROM public.users
  WHERE lower(email) = 'tam.elhashmy@gmail.com';

  IF matching_accounts <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one primary administrator profile for super_admin promotion; found %.', matching_accounts;
  END IF;
END;
$$;

UPDATE public.users
SET role = 'super_admin'
WHERE lower(email) = 'tam.elhashmy@gmail.com';

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') = 'super_admin'
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') IN ('admin', 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_hk_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_user_role(), '') IN ('hk_admin', 'housekeeping_admin')
$$;

DROP POLICY IF EXISTS "Only super admins can delete properties" ON public.hotels;
CREATE POLICY "Only super admins can delete properties"
ON public.hotels AS RESTRICTIVE FOR DELETE TO public
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Only super admins can delete user accounts" ON public.users;
CREATE POLICY "Only super admins can delete user accounts"
ON public.users AS RESTRICTIVE FOR DELETE TO public
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Work history cannot be hard deleted" ON public.work_logs;
CREATE POLICY "Work history cannot be hard deleted"
ON public.work_logs AS RESTRICTIVE FOR DELETE TO public
USING (false);

CREATE OR REPLACE FUNCTION public.preserve_property_financial_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.work_logs WHERE hotel_id = OLD.id) THEN
    RAISE EXCEPTION 'Properties with work history cannot be hard deleted; archive the property instead.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS hotels_preserve_financial_history ON public.hotels;
CREATE TRIGGER hotels_preserve_financial_history
BEFORE DELETE ON public.hotels
FOR EACH ROW EXECUTE FUNCTION public.preserve_property_financial_history();

CREATE TABLE IF NOT EXISTS public.tenant_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  cycle_start TIMESTAMPTZ NOT NULL,
  cycle_end TIMESTAMPTZ NOT NULL,
  settled_task_count INTEGER NOT NULL CHECK (settled_task_count >= 0),
  settled_amount NUMERIC(12, 2) NOT NULL CHECK (settled_amount >= 0),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT tenant_settlements_owner_cycle_key UNIQUE (owner_id, cycle_start),
  CONSTRAINT tenant_settlements_valid_cycle CHECK (cycle_end > cycle_start)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settlements_cycle
  ON public.tenant_settlements(cycle_start, owner_id);

ALTER TABLE public.tenant_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant settlements server only" ON public.tenant_settlements;
CREATE POLICY "Tenant settlements server only"
  ON public.tenant_settlements
  AS RESTRICTIVE FOR ALL TO public
  USING (false)
  WITH CHECK (false);

GRANT ALL PRIVILEGES ON TABLE public.tenant_settlements TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_clock_in_at_inactive_property()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.end_time IS NULL
     AND NEW.deleted_at IS NULL AND NEW.cancelled_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.hotels
       WHERE id = NEW.hotel_id AND is_active = TRUE
     ) THEN
    RAISE EXCEPTION 'This property is inactive and does not allow clock-in.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_logs_active_property_guard ON public.work_logs;
CREATE TRIGGER work_logs_active_property_guard
BEFORE INSERT OR UPDATE OF status, end_time, hotel_id, deleted_at, cancelled_at
ON public.work_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_clock_in_at_inactive_property();

COMMIT;
