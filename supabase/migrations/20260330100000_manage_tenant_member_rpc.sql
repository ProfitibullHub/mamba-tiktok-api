-- ---------------------------------------------------------------------------
-- Team Member Management RPCs
-- Scoped: Agency Admin can only manage their own agency's members.
-- Seller Admin can only manage their own seller tenant's members.
-- Neither can affect platform-level users or Super Admins.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. manage_tenant_member
-- Unified RPC: suspend, reactivate, or remove a member from a tenant.
-- Caller must be an admin of that specific tenant (Agency Admin or Seller Admin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_tenant_member(
    p_tenant_id     UUID,
    p_target_user   UUID,
    p_action        TEXT  -- 'suspend' | 'reactivate' | 'remove'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    UUID := auth.uid();
    v_is_admin  BOOLEAN := FALSE;
    v_membership RECORD;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_action NOT IN ('suspend', 'reactivate', 'remove') THEN
        RAISE EXCEPTION 'Invalid action: must be suspend, reactivate, or remove';
    END IF;

    -- Caller must be admin of this specific tenant (scoped check)
    IF public.user_is_agency_admin(p_tenant_id, v_caller)
       OR public.user_is_seller_admin(p_tenant_id, v_caller)
       OR public.user_is_platform_super_admin(v_caller) THEN
        v_is_admin := TRUE;
    END IF;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Only an admin of this tenant can manage its members';
    END IF;

    -- Cannot self-manage
    IF p_target_user = v_caller THEN
        RAISE EXCEPTION 'You cannot manage your own membership';
    END IF;

    -- Fetch the membership for this tenant
    SELECT * INTO v_membership
    FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
      AND user_id = p_target_user;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found for this user in this tenant';
    END IF;

    -- Prevent actions on Super Admins and platform admins
    IF EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_target_user AND role = 'admin'
    ) OR public.user_is_platform_super_admin(p_target_user) THEN
        RAISE EXCEPTION 'Cannot manage a platform admin or Super Admin via this function';
    END IF;

    IF p_action = 'suspend' THEN
        UPDATE public.tenant_memberships
        SET status = 'deactivated', updated_at = NOW()
        WHERE id = v_membership.id;

    ELSIF p_action = 'reactivate' THEN
        UPDATE public.tenant_memberships
        SET status = 'active', updated_at = NOW()
        WHERE id = v_membership.id;

    ELSIF p_action = 'remove' THEN
        DELETE FROM public.tenant_memberships WHERE id = v_membership.id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_tenant_member(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_tenant_member(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.manage_tenant_member IS
    'Agency Admin / Seller Admin: suspend, reactivate, or remove a member strictly within their own tenant. Cannot touch Super Admins or platform admins.';
