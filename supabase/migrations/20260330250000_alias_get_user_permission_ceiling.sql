-- PostgREST returns 404 when the RPC name does not exist. Some deployed clients call
-- get_user_permission_ceiling; the canonical implementation is get_my_custom_role_permission_ceiling.
CREATE OR REPLACE FUNCTION public.get_user_permission_ceiling(p_tenant_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.get_my_custom_role_permission_ceiling(p_tenant_id);
$$;

REVOKE ALL ON FUNCTION public.get_user_permission_ceiling(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_permission_ceiling(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_permission_ceiling IS
    'Alias for get_my_custom_role_permission_ceiling (same behavior; use either name from clients).';
