-- Idempotency keys for historical imports.
ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS import_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_import_key
  ON public.work_logs(import_key)
  WHERE import_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';