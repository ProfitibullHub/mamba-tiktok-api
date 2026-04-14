-- Gap 4 & 5: Allow Account Managers to create/update/delete custom roles on their assigned
-- seller tenants, with permissions strictly bounded by the AM's own role permissions.

-- ---------------------------------------------------------------------------
-- Helper: resolve effective permissions for a user on a given agency tenant
-- Used to bound custom role permission scope for AMs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_effective_permissions(
    p_user_id uuid,
    p_agency_tenant_id uuid
)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- System role permissions via agency membership
    SELECT DISTINCT p.action
    FROM tenant_memberships tm
    JOIN roles r ON r.id = tm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_agency_tenant_id
      AND tm.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.get_user_effective_permissions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- create_custom_role: extend to allow AMs on their assigned seller tenants
-- with permissions bounded by the AM's own effective permissions.
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
    v_caller_is_am boolean := false;
    v_agency_tenant_id uuid;
    v_allowed_actions text[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF v_tenant_type = 'agency' THEN
        IF NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Agency Admin can create roles on an agency tenant';
        END IF;
    END IF;

    IF v_tenant_type = 'seller' THEN
        IF public.user_is_seller_admin(p_tenant_id, v_caller)
           OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            -- Full rights: no permission bounding needed
            NULL;
        ELSE
            -- Check if caller is an AM assigned to this seller
            SELECT tm.tenant_id INTO v_agency_tenant_id
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
            JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                AND usa.seller_tenant_id = p_tenant_id
            WHERE tm.user_id = v_caller AND tm.status = 'active'
            LIMIT 1;

            IF v_agency_tenant_id IS NULL THEN
                RAISE EXCEPTION 'Not allowed: must be Seller Admin, parent Agency Admin, or an assigned Account Manager';
            END IF;

            v_caller_is_am := true;
        END IF;
    END IF;

    -- If caller is AM, bound the permission actions to their own effective permissions
    IF v_caller_is_am THEN
        SELECT ARRAY(
            SELECT ep.action
            FROM get_user_effective_permissions(v_caller, v_agency_tenant_id) ep
            WHERE ep.action = ANY(p_permission_actions)
        ) INTO v_allowed_actions;

        -- Detect any permissions the AM requested that are out of scope
        IF array_length(
            ARRAY(SELECT unnest(p_permission_actions) EXCEPT SELECT unnest(v_allowed_actions)), 1
        ) > 0 THEN
            RAISE EXCEPTION
                'Custom role permissions exceed Account Manager scope. Requested permissions out of scope: %',
                ARRAY(SELECT unnest(p_permission_actions) EXCEPT SELECT unnest(v_allowed_actions));
        END IF;
    ELSE
        v_allowed_actions := p_permission_actions;
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

    FOREACH v_action IN ARRAY COALESCE(v_allowed_actions, ARRAY[]::text[])
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

-- ---------------------------------------------------------------------------
-- update_custom_role: extend to allow AMs to update roles they can manage
-- ---------------------------------------------------------------------------
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
    v_caller_is_am boolean := false;
    v_agency_tenant_id uuid;
    v_allowed_actions text[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;

    IF v_tenant_type = 'agency' THEN
        IF NOT public.user_is_agency_admin(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
    ELSIF v_tenant_type = 'seller' THEN
        IF public.user_is_seller_admin(v_tid, v_caller)
           OR public.user_is_agency_admin_of_seller_parent(v_tid, v_caller) THEN
            NULL; -- Full rights
        ELSE
            SELECT tm.tenant_id INTO v_agency_tenant_id
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
            JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                AND usa.seller_tenant_id = v_tid
            WHERE tm.user_id = v_caller AND tm.status = 'active'
            LIMIT 1;

            IF v_agency_tenant_id IS NULL THEN
                RAISE EXCEPTION 'Not allowed';
            END IF;
            v_caller_is_am := true;
        END IF;
    ELSE
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF p_name IS NOT NULL AND trim(p_name) <> '' THEN
        UPDATE roles SET name = trim(p_name), updated_at = NOW() WHERE id = p_role_id;
    END IF;
    IF p_description IS NOT NULL THEN
        UPDATE roles SET description = NULLIF(trim(p_description), ''), updated_at = NOW() WHERE id = p_role_id;
    END IF;

    IF p_permission_actions IS NOT NULL THEN
        -- Apply scope bounding for AMs
        IF v_caller_is_am THEN
            SELECT ARRAY(
                SELECT ep.action
                FROM get_user_effective_permissions(v_caller, v_agency_tenant_id) ep
                WHERE ep.action = ANY(p_permission_actions)
            ) INTO v_allowed_actions;

            IF array_length(
                ARRAY(SELECT unnest(p_permission_actions) EXCEPT SELECT unnest(v_allowed_actions)), 1
            ) > 0 THEN
                RAISE EXCEPTION
                    'Custom role permissions exceed Account Manager scope. Out-of-scope permissions: %',
                    ARRAY(SELECT unnest(p_permission_actions) EXCEPT SELECT unnest(v_allowed_actions));
            END IF;
        ELSE
            v_allowed_actions := p_permission_actions;
        END IF;

        DELETE FROM role_permissions WHERE role_id = p_role_id;
        FOREACH v_action IN ARRAY COALESCE(v_allowed_actions, ARRAY[]::text[])
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

-- ---------------------------------------------------------------------------
-- delete_custom_role: extend to allow AMs on their assigned sellers
-- ---------------------------------------------------------------------------
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

    IF v_tenant_type = 'agency' THEN
        IF NOT public.user_is_agency_admin(v_tid, v_caller) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
    ELSIF v_tenant_type = 'seller' THEN
        IF NOT public.user_is_seller_admin(v_tid, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(v_tid, v_caller)
           AND NOT EXISTS (
                SELECT 1
                FROM tenant_memberships tm
                JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
                JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                    AND usa.seller_tenant_id = v_tid
                WHERE tm.user_id = v_caller AND tm.status = 'active'
           ) THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
    ELSE
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF EXISTS (SELECT 1 FROM tenant_memberships WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Role is assigned to members; reassign them first';
    END IF;

    DELETE FROM role_permissions WHERE role_id = p_role_id;
    DELETE FROM roles WHERE id = p_role_id;
END;
$$;

COMMENT ON FUNCTION public.create_custom_role IS
    'Create tenant custom role. AMs may create on their assigned sellers; permissions are bounded to their own effective permissions.';
COMMENT ON FUNCTION public.update_custom_role IS
    'Update tenant custom role. AMs may update roles on their assigned sellers; permissions are bounded to their own scope.';
COMMENT ON FUNCTION public.delete_custom_role IS
    'Delete tenant custom role. AMs may delete on their assigned sellers.';
