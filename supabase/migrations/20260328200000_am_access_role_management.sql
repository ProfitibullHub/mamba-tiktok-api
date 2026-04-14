-- Allow Account Managers to call tenant_directory_for_admin on their assigned seller tenants.
-- Previously only Agency Admin and Seller Admin could call this RPC.

CREATE OR REPLACE FUNCTION public.tenant_directory_for_admin(p_tenant_id uuid)
RETURNS TABLE (
    membership_id uuid,
    user_id uuid,
    email text,
    full_name text,
    role_id uuid,
    role_name text,
    role_type text,
    status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_type text;
    v_ok boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_type FROM tenants WHERE id = p_tenant_id;
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Tenant not found';
    END IF;

    -- Platform operators (legacy admin or Super Admin)
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
       OR public.user_is_platform_super_admin(v_caller) THEN
        v_ok := true;
    -- Agency Admin on this agency tenant
    ELSIF v_type = 'agency' AND public.user_is_agency_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    -- Seller Admin on this seller tenant
    ELSIF v_type = 'seller' AND public.user_is_seller_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    -- Agency Admin on the parent agency of this seller
    ELSIF v_type = 'seller' AND public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
        v_ok := true;
    -- Account Manager assigned to this seller tenant
    ELSIF v_type = 'seller' AND EXISTS (
        SELECT 1
        FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
        JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
            AND usa.seller_tenant_id = p_tenant_id
        WHERE tm.user_id = v_caller AND tm.status = 'active'
    ) THEN
        v_ok := true;
    END IF;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    RETURN QUERY
    SELECT tm.id, tm.user_id, p.email, p.full_name, r.id, r.name, r.type, tm.status
    FROM tenant_memberships tm
    JOIN profiles p ON p.id = tm.user_id
    JOIN roles r ON r.id = tm.role_id
    WHERE tm.tenant_id = p_tenant_id
    ORDER BY p.email NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.tenant_directory_for_admin IS
    'List members of a tenant. Allowed for: platform ops, Agency Admin, Seller Admin, parent Agency Admin, or Account Manager assigned to this seller.';
