-- Allow Agency Admins to manage roles, custom roles, and members on seller
-- tenants that are linked to their agency (tenants.parent_tenant_id = agency.id).

-- 1. Helper: is the user an Agency Admin on the parent agency of this seller tenant?
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
        FROM tenants seller
        JOIN tenant_memberships tm ON tm.tenant_id = seller.parent_tenant_id
                                   AND tm.user_id = p_user_id
                                   AND tm.status = 'active'
        JOIN roles r ON r.id = tm.role_id
                     AND r.name = 'Agency Admin'
                     AND r.tenant_id IS NULL
        WHERE seller.id = p_seller_tenant_id
          AND seller.type = 'seller'
          AND seller.parent_tenant_id IS NOT NULL
    );
$$;

COMMENT ON FUNCTION public.user_is_agency_admin_of_seller_parent IS
    'True when p_user_id is Agency Admin on the parent agency of seller tenant p_seller_tenant_id.';


-- 2. Recreate tenant_set_member_role with Agency Admin → linked seller support
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
    v_is_platform_op boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_is_platform_op := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                         OR public.user_is_platform_super_admin(v_caller);

    IF p_user_id = v_caller AND NOT v_is_platform_op THEN
        RAISE EXCEPTION 'You cannot change your own role';
    END IF;

    IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Platform admins cannot be assigned tenant roles';
    END IF;
    IF public.user_is_platform_super_admin(p_user_id) THEN
        RAISE EXCEPTION 'Super Admins cannot be assigned tenant roles';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF NOT v_is_platform_op THEN
        IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Agency Admin can manage this tenant';
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(p_tenant_id, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin or parent Agency Admin can manage this tenant';
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


-- 3. Recreate user_can_manage_tenant_members with Agency Admin → linked seller
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
        EXISTS (SELECT 1 FROM profiles WHERE id = p_actor_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_actor_id)
        OR (
            EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND type = 'agency')
            AND public.user_is_agency_admin(p_tenant_id, p_actor_id)
        )
        OR (
            EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND type = 'seller')
            AND (
                public.user_is_seller_admin(p_tenant_id, p_actor_id)
                OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, p_actor_id)
            )
        )
    );
$$;


-- 4. Recreate tenant_set_member_role_for_actor with Agency Admin → linked seller
CREATE OR REPLACE FUNCTION public.tenant_set_member_role_for_actor(
    p_actor_id uuid,
    p_tenant_id uuid,
    p_target_user_id uuid,
    p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := p_actor_id;
    v_tenant_type text;
    v_role record;
    v_mid uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Invalid actor';
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
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(p_tenant_id, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin or parent Agency Admin can manage this tenant';
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

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_tenant_id, p_target_user_id, p_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.user_can_manage_tenant_members(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_tenant_members(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.tenant_set_member_role_for_actor(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_set_member_role_for_actor(uuid, uuid, uuid, uuid) TO service_role;


-- 5. Recreate create_custom_role with Agency Admin → linked seller
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
    v_is_platform_op boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    v_is_platform_op := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                         OR public.user_is_platform_super_admin(v_caller);

    IF NOT v_is_platform_op THEN
        IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Agency Admin can create roles here';
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(p_tenant_id, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin or parent Agency Admin can create roles here';
        END IF;
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


-- 6. Recreate update_custom_role with Agency Admin → linked seller
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
    v_is_platform_op boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    v_is_platform_op := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                         OR public.user_is_platform_super_admin(v_caller);

    IF NOT v_is_platform_op THEN
        SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;
        IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(v_tid, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
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


-- 7. Recreate delete_custom_role with Agency Admin → linked seller
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
    v_is_platform_op boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    v_is_platform_op := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                         OR public.user_is_platform_super_admin(v_caller);

    IF NOT v_is_platform_op THEN
        SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;
        IF v_tenant_type = 'agency' AND NOT public.user_is_agency_admin(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(v_tid, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM tenant_memberships WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Role is assigned to members; reassign them first';
    END IF;

    DELETE FROM role_permissions WHERE role_id = p_role_id;
    DELETE FROM roles WHERE id = p_role_id;
END;
$$;
