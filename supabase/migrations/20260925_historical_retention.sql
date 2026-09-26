-- Preserve work-log history when a user account is removed.
ALTER TABLE public.work_logs
  DROP CONSTRAINT IF EXISTS work_logs_user_id_fkey;

ALTER TABLE public.work_logs
  ADD CONSTRAINT work_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

NOTIFY pgrst, 'reload schema';
