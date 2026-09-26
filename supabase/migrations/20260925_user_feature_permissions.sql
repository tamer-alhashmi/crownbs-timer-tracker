-- Per-user feature permissions for the admin system control.
CREATE TABLE IF NOT EXISTS public.user_feature_permissions (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key),
  CONSTRAINT user_feature_permissions_feature_key_check CHECK (
    feature_key IN (
      'dashboard',
      'work_log_approvals',
      'payroll',
      'rooms',
      'historical_import',
      'user_management',
      'settings'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_user_feature_permissions_user_id
  ON public.user_feature_permissions(user_id);

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage feature permissions" ON public.user_feature_permissions;
CREATE POLICY "Admins manage feature permissions"
ON public.user_feature_permissions
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());
