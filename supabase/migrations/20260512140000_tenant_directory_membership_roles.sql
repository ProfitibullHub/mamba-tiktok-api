-- Agency team directory: any active agency member may list colleagues (fixes custom-role AM/AC).
-- Role labels: aggregate names from membership_roles (not only tenant_memberships.role_id).
-- Seller-context listing: staff access via user_seller_assignments (works for custom roles).

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
    v_list_tenant_id uuid := p_tenant_id;
    v_parent_agency uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_type FROM tenants WHERE id = p_tenant_id;
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Tenant not found';
    END IF;

    -- Platform operators
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
       OR public.user_is_platform_super_admin(v_caller) THEN
        v_ok := true;
    -- Any active member of this agency (system or custom roles)
    ELSIF v_type = 'agency' AND EXISTS (
        SELECT 1
        FROM tenant_memberships tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = v_caller
          AND tm.status = 'active'
    ) THEN
        v_ok := true;
    -- Seller Admin on this seller tenant
    ELSIF v_type = 'seller' AND public.user_is_seller_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    -- Agency Admin on the parent agency of this seller
    ELSIF v_type = 'seller' AND public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
        v_ok := true;
    -- Staff assigned to this seller: list parent agency team (custom roles included)
    ELSIF v_type = 'seller' AND EXISTS (
        SELECT 1
        FROM public.user_seller_assignments usa
        WHERE usa.seller_tenant_id = p_tenant_id
          AND usa.user_id = v_caller
          AND usa.agency_tenant_id = (
              SELECT t.parent_tenant_id
              FROM public.tenants t
              WHERE t.id = p_tenant_id AND t.type = 'seller'
              LIMIT 1
          )
    ) THEN
        v_ok := true;
        SELECT parent_tenant_id INTO v_parent_agency
        FROM tenants
        WHERE id = p_tenant_id AND type = 'seller';
        IF v_parent_agency IS NOT NULL THEN
            v_list_tenant_id := v_parent_agency;
        END IF;
    END IF;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    RETURN QUERY
    SELECT
        tm.id,
        tm.user_id,
        p.email,
        p.full_name,
        tm.role_id,
        COALESCE(
            NULLIF(
                (
                    SELECT string_agg(r2.name, ', ' ORDER BY r2.name)
                    FROM membership_roles mr2
                    JOIN roles r2 ON r2.id = mr2.role_id AND r2.deleted_at IS NULL
                    WHERE mr2.membership_id = tm.id AND mr2.revoked_at IS NULL
                ),
                ''
            ),
            r.name
        )::text AS role_name,
        COALESCE(
            (
                SELECT r3.type
                FROM membership_roles mr3
                JOIN roles r3 ON r3.id = mr3.role_id AND r3.deleted_at IS NULL
                WHERE mr3.membership_id = tm.id AND mr3.revoked_at IS NULL
                ORDER BY mr3.created_at DESC, mr3.id DESC
                LIMIT 1
            ),
            r.type
        )::text AS role_type,
        tm.status
    FROM tenant_memberships tm
    JOIN profiles p ON p.id = tm.user_id
    LEFT JOIN roles r ON r.id = tm.role_id AND r.deleted_at IS NULL
    WHERE tm.tenant_id = v_list_tenant_id
    ORDER BY p.email NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.tenant_directory_for_admin IS
    'List members for tenant context. Agency: any active member. Seller: Seller Admin, parent AA, or assigned staff (see parent agency team). Role names come from membership_roles when present.';
