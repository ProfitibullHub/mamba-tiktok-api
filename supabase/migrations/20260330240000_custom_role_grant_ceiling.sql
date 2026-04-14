-- Enforce that custom-role grants cannot exceed the caller's effective permissions.
-- Fixes privilege escalation where Seller Admin (or similar) could assign permissions
-- they do not hold (e.g. agency.*) by creating/editing custom roles.

-- ---------------------------------------------------------------------------
-- Effective permissions from active memberships on a specific tenant
-- (any tenant: agency, seller, platform membership if any).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_effective_permissions_on_tenant(
    p_user_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT perm.action
    FROM tenant_memberships tm
    JOIN roles r ON r.id = tm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions perm ON perm.id = rp.permission_id
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_tenant_id
      AND tm.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.get_user_effective_permissions_on_tenant(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Ceiling of permission actions a user may assign to custom roles on a tenant.
-- Seller: union of (memberships on seller) + (parent agency, if AA on parent)
--         + (AM effective perms on assigned agency, if AM assigned to seller).
-- Agency: effective permissions on that agency tenant only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_custom_role_permission_ceiling_for_tenant(
    p_user_id uuid,
    p_tenant_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type text;
    v_actions text[];
BEGIN
    SELECT type INTO v_type FROM tenants WHERE id = p_tenant_id;
    IF v_type IS NULL THEN
        RETURN ARRAY[]::text[];
    END IF;

    IF v_type = 'agency' THEN
        SELECT COALESCE(
            ARRAY_AGG(DISTINCT x.action ORDER BY x.action),
            ARRAY[]::text[]
        )
        INTO v_actions
        FROM get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) AS x(action);
        RETURN v_actions;
    END IF;

    IF v_type = 'seller' THEN
        SELECT COALESCE(
            ARRAY_AGG(DISTINCT u.action ORDER BY u.action),
            ARRAY[]::text[]
        )
        INTO v_actions
        FROM (
            SELECT ep.action
            FROM get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) ep

            UNION

            SELECT ep.action
            FROM tenants s
            CROSS JOIN LATERAL get_user_effective_permissions_on_tenant(p_user_id, s.parent_tenant_id) ep
            WHERE s.id = p_tenant_id
              AND s.type = 'seller'
              AND s.parent_tenant_id IS NOT NULL
              AND public.user_is_agency_admin_of_seller_parent(p_tenant_id, p_user_id)

            UNION

            SELECT ep.action
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
            JOIN user_seller_assignments usa
                ON usa.tenant_membership_id = tm.id AND usa.seller_tenant_id = p_tenant_id
            CROSS JOIN LATERAL get_user_effective_permissions(p_user_id, tm.tenant_id) ep
            WHERE tm.user_id = p_user_id AND tm.status = 'active'
        ) u;
        RETURN COALESCE(v_actions, ARRAY[]::text[]);
    END IF;

    RETURN ARRAY[]::text[];
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_custom_role_permission_ceiling_for_tenant(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Authenticated: permission actions the current user may grant on custom roles
-- for this tenant. NULL = unbounded (platform operator).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_custom_role_permission_ceiling(p_tenant_id uuid)
RETURNS text[]
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
    IF v_type IS NULL OR v_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
       OR public.user_is_platform_super_admin(v_caller) THEN
        RETURN NULL;
    END IF;

    IF v_type = 'agency' AND public.user_is_agency_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    ELSIF v_type = 'seller' AND public.user_is_seller_admin(p_tenant_id, v_caller) THEN
        v_ok := true;
    ELSIF v_type = 'seller' AND public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
        v_ok := true;
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

    RETURN public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_custom_role_permission_ceiling(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_custom_role_permission_ceiling(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_custom_role_permission_ceiling IS
    'Actions the caller may assign to custom roles on this tenant; NULL if unbounded (platform operator).';

-- ---------------------------------------------------------------------------
-- create_custom_role: apply ceiling for all non-platform operators
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
    v_unbounded boolean := false;
    v_ceiling text[];
    v_allowed_actions text[];
    v_trimmed text[];
    v_out_scope text[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_unbounded := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                   OR public.user_is_platform_super_admin(v_caller);

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
    END IF;

    IF v_tenant_type = 'agency' THEN
        IF NOT public.user_is_agency_admin(p_tenant_id, v_caller) AND NOT v_unbounded THEN
            RAISE EXCEPTION 'Only Agency Admin can create roles on an agency tenant';
        END IF;
    END IF;

    IF v_tenant_type = 'seller' THEN
        IF public.user_is_seller_admin(p_tenant_id, v_caller)
           OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            NULL;
        ELSE
            IF NOT EXISTS (
                SELECT 1
                FROM tenant_memberships tm
                JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
                JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                    AND usa.seller_tenant_id = p_tenant_id
                WHERE tm.user_id = v_caller AND tm.status = 'active'
            ) AND NOT v_unbounded THEN
                RAISE EXCEPTION 'Not allowed: must be Seller Admin, parent Agency Admin, or an assigned Account Manager';
            END IF;
        END IF;
    END IF;

    v_trimmed := ARRAY(
        SELECT trim(both FROM x)
        FROM unnest(COALESCE(p_permission_actions, ARRAY[]::text[])) AS t(x)
        WHERE trim(both FROM x) <> ''
    );

    IF v_unbounded THEN
        v_allowed_actions := v_trimmed;
    ELSE
        v_ceiling := public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, p_tenant_id);

        SELECT ARRAY_AGG(trimmed ORDER BY trimmed)
        INTO v_allowed_actions
        FROM unnest(v_trimmed) AS q(trimmed)
        WHERE trimmed = ANY (v_ceiling);

        SELECT ARRAY_AGG(x ORDER BY x)
        INTO v_out_scope
        FROM (
            SELECT unnest(v_trimmed) AS x
            EXCEPT
            SELECT unnest(v_ceiling)
        ) s;

        IF v_out_scope IS NOT NULL AND array_length(v_out_scope, 1) > 0 THEN
            RAISE EXCEPTION
                'Custom role permissions exceed your effective scope. Out-of-scope actions: %',
                v_out_scope;
        END IF;

        v_allowed_actions := COALESCE(v_allowed_actions, ARRAY[]::text[]);
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
-- update_custom_role: same ceiling for non-platform operators
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
    v_unbounded boolean := false;
    v_ceiling text[];
    v_allowed_actions text[];
    v_trimmed text[];
    v_out_scope text[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_unbounded := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                   OR public.user_is_platform_super_admin(v_caller);

    SELECT tenant_id INTO v_tid FROM roles WHERE id = p_role_id AND type = 'custom';
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Not a custom role';
    END IF;

    SELECT type INTO v_tenant_type FROM tenants WHERE id = v_tid;

    IF v_tenant_type = 'agency' THEN
        IF NOT public.user_is_agency_admin(v_tid, v_caller) AND NOT v_unbounded THEN
            RAISE EXCEPTION 'Not allowed';
        END IF;
    ELSIF v_tenant_type = 'seller' THEN
        IF public.user_is_seller_admin(v_tid, v_caller)
           OR public.user_is_agency_admin_of_seller_parent(v_tid, v_caller) THEN
            NULL;
        ELSE
            IF NOT EXISTS (
                SELECT 1
                FROM tenant_memberships tm
                JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Account Manager'
                JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                    AND usa.seller_tenant_id = v_tid
                WHERE tm.user_id = v_caller AND tm.status = 'active'
            ) AND NOT v_unbounded THEN
                RAISE EXCEPTION 'Not allowed';
            END IF;
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
        v_trimmed := ARRAY(
            SELECT trim(both FROM x)
            FROM unnest(COALESCE(p_permission_actions, ARRAY[]::text[])) AS t(x)
            WHERE trim(both FROM x) <> ''
        );

        IF v_unbounded THEN
            v_allowed_actions := v_trimmed;
        ELSE
            v_ceiling := public.get_user_custom_role_permission_ceiling_for_tenant(v_caller, v_tid);

            SELECT ARRAY_AGG(trimmed ORDER BY trimmed)
            INTO v_allowed_actions
            FROM unnest(v_trimmed) AS q(trimmed)
            WHERE trimmed = ANY (v_ceiling);

            SELECT ARRAY_AGG(x ORDER BY x)
            INTO v_out_scope
            FROM (
                SELECT unnest(v_trimmed) AS x
                EXCEPT
                SELECT unnest(v_ceiling)
            ) s;

            IF v_out_scope IS NOT NULL AND array_length(v_out_scope, 1) > 0 THEN
                RAISE EXCEPTION
                    'Custom role permissions exceed your effective scope. Out-of-scope actions: %',
                    v_out_scope;
            END IF;

            v_allowed_actions := COALESCE(v_allowed_actions, ARRAY[]::text[]);
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

COMMENT ON FUNCTION public.create_custom_role IS
    'Create tenant custom role. Permission grants are bounded to the caller''s effective permissions (except platform operators).';
COMMENT ON FUNCTION public.update_custom_role IS
    'Update tenant custom role. Permission grants are bounded to the caller''s effective permissions (except platform operators).';
