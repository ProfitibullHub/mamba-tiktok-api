-- Effective permission actions for RBAC checks on account-scoped API routes.
-- Unions seller tenant, parent agency, and user_seller_assignments agency — mirrors the permission
-- sources in user_has_permission_for_account (20260514120000) so agency staff with custom roles
-- on seller-linked paths are not evaluated only against profiles.tenant_id (agency).

CREATE OR REPLACE FUNCTION public.get_user_effective_permissions_for_account(
    p_user_id uuid,
    p_account_id uuid
)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT u.action
    FROM public.accounts a
    CROSS JOIN LATERAL (
        SELECT ep.action
        FROM public.get_user_effective_permissions_on_tenant(p_user_id, a.tenant_id) ep
        UNION
        SELECT ep.action
        FROM public.tenants seller
        CROSS JOIN LATERAL public.get_user_effective_permissions_on_tenant(p_user_id, seller.parent_tenant_id) ep
        WHERE seller.id = a.tenant_id
          AND seller.type = 'seller'
          AND seller.parent_tenant_id IS NOT NULL
        UNION
        SELECT ep.action
        FROM public.user_seller_assignments usa
        CROSS JOIN LATERAL public.get_user_effective_permissions_on_tenant(p_user_id, usa.agency_tenant_id) ep
        WHERE usa.user_id = p_user_id
          AND usa.seller_tenant_id = a.tenant_id
    ) u
    WHERE a.id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public.get_user_effective_permissions_for_account(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions_for_account(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.get_user_effective_permissions_for_account(uuid, uuid) IS
    'Union of effective permission actions for a user in the context of an account (seller tenant, parent agency, assignment agency).';
