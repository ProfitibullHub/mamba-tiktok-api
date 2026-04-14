-- Fix: get_my_custom_role_permission_ceiling must never raise for authenticated users.
-- Previously it raised 'Not allowed' for callers who lack role-management rights,
-- causing a Supabase 500 error that the frontend displayed as "Could not load permission scope".
-- The correct semantic is an empty array: "you may not delegate any permissions".
-- Enforcement (create/update_custom_role) is unaffected — non-admins still cannot write roles.

CREATE OR REPLACE FUNCTION public.get_my_custom_role_permission_ceiling(p_tenant_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_type   text;
BEGIN
    -- Must be authenticated
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Tenant must exist and not be the platform tenant
    SELECT type INTO v_type FROM tenants WHERE id = p_tenant_id;
    IF v_type IS NULL OR v_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    -- Platform operators (legacy admin profile or Super Admin) → unbounded (NULL = full catalog)
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
       OR public.user_is_platform_super_admin(v_caller) THEN
        RETURN NULL;
    END IF;

    -- Agency Admin on this agency tenant
    IF v_type = 'agency' AND public.user_is_agency_admin(p_tenant_id, v_caller) THEN
        RETURN public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, p_tenant_id);
    END IF;

    -- Seller Admin, parent Agency Admin, or Account Manager assigned to this seller
    IF v_type = 'seller' THEN
        IF public.user_is_seller_admin(p_tenant_id, v_caller)
           OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RETURN public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, p_tenant_id);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
            JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                AND usa.seller_tenant_id = p_tenant_id
            WHERE tm.user_id = v_caller AND tm.status = 'active'
        ) THEN
            RETURN public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, p_tenant_id);
        END IF;
    END IF;

    -- All other authenticated users: no delegatable permissions (not an error)
    RETURN ARRAY[]::text[];
END;
$$;

-- Grant/revoke unchanged — authenticated users may still call the function.
REVOKE ALL ON FUNCTION public.get_my_custom_role_permission_ceiling(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_custom_role_permission_ceiling(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_custom_role_permission_ceiling IS
    'Actions the caller may assign to custom roles on this tenant.
     Returns NULL for platform operators (unbounded / full catalog),
     a subset for authorized admins/AMs, or an empty array for all other
     authenticated users. Never raises for authenticated callers.';

-- Also update the alias so it inherits the same non-raising behaviour.
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
    'Alias for get_my_custom_role_permission_ceiling (same behaviour; never raises for authenticated callers).';
