-- Server-side access check (service role): same logic as RLS account_is_visible_to_user.

CREATE OR REPLACE FUNCTION public.check_user_account_access(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT account_is_visible_to_user(p_account_id, p_user_id);
$$;

REVOKE ALL ON FUNCTION public.check_user_account_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_account_access(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.check_user_account_access IS
    'Returns true if p_user_id may access p_account_id (mirrors RLS). For Node API with service role.';
