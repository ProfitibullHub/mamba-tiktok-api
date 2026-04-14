-- Server (service role): verify tenant admin and assign roles without auth.uid() (invite / API flows).

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
            AND public.user_is_seller_admin(p_tenant_id, p_actor_id)
        )
    );
$$;

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

COMMENT ON FUNCTION public.user_can_manage_tenant_members IS 'Service role / Node: whether p_actor_id may manage memberships for p_tenant_id.';
COMMENT ON FUNCTION public.tenant_set_member_role_for_actor IS 'Service role / Node: set member role with explicit actor (after JWT verification).';
