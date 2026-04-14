-- Client-side guard for shop routes: same rule as RLS / check_user_account_access (auth.uid()).

CREATE OR REPLACE FUNCTION public.user_can_access_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL
    AND public.account_is_visible_to_user(p_account_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.user_can_access_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_account(uuid) TO authenticated;

COMMENT ON FUNCTION public.user_can_access_account(uuid) IS
    'Whether the current session may access this account (tenant visibility). Used by the shop URL gate before rendering shop UI.';
