-- Custom roles: honor agency.sellers.link for link/unlink flows, and treat financials.view
-- like the granular COGS/margin/custom permissions + API view_pnl checks.

-- Caller-scoped permissions (safe to expose to authenticated clients)
CREATE OR REPLACE FUNCTION public.get_my_effective_permissions_on_tenant(p_tenant_id uuid)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.action
    FROM public.get_user_effective_permissions_on_tenant(auth.uid(), p_tenant_id) AS m(action);
$$;

REVOKE ALL ON FUNCTION public.get_my_effective_permissions_on_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions_on_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions_on_tenant(uuid) TO service_role;

COMMENT ON FUNCTION public.get_my_effective_permissions_on_tenant(uuid) IS
    'Current session: effective permission actions on tenant_id. Used by Agency Console UI.';

-- Financial field access: financials.view implies full COGS/margin/custom visibility before seller restrictions apply
CREATE OR REPLACE FUNCTION public.get_financial_field_access(
    p_user_id uuid,
    p_seller_tenant_id uuid
)
RETURNS TABLE (
    can_view_cogs boolean,
    can_view_margin boolean,
    can_view_custom_line_items boolean,
    restricted_fields text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ctx record;
    v_perm_view_cogs boolean := false;
    v_perm_view_margin boolean := false;
    v_perm_view_custom boolean := false;
    v_financials_view boolean := false;
    v_role_names text[] := ARRAY[]::text[];
    v_principal text := null;
    v_targeted boolean := false;
    v_restrict_cogs boolean := false;
    v_restrict_margin boolean := false;
    v_restrict_custom boolean := false;
    v_restricted_fields text[] := ARRAY[]::text[];
    v_allowed_fields text[] := ARRAY[
        'cogs','margin','custom_line_items','gross_profit','net_profit',
        'platform_fees','affiliate_commissions','shipping_costs','agency_fees','ad_spend'
    ]::text[];
    v_rule record;
BEGIN
    SELECT * INTO v_ctx
    FROM public.get_request_tenant_context(p_user_id)
    LIMIT 1;

    IF v_ctx.user_id IS NULL THEN
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[];
        RETURN;
    END IF;

    IF v_ctx.tenant_type = 'seller' AND v_ctx.tenant_id = p_seller_tenant_id THEN
        v_perm_view_cogs := true;
        v_perm_view_margin := true;
        v_perm_view_custom := true;
    ELSIF v_ctx.tenant_type = 'agency' AND NOT (p_seller_tenant_id = ANY(v_ctx.assigned_seller_ids)) THEN
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[];
        RETURN;
    ELSIF public.user_is_platform_super_admin(p_user_id)
       OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id AND pr.role = 'admin') THEN
        v_perm_view_cogs := true;
        v_perm_view_margin := true;
        v_perm_view_custom := true;
    ELSE
        v_financials_view := EXISTS (
            SELECT 1
            FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p
            WHERE p.action = 'financials.view'
        );
        v_perm_view_cogs := v_financials_view OR EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_cogs'
        );
        v_perm_view_margin := v_financials_view OR EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_margin'
        );
        v_perm_view_custom := v_financials_view OR EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_custom_line_items'
        );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT r.name), ARRAY[]::text[])
    INTO v_role_names
    FROM public.tenant_memberships tm
    LEFT JOIN public.membership_roles mr ON mr.membership_id = tm.id AND mr.revoked_at IS NULL
    LEFT JOIN public.roles r ON r.id = mr.role_id AND r.deleted_at IS NULL
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = v_ctx.tenant_id
      AND tm.status = 'active';

    IF cardinality(v_role_names) = 0 THEN
        SELECT COALESCE(array_agg(DISTINCT r.name), ARRAY[]::text[])
        INTO v_role_names
        FROM public.tenant_memberships tm
        JOIN public.roles r ON r.id = tm.role_id AND r.deleted_at IS NULL
        WHERE tm.user_id = p_user_id
          AND tm.tenant_id = v_ctx.tenant_id
          AND tm.status = 'active';
    END IF;

    IF v_ctx.tenant_type = 'agency' THEN
        IF 'Agency Admin' = ANY(v_role_names) THEN
            v_principal := 'agency_admin';
        ELSIF 'Account Manager' = ANY(v_role_names) THEN
            v_principal := 'account_manager';
        ELSIF 'Account Coordinator' = ANY(v_role_names) THEN
            v_principal := 'account_coordinator';
        END IF;
    ELSIF v_ctx.tenant_type = 'seller' THEN
        IF 'Seller Admin' = ANY(v_role_names) THEN
            v_principal := 'seller_admin';
        ELSIF 'Seller User' = ANY(v_role_names) THEN
            v_principal := 'seller_user';
        END IF;
    END IF;

    FOR v_rule IN
        SELECT *
        FROM public.seller_financial_visibility_rules sfr
        WHERE sfr.seller_tenant_id = p_seller_tenant_id
          AND (sfr.agency_tenant_id IS NULL OR sfr.agency_tenant_id = v_ctx.tenant_id)
    LOOP
        v_targeted := false;
        IF v_ctx.tenant_type = 'agency' THEN
            v_targeted := (
                'all_agency' = ANY(COALESCE(v_rule.restricted_principals, ARRAY[]::text[]))
                OR (v_principal IS NOT NULL AND v_principal = ANY(COALESCE(v_rule.restricted_principals, ARRAY[]::text[])))
            );
        ELSIF v_ctx.tenant_type = 'seller' THEN
            v_targeted := (
                'all_seller' = ANY(COALESCE(v_rule.restricted_principals, ARRAY[]::text[]))
                OR (v_principal IS NOT NULL AND v_principal = ANY(COALESCE(v_rule.restricted_principals, ARRAY[]::text[])))
            );
        END IF;

        IF v_targeted THEN
            v_restrict_cogs := v_restrict_cogs OR COALESCE(v_rule.restrict_cogs, false);
            v_restrict_margin := v_restrict_margin OR COALESCE(v_rule.restrict_margin, false);
            v_restrict_custom := v_restrict_custom OR COALESCE(v_rule.restrict_custom_line_items, false);
            v_restricted_fields := (
                SELECT ARRAY(
                    SELECT DISTINCT lower(x)
                    FROM unnest(v_restricted_fields || COALESCE(v_rule.restricted_fields, ARRAY[]::text[])) AS t(x)
                    WHERE lower(x) = ANY(v_allowed_fields)
                )
            );
        END IF;
    END LOOP;

    v_perm_view_cogs := v_perm_view_cogs AND NOT v_restrict_cogs;
    v_perm_view_margin := v_perm_view_margin AND NOT v_restrict_margin;
    v_perm_view_custom := v_perm_view_custom AND NOT v_restrict_custom;

    RETURN QUERY
    SELECT
        v_perm_view_cogs,
        v_perm_view_margin,
        v_perm_view_custom,
        COALESCE(v_restricted_fields, ARRAY[]::text[]);
END;
$$;

-- Direct RPC fallback from Agency Console: allow delegated link permission
CREATE OR REPLACE FUNCTION public.agency_link_seller_tenant(
    p_agency_tenant_id UUID,
    p_seller_tenant_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_token UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT (
        public.user_is_agency_admin(p_agency_tenant_id, v_caller)
        OR public.user_is_platform_super_admin(v_caller)
        OR EXISTS (
            SELECT 1
            FROM public.get_user_effective_permissions_on_tenant(v_caller, p_agency_tenant_id) p
            WHERE p.action = 'agency.sellers.link'
        )
    ) THEN
        RAISE EXCEPTION 'Not allowed to link sellers for this agency';
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

    IF EXISTS (
        SELECT 1 FROM public.tenants
        WHERE id = p_seller_tenant_id
          AND parent_tenant_id IS NOT NULL
          AND parent_tenant_id <> p_agency_tenant_id
          AND link_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Seller tenant already linked to another agency';
    END IF;

    INSERT INTO public.tenant_link_invitations (agency_tenant_id, seller_tenant_id, invited_by_id)
    VALUES (p_agency_tenant_id, p_seller_tenant_id, v_caller)
    ON CONFLICT (agency_tenant_id, seller_tenant_id) DO UPDATE
        SET token         = gen_random_uuid(),
            invited_by_id = v_caller,
            expires_at    = NOW() + INTERVAL '7 days',
            accepted_at   = NULL
    RETURNING token INTO v_token;

    UPDATE public.tenants
    SET link_status = 'pending',
        updated_at  = NOW()
    WHERE id = p_seller_tenant_id;

    RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.agency_link_seller_tenant(UUID, UUID) IS
    'Agency Admin, delegated agency.sellers.link, or Super Admin: pending seller link invitation.';

-- Unlink from agency side: same delegation
CREATE OR REPLACE FUNCTION public.revoke_seller_agency_link(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid,
    p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := COALESCE(p_actor_id, auth.uid());
    v_account_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT (
        public.user_is_agency_admin(p_agency_tenant_id, v_caller)
        OR public.user_is_platform_super_admin(v_caller)
        OR EXISTS (
            SELECT 1
            FROM public.get_user_effective_permissions_on_tenant(v_caller, p_agency_tenant_id) p
            WHERE p.action = 'agency.sellers.link'
        )
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.tenant_memberships tm
                ON tm.user_id = p.id
               AND tm.tenant_id = p.tenant_id
               AND tm.status = 'active'
            JOIN public.roles r ON r.id = tm.role_id
            WHERE p.id = v_caller
              AND p.tenant_id = p_seller_tenant_id
              AND r.name = 'Seller Admin'
        )
    ) THEN
        RAISE EXCEPTION 'Not allowed to unlink this seller for this agency';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE id = p_seller_tenant_id
          AND type = 'seller'
          AND parent_tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    UPDATE public.tenants
    SET parent_tenant_id = NULL,
        link_status = 'active',
        updated_at = NOW()
    WHERE id = p_seller_tenant_id;

    DELETE FROM public.user_seller_assignments
    WHERE seller_tenant_id = p_seller_tenant_id
      AND agency_tenant_id = p_agency_tenant_id;

    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE tenant_id = p_seller_tenant_id
    LIMIT 1;

    IF v_account_id IS NOT NULL THEN
        UPDATE public.dashboard_email_schedules
        SET enabled = false,
            updated_at = NOW()
        WHERE account_id = v_account_id
          AND created_by IN (
              SELECT id
              FROM public.profiles
              WHERE tenant_id = p_agency_tenant_id
          );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_link_seller_tenant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_link_seller_tenant(UUID, UUID) TO authenticated;
