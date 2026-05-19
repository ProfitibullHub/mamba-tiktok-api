-- Caller-scoped wrapper: lets the SPA merge seller-tenant + account-context permissions client-side.

CREATE OR REPLACE FUNCTION public.get_my_effective_permissions_for_account(p_account_id uuid)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM public.get_user_effective_permissions_for_account(auth.uid(), p_account_id);
$$;

REVOKE ALL ON FUNCTION public.get_my_effective_permissions_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions_for_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions_for_account(uuid) TO service_role;

COMMENT ON FUNCTION public.get_my_effective_permissions_for_account(uuid) IS
    'Effective permission actions for the caller in the context of an account (same union as get_user_effective_permissions_for_account).';
