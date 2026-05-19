-- PRD alignment: immutable value revisions (supersede + split), soft-only line removal,
-- per-line custom P&L restrictions, overlap checks ignore superseded rows.

-- 1) Value supersession (old row kept for audit; excluded from active reporting via replaced_by)
ALTER TABLE public.pl_custom_line_item_values
    ADD COLUMN IF NOT EXISTS replaced_by uuid NULL REFERENCES public.pl_custom_line_item_values (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pl_custom_line_item_values_replaced_by
    ON public.pl_custom_line_item_values (replaced_by)
    WHERE replaced_by IS NOT NULL;

COMMENT ON COLUMN public.pl_custom_line_item_values.replaced_by IS
    'When set, this value row is superseded for reporting; the replacement row is referenced. Historical row is retained.';

-- 2) Per-line custom P&L restriction list (seller rule row; empty = no extra line-level hides)
ALTER TABLE public.seller_financial_visibility_rules
    ADD COLUMN IF NOT EXISTS restricted_custom_pl_line_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.seller_financial_visibility_rules.restricted_custom_pl_line_item_ids IS
    'Agency principals targeted by this rule cannot see these custom P&L line item ids (when they may view custom lines overall).';

-- 3) Overlap guard: ignore superseded rows
CREATE OR REPLACE FUNCTION public.pl_custom_line_item_values_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_max constant date := '9999-12-31'::date;
    v_end_new date;
    v_end_o date;
BEGIN
    v_end_new := COALESCE(NEW.end_date, v_max);
    IF NEW.start_date > v_end_new THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.start_date IS NOT DISTINCT FROM NEW.start_date
       AND OLD.end_date IS NOT DISTINCT FROM NEW.end_date
       AND OLD.line_item_id IS NOT DISTINCT FROM NEW.line_item_id
       AND OLD.amount IS NOT DISTINCT FROM NEW.amount
       AND OLD.replaced_by IS NOT DISTINCT FROM NEW.replaced_by THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.pl_custom_line_item_values o
        WHERE o.line_item_id = NEW.line_item_id
          AND o.replaced_by IS NULL
          AND o.id IS DISTINCT FROM NEW.id
          AND NEW.start_date <= COALESCE(o.end_date, v_max)
          AND o.start_date <= v_end_new
    ) THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_overlap'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- 4) Append helper: only close active (non-superseded) open-ended segments
CREATE OR REPLACE FUNCTION public.append_pl_custom_line_item_value(
    p_line_item_id uuid,
    p_amount numeric,
    p_start_date date,
    p_end_date date,
    p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_id uuid;
    v_lock int;
BEGIN
    IF p_amount IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_missing_fields' USING ERRCODE = '23502';
    END IF;

    IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    SELECT 1 INTO v_lock
    FROM public.pl_custom_line_items i
    WHERE i.id = p_line_item_id
      AND i.is_active = true
    FOR UPDATE;

    IF v_lock IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_not_found_or_inactive' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.pl_custom_line_item_values v
    SET end_date = p_start_date - 1
    WHERE v.line_item_id = p_line_item_id
      AND v.end_date IS NULL
      AND v.start_date < p_start_date
      AND v.replaced_by IS NULL;

    INSERT INTO public.pl_custom_line_item_values (line_item_id, amount, start_date, end_date, created_by)
    VALUES (p_line_item_id, p_amount, p_start_date, p_end_date, p_actor)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_pl_custom_line_item_value(uuid, numeric, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_pl_custom_line_item_value(uuid, numeric, date, date, uuid) TO service_role;

-- 5) Split: shorten prior segment, insert new (no overlap; PRD versioning)
CREATE OR REPLACE FUNCTION public.split_pl_custom_line_item_value(
    p_old_value_id uuid,
    p_effective_from date,
    p_new_amount numeric,
    p_new_end date,
    p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old record;
    v_new_end date;
    v_max constant date := '9999-12-31'::date;
    v_new_id uuid;
BEGIN
    IF p_new_amount IS NULL OR p_effective_from IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_missing_fields' USING ERRCODE = '23502';
    END IF;

    SELECT v.* INTO v_old
    FROM public.pl_custom_line_item_values v
    WHERE v.id = p_old_value_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'pl_custom_value_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_old.replaced_by IS NOT NULL THEN
        RAISE EXCEPTION 'pl_custom_value_superseded' USING ERRCODE = '23503';
    END IF;

    IF p_effective_from <= v_old.start_date THEN
        RAISE EXCEPTION 'pl_custom_split_effective_from' USING ERRCODE = '23514';
    END IF;

    v_new_end := COALESCE(p_new_end, v_old.end_date);
    IF v_old.end_date IS NOT NULL AND p_effective_from > v_old.end_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    IF v_new_end IS NOT NULL AND v_new_end < p_effective_from THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    UPDATE public.pl_custom_line_item_values
    SET end_date = p_effective_from - 1
    WHERE id = p_old_value_id;

    INSERT INTO public.pl_custom_line_item_values (line_item_id, amount, start_date, end_date, created_by)
    VALUES (v_old.line_item_id, p_new_amount, p_effective_from, v_new_end, p_actor)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.split_pl_custom_line_item_value(uuid, date, numeric, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_pl_custom_line_item_value(uuid, date, numeric, date, uuid) TO service_role;

-- 6) Full supersede same calendar identity: new row + mark old replaced (disable overlap insert trigger briefly)
CREATE OR REPLACE FUNCTION public.replace_pl_custom_line_item_value(
    p_old_value_id uuid,
    p_amount numeric,
    p_start_date date,
    p_end_date date,
    p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old record;
    v_new_id uuid;
BEGIN
    IF p_amount IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_missing_fields' USING ERRCODE = '23502';
    END IF;

    IF p_end_date IS NOT NULL AND p_start_date > p_end_date THEN
        RAISE EXCEPTION 'pl_custom_line_item_values_invalid_range' USING ERRCODE = '23514';
    END IF;

    SELECT v.* INTO v_old
    FROM public.pl_custom_line_item_values v
    WHERE v.id = p_old_value_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'pl_custom_value_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_old.replaced_by IS NOT NULL THEN
        RAISE EXCEPTION 'pl_custom_value_superseded' USING ERRCODE = '23503';
    END IF;

    BEGIN
        ALTER TABLE public.pl_custom_line_item_values DISABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;

        INSERT INTO public.pl_custom_line_item_values (line_item_id, amount, start_date, end_date, created_by)
        VALUES (v_old.line_item_id, p_amount, p_start_date, p_end_date, p_actor)
        RETURNING id INTO v_new_id;

        UPDATE public.pl_custom_line_item_values
        SET replaced_by = v_new_id
        WHERE id = p_old_value_id;

        ALTER TABLE public.pl_custom_line_item_values ENABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;
    EXCEPTION
        WHEN OTHERS THEN
            ALTER TABLE public.pl_custom_line_item_values ENABLE TRIGGER trg_pl_custom_line_item_values_overlap_ins;
            RAISE;
    END;

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_pl_custom_line_item_value(uuid, numeric, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_pl_custom_line_item_value(uuid, numeric, date, date, uuid) TO service_role;

-- 7) Financial field access: expose restricted custom line ids (fifth column)
-- OUT-parameter signature changed — must drop before replace (PostgreSQL 42P13).
DROP FUNCTION IF EXISTS public.get_financial_field_access(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_financial_field_access(
    p_user_id uuid,
    p_seller_tenant_id uuid
)
RETURNS TABLE (
    can_view_cogs boolean,
    can_view_margin boolean,
    can_view_custom_line_items boolean,
    restricted_fields text[],
    restricted_custom_pl_line_item_ids uuid[]
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
    v_restrict_custom_line_ids uuid[] := ARRAY[]::uuid[];
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
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[], ARRAY[]::uuid[];
        RETURN;
    END IF;

    IF v_ctx.tenant_type = 'seller' AND v_ctx.tenant_id = p_seller_tenant_id THEN
        v_perm_view_cogs := true;
        v_perm_view_margin := true;
        v_perm_view_custom := true;
    ELSIF v_ctx.tenant_type = 'agency' AND NOT (p_seller_tenant_id = ANY(v_ctx.assigned_seller_ids)) THEN
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[], ARRAY[]::uuid[];
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
        IF public.user_is_agency_admin(v_ctx.tenant_id, p_user_id)
           OR 'Agency Admin' = ANY(v_role_names) THEN
            v_principal := 'agency_admin';
        ELSIF (
            SELECT COALESCE(bool_or(lower(trim(u)) LIKE '%account coordinator%'), false)
            FROM unnest(v_role_names) AS q(u)
        ) OR 'Account Coordinator' = ANY(v_role_names) THEN
            v_principal := 'account_coordinator';
        ELSIF (
            SELECT COALESCE(bool_or(lower(trim(u)) LIKE '%account manager%'), false)
            FROM unnest(v_role_names) AS q(u)
        ) OR 'Account Manager' = ANY(v_role_names) THEN
            v_principal := 'account_manager';
        END IF;

    ELSIF v_ctx.tenant_type = 'seller' THEN
        IF public.user_is_seller_admin(p_seller_tenant_id, p_user_id)
           OR 'Seller Admin' = ANY(v_role_names) THEN
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
            v_restrict_custom_line_ids := (
                SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[])
                FROM unnest(v_restrict_custom_line_ids || COALESCE(v_rule.restricted_custom_pl_line_item_ids, ARRAY[]::uuid[])) AS t(x)
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
        COALESCE(v_restricted_fields, ARRAY[]::text[]),
        COALESCE(v_restrict_custom_line_ids, ARRAY[]::uuid[]);
END;
$$;

COMMENT ON FUNCTION public.get_financial_field_access IS
    'Field-level financial visibility: permissions + seller rules + restricted custom P&L line item ids.';

REVOKE ALL ON FUNCTION public.get_financial_field_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_financial_field_access(uuid, uuid) TO authenticated, service_role;
