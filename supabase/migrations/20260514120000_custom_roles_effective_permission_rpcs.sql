-- Align account + admin helper RPCs with get_user_effective_permissions_on_tenant
-- (membership_roles + primary role fallback) so custom role grants apply consistently.

CREATE OR REPLACE FUNCTION public.user_is_seller_admin(p_seller_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
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
        FROM public.tenants t
        WHERE t.id = p_seller_tenant_id
          AND t.type = 'seller'
          AND EXISTS (
              SELECT 1
              FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_seller_tenant_id) ep
              WHERE ep.action = 'users.manage'
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_agency_admin(p_agency_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        JOIN public.roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = p_agency_tenant_id
          AND tm.user_id = p_user_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
          AND r.name = 'Agency Admin'
    )
    OR EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = p_agency_tenant_id
          AND t.type = 'agency'
          AND EXISTS (
              SELECT 1
              FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_agency_tenant_id) ep
              WHERE ep.action IN ('agency.sellers.link', 'billing.manage')
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_agency_admin_of_seller_parent(
    p_seller_tenant_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenants seller
        WHERE seller.id = p_seller_tenant_id
          AND seller.type = 'seller'
          AND seller.parent_tenant_id IS NOT NULL
          AND public.user_is_agency_admin(seller.parent_tenant_id, p_user_id)
    );
$$;

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
            public.account_is_visible_to_user(p_account_id, p_user_id)
            AND EXISTS (
                SELECT 1
                FROM public.accounts a
                WHERE a.id = p_account_id
                  AND (
                    EXISTS (
                        SELECT 1
                        FROM public.get_user_effective_permissions_on_tenant(p_user_id, a.tenant_id) ep
                        WHERE ep.action = p_permission_action
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM public.tenants seller
                        WHERE seller.id = a.tenant_id
                          AND seller.parent_tenant_id IS NOT NULL
                          AND EXISTS (
                              SELECT 1
                              FROM public.get_user_effective_permissions_on_tenant(
                                  p_user_id,
                                  seller.parent_tenant_id
                              ) ep
                              WHERE ep.action = p_permission_action
                          )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM public.user_seller_assignments usa
                        WHERE usa.user_id = p_user_id
                          AND usa.seller_tenant_id = a.tenant_id
                          AND EXISTS (
                              SELECT 1
                              FROM public.get_user_effective_permissions_on_tenant(
                                  p_user_id,
                                  usa.agency_tenant_id
                              ) ep
                              WHERE ep.action = p_permission_action
                          )
                    )
                  )
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_tenant_members(p_tenant_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_tenant_id IS NOT NULL
    AND p_actor_id IS NOT NULL
    AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_actor_id)
        OR (
            EXISTS (
                SELECT 1 FROM public.tenants t
                WHERE t.id = p_tenant_id AND t.type = 'agency'
            )
            AND (
                public.user_is_agency_admin(p_tenant_id, p_actor_id)
                OR EXISTS (
                    SELECT 1
                    FROM public.get_user_effective_permissions_on_tenant(p_actor_id, p_tenant_id) ep
                    WHERE ep.action = 'users.manage'
                )
            )
        )
        OR (
            EXISTS (
                SELECT 1 FROM public.tenants t
                WHERE t.id = p_tenant_id AND t.type = 'seller'
            )
            AND (
                public.user_is_seller_admin(p_tenant_id, p_actor_id)
                OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, p_actor_id)
            )
        )
    );
$$;

COMMENT ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) IS
    'True when the account is visible to the user and the permission is granted on the seller tenant, parent agency, or assignment agency via effective permissions (membership_roles + primary role).';

COMMENT ON FUNCTION public.user_is_seller_admin(uuid, uuid) IS
    'Seller Admin system role on tenant, or users.manage via effective permissions on a seller tenant.';

COMMENT ON FUNCTION public.user_is_agency_admin(uuid, uuid) IS
    'Agency Admin system role, or agency.sellers.link / billing.manage via effective permissions on an agency tenant.';

COMMENT ON FUNCTION public.user_can_manage_tenant_members(uuid, uuid) IS
    'Platform admin, agency AA/AM-capable (users.manage), or seller admin / parent AA for seller tenants; uses effective permissions where applicable.';
