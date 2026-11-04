BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_pin BOOLEAN
    GENERATED ALWAYS AS (pin_code IS NOT NULL AND pin_code <> '') STORED;

CREATE TABLE IF NOT EXISTS public.pin_login_attempts (
  identifier_hash TEXT PRIMARY KEY
    CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  locked_until TIMESTAMPTZ
);

ALTER TABLE public.pin_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pin_login_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_pin_login_attempt(p_identifier_hash TEXT)
RETURNS TABLE (allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_count INTEGER;
  v_window_started_at TIMESTAMPTZ;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_identifier_hash IS NULL OR p_identifier_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid login identifier hash is required.';
  END IF;

  DELETE FROM public.pin_login_attempts
  WHERE window_started_at < v_now - INTERVAL '24 hours'
    AND (locked_until IS NULL OR locked_until <= v_now);

  INSERT INTO public.pin_login_attempts (identifier_hash)
  VALUES (p_identifier_hash)
  ON CONFLICT (identifier_hash) DO NOTHING;

  SELECT attempt_count, window_started_at, locked_until
    INTO v_attempt_count, v_window_started_at, v_locked_until
    FROM public.pin_login_attempts
    WHERE identifier_hash = p_identifier_hash
    FOR UPDATE;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN QUERY SELECT FALSE, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_locked_until - v_now)))::INTEGER);
    RETURN;
  END IF;

  IF v_window_started_at <= v_now - INTERVAL '15 minutes' THEN
    UPDATE public.pin_login_attempts
      SET attempt_count = 0,
          window_started_at = v_now,
          locked_until = NULL
      WHERE identifier_hash = p_identifier_hash;
    v_attempt_count := 0;
  END IF;

  IF v_attempt_count >= 5 THEN
    v_locked_until := v_now + INTERVAL '15 minutes';
    UPDATE public.pin_login_attempts
      SET locked_until = v_locked_until
      WHERE identifier_hash = p_identifier_hash;
    RETURN QUERY SELECT FALSE, 900;
    RETURN;
  END IF;

  UPDATE public.pin_login_attempts
    SET attempt_count = attempt_count + 1
    WHERE identifier_hash = p_identifier_hash;

  RETURN QUERY SELECT TRUE, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_pin_login_after_failure(p_identifier_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked BOOLEAN := FALSE;
BEGIN
  IF p_identifier_hash IS NULL OR p_identifier_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid login identifier hash is required.';
  END IF;

  UPDATE public.pin_login_attempts
    SET locked_until = clock_timestamp() + INTERVAL '15 minutes'
    WHERE identifier_hash = p_identifier_hash
      AND attempt_count >= 5
      AND (locked_until IS NULL OR locked_until <= clock_timestamp())
    RETURNING TRUE INTO v_locked;
  RETURN COALESCE(v_locked, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_pin_login_attempts(p_identifier_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_identifier_hash IS NULL OR p_identifier_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid login identifier hash is required.';
  END IF;

  DELETE FROM public.pin_login_attempts
  WHERE identifier_hash = p_identifier_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_pin_login_attempt(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_pin_login_after_failure(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_pin_login_attempts(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_pin_login_attempt(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_pin_login_after_failure(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_pin_login_attempts(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
