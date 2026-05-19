-- Invalidate bearer tokens immediately after logout (global signOut removes auth.sessions rows).
-- PostgREST only validates JWT signature/exp by default; this hook rejects revoked sessions.

CREATE OR REPLACE FUNCTION public.validate_active_auth_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    jwt_role text;
    v_session_id uuid;
    session_exists boolean;
BEGIN
    jwt_role := auth.jwt() ->> 'role';

    -- anon / service_role / other roles are not end-user browser sessions
    IF jwt_role IS DISTINCT FROM 'authenticated' THEN
        RETURN;
    END IF;

    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;

    IF v_session_id IS NULL THEN
        RAISE EXCEPTION 'Missing session_id in JWT'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM auth.sessions s WHERE s.id = v_session_id
    ) INTO session_exists;

    IF NOT session_exists THEN
        RAISE EXCEPTION 'Session is invalid or has been logged out'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.validate_active_auth_session() IS
    'PostgREST pre-request hook: reject authenticated JWTs whose session_id was removed (e.g. after signOut).';

-- Service-role API checks (Express) — not exposed to browsers
CREATE OR REPLACE FUNCTION public.auth_session_is_active(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
    SELECT p_session_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id);
$$;

REVOKE ALL ON FUNCTION public.auth_session_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_session_is_active(uuid) TO service_role;

COMMENT ON FUNCTION public.auth_session_is_active(uuid) IS
    'Whether auth.sessions still contains this session (false after global logout). Used by Express middleware.';

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.validate_active_auth_session';
NOTIFY pgrst, 'reload config';
