-- 1. Update tenant_set_member_role to insert as 'invited' instead of 'active'
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
    v_target_is_admin_or_am boolean;
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

    IF NOT v_is_platform_op THEN
        IF v_tenant_type = 'agency' THEN
            IF NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
                -- If not AA, check if AM
                IF NOT EXISTS (
                    SELECT 1 FROM tenant_memberships tm
                    JOIN roles r2 ON r2.id = tm.role_id
                    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = v_caller AND tm.status = 'active'
                      AND r2.tenant_id IS NULL AND r2.name = 'Account Manager'
                ) THEN
                    RAISE EXCEPTION 'Only Agency Admin or Account Manager can manage this tenant';
                END IF;

                -- Caller is AM
                IF v_role.tenant_id IS NULL AND v_role.name = 'Account Coordinator' THEN
                    -- allowed
                ELSE
                    RAISE EXCEPTION 'Account Managers can only assign the Account Coordinator role';
                END IF;

                -- Ensure target user is not AA or AM
                SELECT EXISTS (
                    SELECT 1 FROM tenant_memberships tm
                    JOIN roles r3 ON r3.id = tm.role_id
                    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_user_id AND tm.status = 'active'
                      AND r3.tenant_id IS NULL AND r3.name IN ('Agency Admin', 'Account Manager')
                ) INTO v_target_is_admin_or_am;

                IF v_target_is_admin_or_am THEN
                    RAISE EXCEPTION 'Account Managers cannot modify Agency Admins or other Account Managers';
                END IF;
            END IF;
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(p_tenant_id, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin or parent Agency Admin can manage this tenant';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_tenant_id, p_user_id, p_role_id, 'invited')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

-- 2. Update tenant_set_member_role_for_actor to insert as 'invited'
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
    v_is_platform_op boolean;
    v_target_is_admin_or_am boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Invalid actor';
    END IF;

    v_is_platform_op := EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND role = 'admin')
                         OR public.user_is_platform_super_admin(v_caller);

    SELECT type INTO v_tenant_type FROM tenants WHERE id = p_tenant_id;
    IF v_tenant_type IS NULL OR v_tenant_type = 'platform' THEN
        RAISE EXCEPTION 'Invalid tenant';
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

    IF NOT v_is_platform_op THEN
        IF v_tenant_type = 'agency' THEN
            IF NOT public.user_is_agency_admin(p_tenant_id, v_caller) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM tenant_memberships tm
                    JOIN roles r2 ON r2.id = tm.role_id
                    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = v_caller AND tm.status = 'active'
                      AND r2.tenant_id IS NULL AND r2.name = 'Account Manager'
                ) THEN
                    RAISE EXCEPTION 'Only Agency Admin or Account Manager can manage this tenant';
                END IF;

                IF v_role.tenant_id IS NULL AND v_role.name = 'Account Coordinator' THEN
                    -- allowed
                ELSE
                    RAISE EXCEPTION 'Account Managers can only assign the Account Coordinator role';
                END IF;

                SELECT EXISTS (
                    SELECT 1 FROM tenant_memberships tm
                    JOIN roles r3 ON r3.id = tm.role_id
                    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_target_user_id AND tm.status = 'active'
                      AND r3.tenant_id IS NULL AND r3.name IN ('Agency Admin', 'Account Manager')
                ) INTO v_target_is_admin_or_am;

                IF v_target_is_admin_or_am THEN
                    RAISE EXCEPTION 'Account Managers cannot modify Agency Admins or other Account Managers';
                END IF;
            END IF;
        END IF;
        IF v_tenant_type = 'seller'
           AND NOT public.user_is_seller_admin(p_tenant_id, v_caller)
           AND NOT public.user_is_agency_admin_of_seller_parent(p_tenant_id, v_caller) THEN
            RAISE EXCEPTION 'Only Seller Admin or parent Agency Admin can manage this tenant';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_tenant_id, p_target_user_id, p_role_id, 'invited')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

-- 3. Update agency_add_staff_membership to insert as 'invited'
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
    v_caller_is_aa boolean;
    v_caller_is_am boolean;
    v_target_is_admin_or_am boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_caller_is_aa := user_is_agency_admin(p_agency_tenant_id, v_caller);

    SELECT EXISTS (
        SELECT 1 FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = p_agency_tenant_id AND tm.user_id = v_caller AND tm.status = 'active'
          AND r.tenant_id IS NULL AND r.name = 'Account Manager'
    ) INTO v_caller_is_am;

    IF NOT v_caller_is_aa AND NOT v_caller_is_am THEN
        RAISE EXCEPTION 'Only Agency Admin or Account Manager can manage staff';
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

    IF v_caller_is_am AND NOT v_caller_is_aa THEN
        IF v_norm <> 'Account Coordinator' THEN
            RAISE EXCEPTION 'Account Managers can only assign the Account Coordinator role';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM tenant_memberships tm
            JOIN roles r3 ON r3.id = tm.role_id
            WHERE tm.tenant_id = p_agency_tenant_id AND tm.user_id = p_user_id AND tm.status = 'active'
              AND r3.tenant_id IS NULL AND r3.name IN ('Agency Admin', 'Account Manager')
        ) INTO v_target_is_admin_or_am;

        IF v_target_is_admin_or_am THEN
            RAISE EXCEPTION 'Account Managers cannot modify Agency Admins or other Account Managers';
        END IF;
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
    VALUES (p_agency_tenant_id, p_user_id, v_role_id, 'invited')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        updated_at = NOW()
    RETURNING id INTO v_membership_id;

    RETURN v_membership_id;
END;
$$;
