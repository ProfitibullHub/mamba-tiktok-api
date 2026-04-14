-- Allow Account Managers to assign sellers to Account Coordinators,
-- scoped to only sellers already in the AM's own user_seller_assignments.

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
    v_caller_is_aa boolean;
    v_caller_is_am boolean;
    v_staff_role_name text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Check caller's role on this agency
    v_caller_is_aa := user_is_agency_admin(p_agency_tenant_id, v_caller);

    SELECT EXISTS (
        SELECT 1 FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = p_agency_tenant_id
          AND tm.user_id = v_caller
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
          AND r.name = 'Account Manager'
    ) INTO v_caller_is_am;

    IF NOT v_caller_is_aa AND NOT v_caller_is_am THEN
        RAISE EXCEPTION 'Only Agency Admin or Account Manager can assign sellers to staff';
    END IF;

    -- Seller must be linked to this agency
    IF NOT EXISTS (
        SELECT 1 FROM tenants s
        WHERE s.id = p_seller_tenant_id
          AND s.type = 'seller'
          AND s.parent_tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    -- If caller is AM (not AA), enforce additional scope constraints
    IF v_caller_is_am AND NOT v_caller_is_aa THEN
        -- AM can only assign sellers within their own assigned scope
        IF NOT EXISTS (
            SELECT 1 FROM user_seller_assignments usa
            JOIN tenant_memberships tm ON tm.id = usa.tenant_membership_id
            WHERE tm.user_id = v_caller
              AND tm.tenant_id = p_agency_tenant_id
              AND tm.status = 'active'
              AND usa.seller_tenant_id = p_seller_tenant_id
        ) THEN
            RAISE EXCEPTION 'Account Managers can only assign sellers from their own assigned scope';
        END IF;

        -- AM can only grant access to Account Coordinators, not other AMs
        SELECT r.name INTO v_staff_role_name
        FROM tenant_memberships tm
        JOIN roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = p_agency_tenant_id
          AND tm.user_id = p_staff_user_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
          AND r.name IN ('Account Manager', 'Account Coordinator', 'Agency Admin')
        LIMIT 1;

        IF v_staff_role_name IS NULL THEN
            RAISE EXCEPTION 'Staff user is not an active agency member';
        END IF;

        IF v_staff_role_name <> 'Account Coordinator' THEN
            RAISE EXCEPTION 'Account Managers can only assign sellers to Account Coordinators, not to %s', v_staff_role_name;
        END IF;
    END IF;

    -- Resolve the staff membership ID (must be AM or AC)
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

COMMENT ON FUNCTION public.agency_grant_staff_seller_access IS
    'Agency Admin: assign any linked seller to AM or AC. Account Manager: assign only sellers within their own scope to Account Coordinators.';
