-- Master shift/task workflow migration.
-- Run this in the connected Supabase SQL Editor before using the cleaner dashboard.

CREATE TABLE IF NOT EXISTS public.master_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  status work_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time IS NULL OR end_time >= start_time)
);

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.master_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_master_shifts_user_id ON public.master_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_master_shifts_status ON public.master_shifts(status);
CREATE INDEX IF NOT EXISTS idx_work_logs_shift_id ON public.work_logs(shift_id);

ALTER TABLE public.master_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own master shifts" ON public.master_shifts;
CREATE POLICY "Users can manage own master shifts"
ON public.master_shifts
FOR ALL
USING (
  auth.uid() = user_id
  OR COALESCE((auth.jwt() ->> 'role'), '') IN ('admin', 'owner', 'manager')
)
WITH CHECK (
  auth.uid() = user_id
  OR COALESCE((auth.jwt() ->> 'role'), '') IN ('admin', 'owner', 'manager')
);

NOTIFY pgrst, 'reload schema';
