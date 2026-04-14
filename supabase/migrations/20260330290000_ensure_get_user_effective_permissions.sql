-- If 20260330270000 was applied before get_user_effective_permissions was added to that file,
-- remote DBs can miss this function while get_my_custom_role_permission_ceiling still calls it
-- (Account Manager path). This migration always applies as a new version.

CREATE OR REPLACE FUNCTION public.get_user_effective_permissions(
    p_user_id uuid,
    p_agency_tenant_id uuid
)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT perm.action
    FROM tenant_memberships tm
    JOIN roles r ON r.id = tm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions perm ON perm.id = rp.permission_id
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_agency_tenant_id
      AND tm.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.get_user_effective_permissions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_effective_permissions(uuid, uuid) IS
    'Effective permission actions for a user from active memberships on an agency tenant (AM ceiling for custom roles).';
