-- 1. accept_tenant_membership_invitation
DROP FUNCTION IF EXISTS public.accept_tenant_membership_invitation(UUID);

CREATE OR REPLACE FUNCTION public.accept_tenant_membership_invitation(
    p_actor_id UUID,
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid           UUID := p_actor_id;
    v_inv           RECORD;
    v_membership    RECORD;
    v_tenant        RECORD;
    v_role          RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT mi.*, mi.id AS inv_id
    INTO v_inv
    FROM public.membership_invitations mi
    WHERE mi.token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found or already used';
    END IF;

    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation already accepted';
    END IF;

    IF v_inv.expires_at < NOW() THEN
        RAISE EXCEPTION 'Invitation has expired';
    END IF;

    SELECT * INTO v_membership
    FROM public.tenant_memberships
    WHERE id = v_inv.membership_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found';
    END IF;

    -- Ensure the caller is the intended invitee
    IF v_membership.user_id <> v_uid THEN
        RAISE EXCEPTION 'This invitation was not sent to your account';
    END IF;

    -- Activate membership
    UPDATE public.tenant_memberships
    SET status = 'active', updated_at = NOW()
    WHERE id = v_membership.id;

    -- Mark invitation as accepted
    UPDATE public.membership_invitations
    SET accepted_at = NOW()
    WHERE id = v_inv.inv_id;

    -- Collect return data for UX
    SELECT * INTO v_tenant FROM public.tenants WHERE id = v_membership.tenant_id;
    SELECT * INTO v_role   FROM public.roles   WHERE id = v_membership.role_id;

    RETURN jsonb_build_object(
        'tenantId',   v_membership.tenant_id,
        'tenantName', v_tenant.name,
        'roleName',   v_role.name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_tenant_membership_invitation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_tenant_membership_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_tenant_membership_invitation(UUID, UUID) TO service_role;


-- 2. decline_tenant_membership_invitation
DROP FUNCTION IF EXISTS public.decline_tenant_membership_invitation(UUID);

CREATE OR REPLACE FUNCTION public.decline_tenant_membership_invitation(
    p_actor_id UUID,
    p_token UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := p_actor_id;
    v_inv       RECORD;
    v_membership RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_inv
    FROM public.membership_invitations mi
    WHERE mi.token = p_token;

    IF NOT FOUND OR v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation not found or already processed';
    END IF;

    SELECT * INTO v_membership
    FROM public.tenant_memberships
    WHERE id = v_inv.membership_id;

    IF v_membership.user_id <> v_uid THEN
        RAISE EXCEPTION 'This invitation was not sent to your account';
    END IF;

    UPDATE public.tenant_memberships
    SET status = 'declined', updated_at = NOW()
    WHERE id = v_membership.id;

    DELETE FROM public.membership_invitations WHERE token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION public.decline_tenant_membership_invitation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_tenant_membership_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_tenant_membership_invitation(UUID, UUID) TO service_role;


-- 3. accept_seller_link_invitation
DROP FUNCTION IF EXISTS public.accept_seller_link_invitation(UUID);

CREATE OR REPLACE FUNCTION public.accept_seller_link_invitation(
    p_actor_id UUID,
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := p_actor_id;
    v_inv       RECORD;
    v_agency    RECORD;
    v_seller    RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT * INTO v_inv
    FROM public.tenant_link_invitations
    WHERE token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found';
    END IF;

    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation already accepted';
    END IF;

    IF v_inv.expires_at < NOW() THEN
        RAISE EXCEPTION 'Invitation has expired';
    END IF;

    -- Only Seller Admin of THIS seller can accept
    IF NOT (
        public.user_is_seller_admin(v_inv.seller_tenant_id, v_uid)
        OR public.user_is_platform_super_admin(v_uid)
    ) THEN
        RAISE EXCEPTION 'Only the Seller Admin of this shop can accept the link invitation';
    END IF;

    -- Finalise the link
    UPDATE public.tenants
    SET parent_tenant_id = v_inv.agency_tenant_id,
        link_status      = 'active',
        updated_at       = NOW()
    WHERE id = v_inv.seller_tenant_id;

    -- Mark invitation accepted
    UPDATE public.tenant_link_invitations
    SET accepted_at = NOW()
    WHERE id = v_inv.id;

    SELECT name INTO v_agency FROM public.tenants WHERE id = v_inv.agency_tenant_id;
    SELECT name INTO v_seller FROM public.tenants WHERE id = v_inv.seller_tenant_id;

    RETURN jsonb_build_object(
        'agencyName', v_agency.name,
        'sellerName', v_seller.name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_seller_link_invitation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_seller_link_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_seller_link_invitation(UUID, UUID) TO service_role;


-- 4. decline_seller_link_invitation
DROP FUNCTION IF EXISTS public.decline_seller_link_invitation(UUID);

CREATE OR REPLACE FUNCTION public.decline_seller_link_invitation(
    p_actor_id UUID,
    p_token UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := p_actor_id;
    v_inv RECORD;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_inv FROM public.tenant_link_invitations WHERE token = p_token;

    IF NOT FOUND OR v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation not found or already processed';
    END IF;

    IF NOT (
        public.user_is_seller_admin(v_inv.seller_tenant_id, v_uid)
        OR public.user_is_platform_super_admin(v_uid)
    ) THEN
        RAISE EXCEPTION 'Only the Seller Admin can decline this invitation';
    END IF;

    -- Reset seller link_status back to active (unlinked state)
    UPDATE public.tenants
    SET link_status = 'active', updated_at = NOW()
    WHERE id = v_inv.seller_tenant_id;

    DELETE FROM public.tenant_link_invitations WHERE id = v_inv.id;
END;
$$;

REVOKE ALL ON FUNCTION public.decline_seller_link_invitation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_seller_link_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_seller_link_invitation(UUID, UUID) TO service_role;
