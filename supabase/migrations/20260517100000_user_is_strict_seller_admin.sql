-- Financial visibility rules / restrictions: allow only true Seller Admin (system role), not
-- `users.manage` on the seller tenant (which can match agency-side delegates).

CREATE OR REPLACE FUNCTION public.user_is_strict_seller_admin(p_seller_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = p_seller_tenant_id
          AND t.type = 'seller'
    )
    AND (
        EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            JOIN public.roles r ON r.id = tm.role_id
            WHERE tm.tenant_id = p_seller_tenant_id
              AND tm.user_id = p_user_id
              AND tm.status = 'active'
              AND r.tenant_id IS NULL
              AND r.name = 'Seller Admin'
        )
        OR EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            JOIN public.membership_roles mr ON mr.membership_id = tm.id AND mr.revoked_at IS NULL
            JOIN public.roles r ON r.id = mr.role_id
            WHERE tm.tenant_id = p_seller_tenant_id
              AND tm.user_id = p_user_id
              AND tm.status = 'active'
              AND r.tenant_id IS NULL
              AND r.name = 'Seller Admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_is_strict_seller_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_strict_seller_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_strict_seller_admin(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.user_is_strict_seller_admin(uuid, uuid) IS
    'True when p_user_id holds the system Seller Admin role on seller tenant p_seller_tenant_id (primary or membership_roles), excluding users.manage-only delegation.';
