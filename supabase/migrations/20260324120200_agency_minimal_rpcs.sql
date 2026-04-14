-- Phase 2 (agency slice, minimal): RPCs to create agencies, link seller tenants,
-- add staff memberships (Agency Admin / AM / AC), and grant AM/AC access to sellers.

CREATE OR REPLACE FUNCTION public.user_is_agency_admin(p_agency_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = p_agency_tenant_id
          AND tm.user_id = p_user_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
          AND r.name = 'Agency Admin'
    );
$$;

-- Self-serve: authenticated user creates an agency tenant and becomes Agency Admin.
CREATE OR REPLACE FUNCTION public.create_agency_tenant(p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role_id uuid;
    v_agency_id uuid;
    v_label text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
        RAISE EXCEPTION 'Profile required';
    END IF;

    SELECT id INTO v_role_id
    FROM roles
    WHERE tenant_id IS NULL AND name = 'Agency Admin'
    LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Agency Admin system role missing';
    END IF;

    v_label := COALESCE(NULLIF(trim(p_name), ''), 'New Agency');

    INSERT INTO tenants (name, type, status)
    VALUES (v_label, 'agency', 'active')
    RETURNING id INTO v_agency_id;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (v_agency_id, v_uid, v_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW();

    RETURN v_agency_id;
END;
$$;

-- Agency Admin adds / updates a user on the agency with an agency-scoped system role.
CREATE OR REPLACE FUNCTION public.agency_add_staff_membership(
    p_agency_tenant_id uuid,
    p_user_id uuid,
    p_role_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_role_id uuid;
    v_membership_id uuid;
    v_norm text := trim(p_role_name);
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT user_is_agency_admin(p_agency_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only Agency Admin can manage staff';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t
        WHERE t.id = p_agency_tenant_id AND t.type = 'agency'
    ) THEN
        RAISE EXCEPTION 'Invalid agency tenant';
    END IF;
    IF v_norm NOT IN ('Agency Admin', 'Account Manager', 'Account Coordinator') THEN
        RAISE EXCEPTION 'Invalid agency role name';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    SELECT r.id INTO v_role_id
    FROM roles r
    WHERE r.tenant_id IS NULL AND r.name = v_norm AND r.scope = 'agency'
    LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Role not found: %', v_norm;
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_agency_tenant_id, p_user_id, v_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW()
    RETURNING id INTO v_membership_id;

    RETURN v_membership_id;
END;
$$;

-- Attach an existing seller tenant under an agency (parent_tenant_id).
CREATE OR REPLACE FUNCTION public.agency_link_seller_tenant(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_parent uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT user_is_agency_admin(p_agency_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only Agency Admin can link sellers';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = p_agency_tenant_id AND t.type = 'agency'
    ) THEN
        RAISE EXCEPTION 'Invalid agency tenant';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = p_seller_tenant_id AND t.type = 'seller'
    ) THEN
        RAISE EXCEPTION 'Invalid seller tenant';
    END IF;

    SELECT parent_tenant_id INTO v_parent
    FROM tenants
    WHERE id = p_seller_tenant_id;

    IF v_parent IS NOT NULL AND v_parent <> p_agency_tenant_id THEN
        RAISE EXCEPTION 'Seller tenant already linked to another agency';
    END IF;

    UPDATE tenants
    SET parent_tenant_id = p_agency_tenant_id,
        updated_at = NOW()
    WHERE id = p_seller_tenant_id
      AND type = 'seller';
END;
$$;

-- Let AM/AC see a seller tenant via user_seller_assignments (SOW scoped access).
CREATE OR REPLACE FUNCTION public.agency_grant_staff_seller_access(
    p_agency_tenant_id uuid,
    p_staff_user_id uuid,
    p_seller_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_membership_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT user_is_agency_admin(p_agency_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only Agency Admin can assign sellers to staff';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants s
        WHERE s.id = p_seller_tenant_id
          AND s.type = 'seller'
          AND s.parent_tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    SELECT tm.id INTO v_membership_id
    FROM tenant_memberships tm
    JOIN roles r ON r.id = tm.role_id
    WHERE tm.tenant_id = p_agency_tenant_id
      AND tm.user_id = p_staff_user_id
      AND tm.status = 'active'
      AND r.tenant_id IS NULL
      AND r.name IN ('Account Manager', 'Account Coordinator')
    LIMIT 1;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User is not an active Account Manager or Coordinator on this agency';
    END IF;

    INSERT INTO user_seller_assignments (tenant_membership_id, seller_tenant_id)
    VALUES (v_membership_id, p_seller_tenant_id)
    ON CONFLICT (tenant_membership_id, seller_tenant_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.user_is_agency_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_agency_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_add_staff_membership(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_link_seller_tenant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_grant_staff_seller_access(uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_agency_tenant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_add_staff_membership(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_link_seller_tenant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_grant_staff_seller_access(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.create_agency_tenant IS 'Creates agency tenant; caller becomes Agency Admin.';
COMMENT ON FUNCTION public.agency_add_staff_membership IS 'Agency Admin: add/update staff role on agency tenant.';
COMMENT ON FUNCTION public.agency_link_seller_tenant IS 'Agency Admin: set seller.parent_tenant_id to this agency.';
COMMENT ON FUNCTION public.agency_grant_staff_seller_access IS 'Agency Admin: assign seller to AM/AC via user_seller_assignments.';
