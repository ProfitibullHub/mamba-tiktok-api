-- Repair: if 20260330240000 / 20260330250000 were skipped on a remote project, PostgREST returns 404
-- for get_my_custom_role_permission_ceiling. This file re-applies the ceiling stack + grants (idempotent).
-- Also adds get_tenant_directory_for_admin as an alias for clients that expect a get_* name.
--
-- get_user_effective_permissions (agency-scoped) is required by get_user_custom_role_permission_ceiling_for_tenant
-- for Account Managers; it originally lived in 20260328300000_am_custom_role_creation.sql — recreate if missing.

-- ==== AM helper (from 20260328300000) ========================================
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
    SELECT DISTINCT perm.action
    FROM tenant_memberships tm
    JOIN roles r ON r.id = tm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions perm ON perm.id = rp.permission_id
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_agency_tenant_id
      AND tm.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.get_user_effective_permissions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_effective_permissions(uuid, uuid) TO authenticated;

-- ==== Ceiling stack (same as 20260330240000) =================================
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

-- Alias (same as 20260330250000)
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

-- Directory RPC alias (some stacks call get_tenant_directory_for_admin)
CREATE OR REPLACE FUNCTION public.get_tenant_directory_for_admin(p_tenant_id uuid)
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.tenant_directory_for_admin(p_tenant_id);
$$;

REVOKE ALL ON FUNCTION public.get_tenant_directory_for_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_directory_for_admin(uuid) TO authenticated;
