-- ---------------------------------------------------------------------------
-- Invitation-Accept Flow Migration
-- Adds membership_invitations, tenant_link_invitations tables,
-- link_status on tenants, converts memberships to 'invited' by default,
-- and creates accept RPCs for both membership and seller-link invitations.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. membership_invitations — one-time tokens for user membership acceptance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id   UUID NOT NULL REFERENCES public.tenant_memberships(id) ON DELETE CASCADE,
    token           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    invited_by_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_invitations_membership
    ON public.membership_invitations(membership_id);
CREATE INDEX IF NOT EXISTS idx_membership_invitations_token
    ON public.membership_invitations(token);

-- RLS: invitee + inviter + super admin can read
ALTER TABLE public.membership_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_invitations_select ON public.membership_invitations
    FOR SELECT USING (
        -- The invitee (user matching the membership)
        auth.uid() IN (
            SELECT tm.user_id FROM public.tenant_memberships tm
            WHERE tm.id = membership_id
        )
        -- Or the actor who sent the invite
        OR auth.uid() = invited_by_id
        -- Or a super admin
        OR public.user_is_platform_super_admin(auth.uid())
    );

-- Only server-side (SECURITY DEFINER functions) write to this table → no insert/update policies needed for `authenticated`.

-- ---------------------------------------------------------------------------
-- 2. tenant_link_invitations — pending agency↔seller link requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_link_invitations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    seller_tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    token               UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    invited_by_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_link_invitations_unique UNIQUE (agency_tenant_id, seller_tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_link_invitations_seller
    ON public.tenant_link_invitations(seller_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_link_invitations_agency
    ON public.tenant_link_invitations(agency_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_link_invitations_token
    ON public.tenant_link_invitations(token);

ALTER TABLE public.tenant_link_invitations ENABLE ROW LEVEL SECURITY;

-- Seller Admins can see link invitations for their seller tenant
-- Agency Admins can see link invitations for their agency tenant
-- Super Admins can see all
CREATE POLICY tenant_link_invitations_select ON public.tenant_link_invitations
    FOR SELECT USING (
        public.user_is_agency_admin(agency_tenant_id, auth.uid())
        OR public.user_is_seller_admin(seller_tenant_id, auth.uid())
        OR public.user_is_platform_super_admin(auth.uid())
    );

-- ---------------------------------------------------------------------------
-- 3. Add link_status to tenants (for pending seller→agency links)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'link_status'
    ) THEN
        ALTER TABLE public.tenants
            ADD COLUMN link_status TEXT NOT NULL DEFAULT 'active'
            CHECK (link_status IN ('pending', 'active'));

        -- Backfill: sellers already linked to an agency are 'active'; unlinked sellers also 'active'
        -- (unlinked sellers are independent, not "pending" — pending only applies when an
        -- invitation has been sent and not yet accepted).
        UPDATE public.tenants SET link_status = 'active';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Change tenant_memberships default status to 'invited'
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_memberships
    ALTER COLUMN status SET DEFAULT 'invited';

-- Extend allowed values to include 'pending' synonym and 'declined'
-- (keep existing check constraint compatible)
ALTER TABLE public.tenant_memberships
    DROP CONSTRAINT IF EXISTS tenant_memberships_status_check;
ALTER TABLE public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_status_check
    CHECK (status IN ('active', 'invited', 'deactivated', 'declined'));

-- ---------------------------------------------------------------------------
-- 5. RPC: create_membership_invitation
-- Called by SECURITY DEFINER invite logic (and the server route) to insert the
-- invitation row and return the token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_membership_invitation(
    p_membership_id UUID,
    p_invited_by_id UUID
)
RETURNS UUID    -- returns the token
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
BEGIN
    -- Expire any existing un-accepted invites for this membership
    DELETE FROM public.membership_invitations
    WHERE membership_id = p_membership_id
      AND accepted_at IS NULL;

    INSERT INTO public.membership_invitations (membership_id, invited_by_id)
    VALUES (p_membership_id, p_invited_by_id)
    RETURNING token INTO v_token;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_membership_invitation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_membership_invitation(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC: accept_tenant_membership_invitation(token)
-- Called by the invitee (logged-in user) via the frontend accept page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_tenant_membership_invitation(
    p_token UUID
)
RETURNS JSONB   -- { "tenantId": "...", "tenantName": "...", "roleName": "..." }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
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

REVOKE ALL ON FUNCTION public.accept_tenant_membership_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_tenant_membership_invitation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC: decline_tenant_membership_invitation(token)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_tenant_membership_invitation(
    p_token UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := auth.uid();
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

REVOKE ALL ON FUNCTION public.decline_tenant_membership_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_tenant_membership_invitation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Update agency_link_seller_tenant — create a pending invitation instead of
--    directly setting parent_tenant_id. The Seller Admin must accept via token.
-- ---------------------------------------------------------------------------
-- Drop the old void-returning function first — return type changed to UUID.
DROP FUNCTION IF EXISTS public.agency_link_seller_tenant(uuid, uuid);

CREATE OR REPLACE FUNCTION public.agency_link_seller_tenant(
    p_agency_tenant_id  UUID,
    p_seller_tenant_id  UUID
)
RETURNS UUID    -- returns the invitation token
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    UUID := auth.uid();
    v_token     UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Only Agency Admin or Super Admin can initiate a link
    IF NOT (
        public.user_is_agency_admin(p_agency_tenant_id, v_caller)
        OR public.user_is_platform_super_admin(v_caller)
    ) THEN
        RAISE EXCEPTION 'Only Agency Admin or Super Admin can link sellers';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.tenants WHERE id = p_agency_tenant_id AND type = 'agency'
    ) THEN
        RAISE EXCEPTION 'Invalid agency tenant';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.tenants WHERE id = p_seller_tenant_id AND type = 'seller'
    ) THEN
        RAISE EXCEPTION 'Invalid seller tenant';
    END IF;

    -- Check if already linked to a DIFFERENT agency
    IF EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_seller_tenant_id
          AND parent_tenant_id IS NOT NULL
          AND parent_tenant_id <> p_agency_tenant_id
          AND link_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Seller tenant already linked to another agency';
    END IF;

    -- Upsert the pending invitation (idempotent — resend if expired or still pending)
    INSERT INTO public.tenant_link_invitations (agency_tenant_id, seller_tenant_id, invited_by_id)
    VALUES (p_agency_tenant_id, p_seller_tenant_id, v_caller)
    ON CONFLICT (agency_tenant_id, seller_tenant_id) DO UPDATE
        SET token       = gen_random_uuid(),
            invited_by_id = v_caller,
            expires_at  = NOW() + INTERVAL '7 days',
            accepted_at = NULL
    RETURNING token INTO v_token;

    -- Mark seller as pending link (don't set parent_tenant_id yet — wait for accept)
    UPDATE public.tenants
    SET link_status = 'pending',
        updated_at  = NOW()
    WHERE id = p_seller_tenant_id;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_link_seller_tenant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_link_seller_tenant(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.agency_link_seller_tenant IS
    'Agency Admin / Super Admin: creates a pending link invitation for a seller tenant. '
    'Seller Admin must call accept_seller_link_invitation to finalise the link.';

-- ---------------------------------------------------------------------------
-- 9. RPC: accept_seller_link_invitation(token)
-- Called by the Seller Admin from the accept page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_seller_link_invitation(
    p_token UUID
)
RETURNS JSONB   -- { "agencyName": "...", "sellerName": "..." }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := auth.uid();
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

REVOKE ALL ON FUNCTION public.accept_seller_link_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_seller_link_invitation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. RPC: decline_seller_link_invitation(token)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_seller_link_invitation(
    p_token UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
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

REVOKE ALL ON FUNCTION public.decline_seller_link_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_seller_link_invitation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. RPC: get_pending_seller_link_invitations — for Seller Admin to see
--     incoming agency link requests.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_seller_link_invitations()
RETURNS TABLE (
    invitation_id   UUID,
    token           UUID,
    agency_id       UUID,
    agency_name     TEXT,
    seller_id       UUID,
    seller_name     TEXT,
    invited_by_name TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    RETURN QUERY
    SELECT
        li.id           AS invitation_id,
        li.token        AS token,
        a.id            AS agency_id,
        a.name          AS agency_name,
        s.id            AS seller_id,
        s.name          AS seller_name,
        COALESCE(p.full_name, p.email, 'Unknown') AS invited_by_name,
        li.expires_at,
        li.created_at
    FROM public.tenant_link_invitations li
    JOIN public.tenants a ON a.id = li.agency_tenant_id
    JOIN public.tenants s ON s.id = li.seller_tenant_id
    LEFT JOIN public.profiles p ON p.id = li.invited_by_id
    WHERE li.accepted_at IS NULL
      AND li.expires_at > NOW()
      -- Caller is Seller Admin for that seller OR is Super Admin
      AND (
          public.user_is_seller_admin(li.seller_tenant_id, v_uid)
          OR public.user_is_platform_super_admin(v_uid)
      );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_seller_link_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_seller_link_invitations() TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. RPC: get_pending_membership_invitations — for the invitee to check
--     (thin wrapper so frontend can look up metadata from token alone,
--      without needing the membership to be 'active' for RLS).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_membership_invitation_by_token(
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv       RECORD;
    v_membership RECORD;
    v_tenant    RECORD;
    v_role      RECORD;
    v_inviter   RECORD;
BEGIN
    SELECT * INTO v_inv
    FROM public.membership_invitations
    WHERE token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found';
    END IF;

    SELECT * INTO v_membership FROM public.tenant_memberships WHERE id = v_inv.membership_id;
    SELECT * INTO v_tenant     FROM public.tenants             WHERE id = v_membership.tenant_id;
    SELECT * INTO v_role       FROM public.roles               WHERE id = v_membership.role_id;
    SELECT COALESCE(full_name, email, 'Someone') AS name
    INTO v_inviter
    FROM public.profiles WHERE id = v_inv.invited_by_id;

    RETURN jsonb_build_object(
        'tenantId',    v_tenant.id,
        'tenantName',  v_tenant.name,
        'tenantType',  v_tenant.type,
        'roleName',    v_role.name,
        'invitedBy',   v_inviter.name,
        'expiresAt',   v_inv.expires_at,
        'alreadyAccepted', (v_inv.accepted_at IS NOT NULL),
        'expired',     (v_inv.expires_at < NOW())
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_membership_invitation_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_membership_invitation_by_token(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. RPC: get_seller_link_invitation_by_token — same for seller links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_seller_link_invitation_by_token(
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv     RECORD;
    v_agency  RECORD;
    v_seller  RECORD;
    v_inviter RECORD;
BEGIN
    SELECT * INTO v_inv
    FROM public.tenant_link_invitations
    WHERE token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found';
    END IF;

    SELECT name INTO v_agency FROM public.tenants WHERE id = v_inv.agency_tenant_id;
    SELECT name INTO v_seller FROM public.tenants WHERE id = v_inv.seller_tenant_id;
    SELECT COALESCE(full_name, email, 'Someone') AS name
    INTO v_inviter
    FROM public.profiles WHERE id = v_inv.invited_by_id;

    RETURN jsonb_build_object(
        'agencyId',    v_inv.agency_tenant_id,
        'agencyName',  v_agency.name,
        'sellerId',    v_inv.seller_tenant_id,
        'sellerName',  v_seller.name,
        'invitedBy',   v_inviter.name,
        'expiresAt',   v_inv.expires_at,
        'alreadyAccepted', (v_inv.accepted_at IS NOT NULL),
        'expired',     (v_inv.expires_at < NOW())
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_link_invitation_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_link_invitation_by_token(UUID) TO anon, authenticated;
