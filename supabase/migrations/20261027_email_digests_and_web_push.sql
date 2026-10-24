BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'pin',
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS monthly_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_auth_provider_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('google', 'pin', 'email'));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON public.users (lower(email));

UPDATE public.users AS app_user
SET email_verified = TRUE,
    email_verified_at = COALESCE(app_user.email_verified_at, auth_user.email_confirmed_at),
    auth_provider = 'google'
FROM auth.users AS auth_user
WHERE auth_user.id = app_user.id
  AND auth_user.email_confirmed_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM auth.identities AS identity
    WHERE identity.user_id = auth_user.id
      AND identity.provider = 'google'
  );

CREATE TABLE IF NOT EXISTS public.email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_codes_user_created_idx
  ON public.email_verification_codes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_push_subscriptions_user_idx
  ON public.user_push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.digest_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  cycle_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, cadence, cycle_key)
);

CREATE OR REPLACE FUNCTION public.complete_email_verification(
  p_user_id UUID,
  p_new_email TEXT,
  p_code_hash TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  verification_id UUID;
  updated_rows INTEGER;
BEGIN
  DELETE FROM public.email_verification_codes
  WHERE user_id = p_user_id AND expires_at <= NOW();

  SELECT id INTO verification_id
  FROM public.email_verification_codes
  WHERE user_id = p_user_id
    AND new_email = lower(trim(p_new_email))
    AND expires_at > NOW()
    AND attempts < 5
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF verification_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.email_verification_codes
    WHERE id = verification_id AND code = p_code_hash
  ) THEN
    UPDATE public.email_verification_codes
    SET attempts = LEAST(attempts + 1, 5)
    WHERE id = verification_id;
    RETURN 'invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE lower(email) = lower(trim(p_new_email)) AND id <> p_user_id
  ) THEN
    RETURN 'email_taken';
  END IF;

  UPDATE public.users
  SET email = lower(trim(p_new_email)),
      email_verified = TRUE,
      email_verified_at = NOW(),
      updated_at = NOW()
  WHERE id = p_user_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows = 0 THEN
    RETURN 'user_missing';
  END IF;

  UPDATE auth.users
  SET email = lower(trim(p_new_email)),
      email_confirmed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_user_id
    AND EXISTS (
      SELECT 1
      FROM auth.identities AS identity
      WHERE identity.user_id = auth.users.id
        AND identity.provider = 'email'
    );

  DELETE FROM public.email_verification_codes
  WHERE user_id = p_user_id;
  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_email_verification_code(
  p_user_id UUID,
  p_new_email TEXT,
  p_code_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  verification_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  DELETE FROM public.email_verification_codes WHERE expires_at <= NOW();

  IF EXISTS (
    SELECT 1
    FROM public.email_verification_codes
    WHERE user_id = p_user_id AND created_at > NOW() - INTERVAL '60 seconds'
  ) THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.email_verification_codes WHERE user_id = p_user_id;
  INSERT INTO public.email_verification_codes (user_id, new_email, code, expires_at)
  VALUES (p_user_id, lower(trim(p_new_email)), p_code_hash, NOW() + INTERVAL '10 minutes')
  RETURNING id INTO verification_id;

  RETURN verification_id;
END;
$$;

ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_dispatches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_verification_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.digest_dispatches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_verification_codes TO service_role;
GRANT ALL ON public.user_push_subscriptions TO service_role;
GRANT ALL ON public.digest_dispatches TO service_role;

REVOKE ALL ON FUNCTION public.complete_email_verification(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_email_verification(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.create_email_verification_code(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_email_verification_code(UUID, TEXT, TEXT) TO service_role;

COMMIT;
