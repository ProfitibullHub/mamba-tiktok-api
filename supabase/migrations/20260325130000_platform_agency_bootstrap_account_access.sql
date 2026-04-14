-- SOW alignment: internal operators can bootstrap agencies and link sellers without being Agency Admin.
-- Seller Admins (and operators) can grant user_accounts so team members see shops in the dashboard.

-- ---------------------------------------------------------------------------
-- 1. Platform operator: legacy profiles.role = admin OR Super Admin on platform tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_is_internal_platform_operator(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_uid IS NOT NULL
    AND (
        EXISTS (SELECT 1 FROM profiles WHERE id = p_uid AND role = 'admin')
        OR public.user_is_platform_super_admin(p_uid)
    );
$$;

REVOKE ALL ON FUNCTION public.user_is_internal_platform_operator(uuid) FROM PUBLIC;
-- Not granted to clients; used only from other SECURITY DEFINER functions in this file.

-- ---------------------------------------------------------------------------
-- 2. Super Admin / legacy admin: create agency tenant + make a user Agency Admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_create_agency_with_owner(
    p_owner_user_id uuid,
    p_agency_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_role_id uuid;
    v_agency_id uuid;
    v_label text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.user_is_internal_platform_operator(v_caller) THEN
        RAISE EXCEPTION 'Only internal platform operators can bootstrap agencies';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_owner_user_id) THEN
        RAISE EXCEPTION 'Owner profile not found';
    END IF;

    SELECT id INTO v_role_id
    FROM roles
    WHERE tenant_id IS NULL AND name = 'Agency Admin' AND scope = 'agency'
    LIMIT 1;
    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Agency Admin system role missing';
    END IF;

    v_label := COALESCE(NULLIF(trim(p_agency_name), ''), 'Agency');

    INSERT INTO tenants (name, type, status)
    VALUES (v_label, 'agency', 'active')
    RETURNING id INTO v_agency_id;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (v_agency_id, p_owner_user_id, v_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW();

    RETURN v_agency_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Platform operator: link seller tenant under agency (same rules as agency_link_seller_tenant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_link_seller_to_agency(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_parent uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT public.user_is_internal_platform_operator(v_caller) THEN
        RAISE EXCEPTION 'Only internal platform operators can link sellers this way';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = p_agency_tenant_id AND t.type = 'agency'
    ) THEN
        RAISE EXCEPTION 'Invalid agency tenant';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = p_seller_tenant_id AND t.type = 'seller'
    ) THEN
        RAISE EXCEPTION 'Invalid seller tenant';
    END IF;

    SELECT parent_tenant_id INTO v_parent
    FROM tenants
    WHERE id = p_seller_tenant_id;

    IF v_parent IS NOT NULL AND v_parent <> p_agency_tenant_id THEN
        RAISE EXCEPTION 'Seller tenant already linked to another agency';
    END IF;

    UPDATE tenants
    SET parent_tenant_id = p_agency_tenant_id,
        updated_at = NOW()
    WHERE id = p_seller_tenant_id
      AND type = 'seller';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grant dashboard access: user_accounts (+ Seller User membership if none)
--    Allowed for internal operators OR Seller Admin on that account's seller tenant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_user_access_to_seller_account(
    p_target_user_id uuid,
    p_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tenant uuid;
    v_seller_user_role uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tenant FROM accounts WHERE id = p_account_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Account not found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant AND type = 'seller') THEN
        RAISE EXCEPTION 'Account must belong to a seller tenant';
    END IF;

    IF NOT (
        public.user_is_internal_platform_operator(v_caller)
        OR public.user_is_seller_admin(v_tenant, v_caller)
    ) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id) THEN
        RAISE EXCEPTION 'Target user profile not found';
    END IF;

    INSERT INTO user_accounts (user_id, account_id)
    VALUES (p_target_user_id, p_account_id)
    ON CONFLICT (user_id, account_id) DO NOTHING;

    IF NOT EXISTS (
        SELECT 1 FROM tenant_memberships
        WHERE tenant_id = v_tenant AND user_id = p_target_user_id AND status = 'active'
    ) THEN
        SELECT id INTO v_seller_user_role
        FROM roles
        WHERE tenant_id IS NULL AND name = 'Seller User' AND scope = 'seller'
        LIMIT 1;
        IF v_seller_user_role IS NULL THEN
            RAISE EXCEPTION 'Seller User role missing';
        END IF;
        INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
        VALUES (v_tenant, p_target_user_id, v_seller_user_role, 'active')
        ON CONFLICT (tenant_id, user_id) DO NOTHING;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_create_agency_with_owner(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_link_seller_to_agency(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_access_to_seller_account(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.platform_create_agency_with_owner(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_link_seller_to_agency(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_access_to_seller_account(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.platform_create_agency_with_owner IS
    'Internal operator: create agency tenant and assign Agency Admin to p_owner_user_id.';
COMMENT ON FUNCTION public.platform_link_seller_to_agency IS
    'Internal operator: set seller.parent_tenant_id (hierarchy) without being Agency Admin.';
COMMENT ON FUNCTION public.grant_user_access_to_seller_account IS
    'Seller Admin or internal operator: user_accounts row + Seller User membership if user had none.';
