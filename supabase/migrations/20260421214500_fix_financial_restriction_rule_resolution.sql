-- Fix financial restriction resolution so all selected restricted_fields are applied
-- even when legacy agency-specific rows coexist with seller-level rows.

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
    v_role_names text[] := ARRAY[]::text[];
    v_principal text := null;
    v_targeted boolean := false;
    v_restrict_cogs boolean := false;
    v_restrict_margin boolean := false;
    v_restrict_custom boolean := false;
    v_restricted_fields text[] := ARRAY[]::text[];
    v_rule record;
BEGIN
    SELECT *
    INTO v_ctx
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
    ELSE
        v_perm_view_cogs := EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_cogs'
        );
        v_perm_view_margin := EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_margin'
        );
        v_perm_view_custom := EXISTS (
            SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_custom_line_items'
        );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT r.name), ARRAY[]::text[])
    INTO v_role_names
    FROM public.tenant_memberships tm
    LEFT JOIN public.membership_roles mr
      ON mr.membership_id = tm.id
     AND mr.revoked_at IS NULL
    LEFT JOIN public.roles r
      ON r.id = mr.role_id
     AND r.deleted_at IS NULL
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = v_ctx.tenant_id
      AND tm.status = 'active';

    IF cardinality(v_role_names) = 0 THEN
        SELECT COALESCE(array_agg(DISTINCT r.name), ARRAY[]::text[])
        INTO v_role_names
        FROM public.tenant_memberships tm
        JOIN public.roles r
          ON r.id = tm.role_id
         AND r.deleted_at IS NULL
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
                    SELECT DISTINCT x
                    FROM unnest(v_restricted_fields || COALESCE(v_rule.restricted_fields, ARRAY[]::text[])) AS t(x)
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
