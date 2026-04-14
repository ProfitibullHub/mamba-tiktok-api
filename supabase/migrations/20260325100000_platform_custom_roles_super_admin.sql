-- Platform tenant, Super Admin membership visibility, custom roles RPCs, tighter catalog RLS,
-- roles.manage permission, and backfill legacy profiles.role = admin → platform membership.

-- ---------------------------------------------------------------------------
-- 1. tenants.type = platform (singleton internal tenant for Super Admin memberships)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_agency_root;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_type_check;

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_type_check CHECK (type IN ('agency', 'seller', 'platform'));

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_agency_root CHECK (
        (type = 'seller')
        OR (type = 'agency' AND parent_tenant_id IS NULL)
        OR (type = 'platform' AND parent_tenant_id IS NULL)
    );

INSERT INTO public.tenants (name, type, status)
SELECT 'Mamba Platform', 'platform', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.tenants WHERE type = 'platform');

-- ---------------------------------------------------------------------------
-- 2. Permission: define custom roles (subset of catalog permissions)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (action, description) VALUES
    ('roles.manage', 'Create and edit custom roles and assign permissions for this tenant')
ON CONFLICT (action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.action = 'roles.manage'
WHERE r.tenant_id IS NULL AND r.name IN ('Agency Admin', 'Seller Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Helpers: seller admin, platform Super Admin (membership-based)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_is_seller_admin(p_seller_tenant_id uuid, p_user_id uuid)
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
        WHERE tm.tenant_id = p_seller_tenant_id
          AND tm.user_id = p_user_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
          AND r.name = 'Seller Admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_platform_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Super Admin'
        JOIN tenants plat ON plat.id = tm.tenant_id AND plat.type = 'platform'
        WHERE tm.user_id = p_user_id AND tm.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.user_is_seller_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_platform_super_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_seller_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_platform_super_admin(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tenant visibility: Super Admin membership OR legacy profiles.role = admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_is_visible_to_user(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_tenant_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
        EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1 FROM tenant_memberships tm
            WHERE tm.user_id = p_user_id AND tm.status = 'active' AND tm.tenant_id = p_tenant_id
        )
        OR EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Agency Admin'
            JOIN tenants agency ON agency.id = tm.tenant_id AND agency.type = 'agency'
            JOIN tenants seller ON seller.parent_tenant_id = agency.id
                AND seller.id = p_tenant_id AND seller.type = 'seller'
            WHERE tm.user_id = p_user_id AND tm.status = 'active'
        )
        OR EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL
                AND r.name IN ('Account Manager', 'Account Coordinator')
            JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                AND usa.seller_tenant_id = p_tenant_id
            WHERE tm.user_id = p_user_id AND tm.status = 'active'
        )
    );
$$;

COMMENT ON FUNCTION public.tenant_is_visible_to_user(uuid, uuid) IS
    'Tenant access: legacy admin, Super Admin (platform membership), direct membership, agency tree, AM/AC assignments.';

-- ---------------------------------------------------------------------------
-- 5. RLS: roles / role_permissions — only system + own-tenant custom (not others'' catalogs)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "roles_select_authenticated" ON public.roles;
DROP POLICY IF EXISTS "roles_select_visible" ON public.roles;

CREATE POLICY "roles_select_visible" ON public.roles FOR SELECT TO authenticated
USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT public.user_active_tenant_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR public.user_is_platform_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_select_visible" ON public.role_permissions;

CREATE POLICY "role_permissions_select_visible" ON public.role_permissions FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_permissions.role_id
          AND (
              r.tenant_id IS NULL
              OR r.tenant_id IN (SELECT public.user_active_tenant_ids(auth.uid()))
              OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
              OR public.user_is_platform_super_admin(auth.uid())
          )
    )
);

-- ---------------------------------------------------------------------------
-- 6. RPC: custom roles (tenant-scoped)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_custom_role(
    p_tenant_id uuid,
    p_name text,
    p_description text DEFAULT NULL,
    p_permission_actions text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tenant_type text;
    v_scope text;
    v_role_id uuid;
    v_action text;
    v_perm_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only Agency Admin can create roles here';
    END IF;
    IF v_tenant_type = 'seller' AND NOT public.user_is_seller_admin(p_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only Seller Admin can create roles here';
    END IF;

    v_scope := v_tenant_type;

    INSERT INTO roles (tenant_id, name, description, type, scope)
    VALUES (
        p_tenant_id,
        trim(p_name),
        NULLIF(trim(p_description), ''),
        'custom',
        v_scope
    )
    RETURNING id INTO v_role_id;

    FOREACH v_action IN ARRAY p_permission_actions
    LOOP
        SELECT id INTO v_perm_id FROM permissions WHERE action = trim(v_action) LIMIT 1;
        IF v_perm_id IS NULL THEN
            RAISE EXCEPTION 'Unknown permission: %', v_action;
        END IF;
        INSERT INTO role_permissions (role_id, permission_id) VALUES (v_role_id, v_perm_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN v_role_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_custom_role(
    p_role_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_permission_actions text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tid uuid;
    v_tenant_type text;
    v_action text;
    v_perm_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;
    IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(v_tid, v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;
    IF v_tenant_type = 'seller' AND NOT public.user_is_seller_admin(v_tid, v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF p_name IS NOT NULL AND trim(p_name) <> '' THEN
        UPDATE roles SET name = trim(p_name), updated_at = NOW() WHERE id = p_role_id;
    END IF;
    IF p_description IS NOT NULL THEN
        UPDATE roles SET description = NULLIF(trim(p_description), ''), updated_at = NOW() WHERE id = p_role_id;
    END IF;

    IF p_permission_actions IS NOT NULL THEN
        DELETE FROM role_permissions WHERE role_id = p_role_id;
        FOREACH v_action IN ARRAY p_permission_actions
        LOOP
            SELECT id INTO v_perm_id FROM permissions WHERE action = trim(v_action) LIMIT 1;
            IF v_perm_id IS NULL THEN
                RAISE EXCEPTION 'Unknown permission: %', v_action;
            END IF;
            INSERT INTO role_permissions (role_id, permission_id) VALUES (p_role_id, v_perm_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_role(p_role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tid uuid;
    v_tenant_type text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;
    IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(v_tid, v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;
    IF v_tenant_type = 'seller' AND NOT public.user_is_seller_admin(v_tid, v_caller) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF EXISTS (SELECT 1 FROM tenant_memberships WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Role is assigned to members; reassign them first';
    END IF;

    DELETE FROM role_permissions WHERE role_id = p_role_id;
    DELETE FROM roles WHERE id = p_role_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: set member role (system or custom) on agency or seller tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_set_member_role(
    p_tenant_id uuid,
    p_user_id uuid,
    p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tenant_type text;
    v_role record;
    v_mid uuid;
    v_platform_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF NOT (
        EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
        OR public.user_is_platform_super_admin(v_caller)
    ) THEN
        IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Agency Admin can manage this tenant';
        END IF;
        IF v_tenant_type = 'seller' AND NOT public.user_is_seller_admin(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin can manage this tenant';
        END IF;
    END IF;

    SELECT * INTO v_role FROM roles WHERE id = p_role_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Role not found';
    END IF;

    IF v_role.tenant_id IS NULL AND v_role.name = 'Super Admin' THEN
        RAISE EXCEPTION 'Use grant_super_admin_membership for Super Admin';
    END IF;

    IF v_role.tenant_id IS NOT NULL THEN
        IF v_role.tenant_id <> p_tenant_id OR v_role.type <> 'custom' THEN
            RAISE EXCEPTION 'Custom role must belong to this tenant';
        END IF;
    ELSE
        IF v_role.type <> 'system' THEN
            RAISE EXCEPTION 'Invalid system role';
        END IF;
        IF v_tenant_type = 'agency' AND v_role.scope <> 'agency' THEN
            RAISE EXCEPTION 'Role scope does not match agency tenant';
        END IF;
        IF v_tenant_type = 'seller' AND v_role.scope <> 'seller' THEN
            RAISE EXCEPTION 'Role scope does not match seller tenant';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_tenant_id, p_user_id, p_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: Super Admin platform membership (explicit row; complements legacy profiles.role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_super_admin_membership(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_platform uuid;
    v_role uuid;
    v_mid uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT (
        EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
        OR public.user_is_platform_super_admin(v_caller)
    ) THEN
        RAISE EXCEPTION 'Only Super Admin or legacy admin can grant';
    END IF;

    SELECT id INTO v_platform FROM tenants WHERE type = 'platform' ORDER BY created_at LIMIT 1;
    IF v_platform IS NULL THEN
        RAISE EXCEPTION 'Platform tenant missing';
    END IF;

    SELECT id INTO v_role FROM roles WHERE tenant_id IS NULL AND name = 'Super Admin' LIMIT 1;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Super Admin role missing';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (v_platform, p_user_id, v_role, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_super_admin_membership(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_platform uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT (
        EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
        OR public.user_is_platform_super_admin(v_caller)
    ) THEN
        RAISE EXCEPTION 'Only Super Admin or legacy admin can revoke';
    END IF;

    SELECT id INTO v_platform FROM tenants WHERE type = 'platform' ORDER BY created_at LIMIT 1;
    IF v_platform IS NULL THEN
        RAISE EXCEPTION 'Platform tenant missing';
    END IF;

    DELETE FROM tenant_memberships
    WHERE tenant_id = v_platform AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_custom_role(uuid, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_custom_role(uuid, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_custom_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_set_member_role(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_super_admin_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_super_admin_membership(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_custom_role(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_custom_role(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_set_member_role(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_super_admin_membership(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_super_admin_membership(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Backfill: legacy internal admins get platform Super Admin membership
-- ---------------------------------------------------------------------------
INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
SELECT plat.id, pr.id, sr.id, 'active'
FROM profiles pr
CROSS JOIN tenants plat
CROSS JOIN roles sr
WHERE pr.role = 'admin'
  AND plat.type = 'platform'
  AND sr.tenant_id IS NULL
  AND sr.name = 'Super Admin'
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. Directory: member emails for tenant admins (profiles RLS is self-only)
-- ---------------------------------------------------------------------------
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

    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
       OR public.user_is_platform_super_admin(v_caller) THEN
        v_ok := true;
    ELSIF v_type = 'agency' AND public.user_is_agency_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    ELSIF v_type = 'seller' AND public.user_is_seller_admin(p_tenant_id, v_caller) THEN
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

REVOKE ALL ON FUNCTION public.tenant_directory_for_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_directory_for_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_super_admins()
RETURNS TABLE (
    user_id uuid,
    email text,
    full_name text,
    membership_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plat uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR public.user_is_platform_super_admin(auth.uid())
    ) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    SELECT id INTO v_plat FROM tenants WHERE type = 'platform' ORDER BY created_at LIMIT 1;
    IF v_plat IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT p.id, p.email, p.full_name, tm.id
    FROM tenant_memberships tm
    JOIN profiles p ON p.id = tm.user_id
    JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Super Admin'
    WHERE tm.tenant_id = v_plat AND tm.status = 'active'
    ORDER BY p.email NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_super_admins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_super_admins() TO authenticated;

COMMENT ON FUNCTION public.create_custom_role IS 'Agency/Seller admin: create tenant custom role and permission subset.';
COMMENT ON FUNCTION public.tenant_set_member_role IS 'Assign system or tenant custom role to a user on an agency or seller tenant.';
COMMENT ON FUNCTION public.tenant_directory_for_admin IS 'Tenant admin: list members with profile email for one tenant.';
