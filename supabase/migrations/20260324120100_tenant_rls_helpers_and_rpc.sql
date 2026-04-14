-- Phase 2: SECURITY DEFINER visibility helpers, agency/assignment rules, RPC for new sellers,
-- and RLS on accounts / tiktok_shops / shop_* aligned with tenant_id.

-- ---------------------------------------------------------------------------
-- 1. Visibility helpers (bypass RLS; STABLE for planner caching)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_is_visible_to_user(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_tenant_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
        -- Legacy Mamba internal admin (profiles.role)
        EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role = 'admin')
        OR EXISTS (
            SELECT 1 FROM tenant_memberships tm
            WHERE tm.user_id = p_user_id AND tm.status = 'active' AND tm.tenant_id = p_tenant_id
        )
        OR EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Agency Admin'
            JOIN tenants agency ON agency.id = tm.tenant_id AND agency.type = 'agency'
            JOIN tenants seller ON seller.parent_tenant_id = agency.id
                AND seller.id = p_tenant_id AND seller.type = 'seller'
            WHERE tm.user_id = p_user_id AND tm.status = 'active'
        )
        OR EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            JOIN roles r ON r.id = tm.role_id AND r.tenant_id IS NULL
                AND r.name IN ('Account Manager', 'Account Coordinator')
            JOIN user_seller_assignments usa ON usa.tenant_membership_id = tm.id
                AND usa.seller_tenant_id = p_tenant_id
            WHERE tm.user_id = p_user_id AND tm.status = 'active'
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.account_is_visible_to_user(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tenant_is_visible_to_user(
        (SELECT a.tenant_id FROM accounts a WHERE a.id = p_account_id),
        p_user_id
    );
$$;

COMMENT ON FUNCTION public.tenant_is_visible_to_user IS
    'True if user may access data for this tenant: direct membership, Agency Admin over child seller, AM/AC via user_seller_assignments, or legacy profiles.role = admin.';
COMMENT ON FUNCTION public.account_is_visible_to_user IS
    'True if user may access this account via tenant visibility (accounts.tenant_id).';

-- ---------------------------------------------------------------------------
-- 2. RPC: create seller tenant + account + user_accounts + Seller Admin membership
-- ---------------------------------------------------------------------------
-- Drop legacy 2-arg overload so PostgREST exposes a single RPC (name + handle only).
DROP FUNCTION IF EXISTS public.create_seller_account_for_user(text, text);

CREATE OR REPLACE FUNCTION public.create_seller_account_for_user(
    p_name text DEFAULT NULL,
    p_email text DEFAULT NULL,
    p_tiktok_handle text DEFAULT NULL
)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tenant_id uuid;
    v_role_id uuid;
    v_display_name text;
    new_row public.accounts;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
        RAISE EXCEPTION 'Profile required';
    END IF;

    -- Optional: set profile email when caller passes it and row has no email yet
    IF p_email IS NOT NULL AND trim(p_email) <> '' THEN
        UPDATE profiles
        SET email = trim(p_email), updated_at = NOW()
        WHERE id = v_uid AND (email IS NULL OR trim(email) = '');
    END IF;

    SELECT id INTO v_role_id
    FROM roles
    WHERE tenant_id IS NULL AND name = 'Seller Admin'
    LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Seller Admin system role missing';
    END IF;

    v_display_name := COALESCE(NULLIF(trim(p_name), ''), 'My Shop');

    INSERT INTO tenants (name, type, status)
    VALUES (v_display_name, 'seller', 'active')
    RETURNING id INTO v_tenant_id;

    INSERT INTO accounts (name, tiktok_handle, status, tenant_id)
    VALUES (
        v_display_name,
        NULLIF(trim(p_tiktok_handle), ''),
        'active',
        v_tenant_id
    )
    RETURNING * INTO new_row;

    INSERT INTO user_accounts (user_id, account_id)
    VALUES (v_uid, new_row.id)
    ON CONFLICT (user_id, account_id) DO NOTHING;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (v_tenant_id, v_uid, v_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW();

    RETURN new_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_seller_account_for_user(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_seller_account_for_user(text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. tenants: replace direct-membership-only policy with helper
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;

CREATE POLICY "tenants_select_visible" ON tenants FOR SELECT TO authenticated
USING (tenant_is_visible_to_user(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. accounts: visibility via tenant; no direct INSERT for clients (use RPC)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their assigned accounts" ON accounts;
DROP POLICY IF EXISTS "Authenticated users can create accounts" ON accounts;
DROP POLICY IF EXISTS "Users can update their accounts" ON accounts;
DROP POLICY IF EXISTS "Users can delete their accounts" ON accounts;

CREATE POLICY "accounts_select_visible" ON accounts FOR SELECT TO authenticated
USING (account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_update_visible" ON accounts FOR UPDATE TO authenticated
USING (account_is_visible_to_user(id, auth.uid()))
WITH CHECK (account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_delete_visible" ON accounts FOR DELETE TO authenticated
USING (account_is_visible_to_user(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. tiktok_shops: drop name variants from different migration histories
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view shops for their accounts" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can insert shops for their accounts" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can update shops for their accounts" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can delete shops for their accounts" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can view their own shops" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can insert their own shops" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can update their own shops" ON tiktok_shops;
DROP POLICY IF EXISTS "Users can delete their own shops" ON tiktok_shops;

CREATE POLICY "tiktok_shops_select_visible" ON tiktok_shops FOR SELECT TO authenticated
USING (account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_insert_visible" ON tiktok_shops FOR INSERT TO authenticated
WITH CHECK (account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_update_visible" ON tiktok_shops FOR UPDATE TO authenticated
USING (account_is_visible_to_user(account_id, auth.uid()))
WITH CHECK (account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_delete_visible" ON tiktok_shops FOR DELETE TO authenticated
USING (account_is_visible_to_user(account_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. shop_* tables: same visibility via shop -> account
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view orders from their shops" ON shop_orders;
DROP POLICY IF EXISTS "Users can insert orders to their shops" ON shop_orders;
DROP POLICY IF EXISTS "Users can view products from their shops" ON shop_products;
DROP POLICY IF EXISTS "Users can view settlements from their shops" ON shop_settlements;
DROP POLICY IF EXISTS "Users can view performance from their shops" ON shop_performance;

CREATE POLICY "shop_orders_select_visible" ON shop_orders FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM tiktok_shops ts
        WHERE ts.id = shop_orders.shop_id
          AND account_is_visible_to_user(ts.account_id, auth.uid())
    )
);

CREATE POLICY "shop_orders_insert_visible" ON shop_orders FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM tiktok_shops ts
        WHERE ts.id = shop_orders.shop_id
          AND account_is_visible_to_user(ts.account_id, auth.uid())
    )
);

CREATE POLICY "shop_products_select_visible" ON shop_products FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM tiktok_shops ts
        WHERE ts.id = shop_products.shop_id
          AND account_is_visible_to_user(ts.account_id, auth.uid())
    )
);

CREATE POLICY "shop_settlements_select_visible" ON shop_settlements FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM tiktok_shops ts
        WHERE ts.id = shop_settlements.shop_id
          AND account_is_visible_to_user(ts.account_id, auth.uid())
    )
);

CREATE POLICY "shop_performance_select_visible" ON shop_performance FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM tiktok_shops ts
        WHERE ts.id = shop_performance.shop_id
          AND account_is_visible_to_user(ts.account_id, auth.uid())
    )
);
