-- Dashboard email export: enforce SOW intent — Account Managers with seller assignment,
-- even if role_permissions row was missing. Remove export from Agency Admin / Seller Admin.

DELETE FROM public.role_permissions rp
USING public.permissions p, public.roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.action = 'dashboard.export_email'
  AND r.tenant_id IS NULL
  AND r.name IN ('Agency Admin', 'Seller Admin');

CREATE OR REPLACE FUNCTION public.user_has_permission_for_account(
    p_user_id uuid,
    p_account_id uuid,
    p_permission_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR (
            p_permission_action = 'dashboard.export_email'
            AND EXISTS (
                SELECT 1
                FROM public.accounts a
                JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller'
                JOIN public.user_seller_assignments usa ON usa.seller_tenant_id = s.id
                JOIN public.tenant_memberships tm
                    ON tm.id = usa.tenant_membership_id
                    AND tm.user_id = p_user_id
                    AND tm.status = 'active'
                JOIN public.roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
                WHERE a.id = p_account_id
            )
        )
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller'
            JOIN public.tenant_memberships tm ON tm.tenant_id = s.id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller' AND s.parent_tenant_id IS NOT NULL
            JOIN public.tenant_memberships tm ON tm.tenant_id = s.parent_tenant_id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller'
            JOIN public.user_seller_assignments usa ON usa.seller_tenant_id = s.id
            JOIN public.tenant_memberships tm ON tm.id = usa.tenant_membership_id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) IS
    'Permission on seller account: includes explicit Account Manager + seller assignment path for dashboard.export_email.';
