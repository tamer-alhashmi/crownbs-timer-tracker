BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.guard_user_deactivation_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND current_user NOT IN ('postgres', 'supabase_admin')
    AND (
      NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
    )
  THEN
    RAISE EXCEPTION 'Only trusted server operations can change account activation status.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_deactivation_fields ON public.users;
CREATE TRIGGER guard_user_deactivation_fields
BEFORE UPDATE OF is_active, deactivated_at ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.guard_user_deactivation_fields();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'users'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
