-- =============================================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Fixes agency/seller shop visibility so users only see what SOW allows.
-- Nothing is hardcoded to a specific user — applies to the entire platform.
-- =============================================================================


-- ===== STEP 1: DIAGNOSE (before fix) =====

SELECT '1a. POLICIES_BEFORE' as step, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('accounts', 'tiktok_shops', 'user_accounts', 'shop_orders', 'shop_products', 'shop_settlements', 'shop_performance')
ORDER BY tablename, policyname;

SELECT '1b. AGENCY_HIERARCHY' as step,
    agency.id as agency_id, agency.name as agency,
    seller.id as seller_tenant_id, seller.name as linked_seller
FROM tenants seller
JOIN tenants agency ON agency.id = seller.parent_tenant_id AND agency.type = 'agency'
WHERE seller.type = 'seller'
ORDER BY agency.name, seller.name;

SELECT '1c. MEMBERSHIPS_BEFORE' as step, p.email, t.name as tenant_name, t.type, r.name as role_name
FROM tenant_memberships tm
JOIN profiles p ON p.id = tm.user_id
JOIN tenants t ON t.id = tm.tenant_id
JOIN roles r ON r.id = tm.role_id
WHERE tm.status = 'active'
ORDER BY p.email, t.type, t.name;


-- ===== STEP 2: FIX RLS POLICIES =====
-- Drop ALL old user_accounts-based policies, create ONLY tenant-scoped ones.

-- accounts
DROP POLICY IF EXISTS "Users can view their assigned accounts" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated users can create accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update their accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete their accounts" ON public.accounts;
DROP POLICY IF EXISTS "accounts_select_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_insert_rpc" ON public.accounts;

CREATE POLICY "accounts_select_visible" ON public.accounts FOR SELECT TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_update_visible" ON public.accounts FOR UPDATE TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()))
WITH CHECK (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_delete_visible" ON public.accounts FOR DELETE TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()));

-- tiktok_shops
DROP POLICY IF EXISTS "Users can view shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can insert shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can update shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can delete shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can view their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can insert their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can update their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can delete their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_select_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_insert_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_update_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_delete_visible" ON public.tiktok_shops;

CREATE POLICY "tiktok_shops_select_visible" ON public.tiktok_shops FOR SELECT TO authenticated
USING (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_insert_visible" ON public.tiktok_shops FOR INSERT TO authenticated
WITH CHECK (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_update_visible" ON public.tiktok_shops FOR UPDATE TO authenticated
USING (public.account_is_visible_to_user(account_id, auth.uid()))
WITH CHECK (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_delete_visible" ON public.tiktok_shops FOR DELETE TO authenticated
USING (public.account_is_visible_to_user(account_id, auth.uid()));

-- user_accounts
DROP POLICY IF EXISTS "Users can view their account assignments" ON public.user_accounts;
DROP POLICY IF EXISTS "user_accounts_select_visible" ON public.user_accounts;

CREATE POLICY "user_accounts_select_visible" ON public.user_accounts FOR SELECT TO authenticated
USING (user_id = auth.uid() AND public.account_is_visible_to_user(account_id, auth.uid()));

-- shop_orders
DROP POLICY IF EXISTS "Users can view orders from their shops" ON public.shop_orders;
DROP POLICY IF EXISTS "Users can insert orders to their shops" ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_select_visible" ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_insert_visible" ON public.shop_orders;

CREATE POLICY "shop_orders_select_visible" ON public.shop_orders FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM tiktok_shops ts WHERE ts.id = shop_orders.shop_id AND public.account_is_visible_to_user(ts.account_id, auth.uid())));

CREATE POLICY "shop_orders_insert_visible" ON public.shop_orders FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM tiktok_shops ts WHERE ts.id = shop_orders.shop_id AND public.account_is_visible_to_user(ts.account_id, auth.uid())));

-- shop_products
DROP POLICY IF EXISTS "Users can view products from their shops" ON public.shop_products;
DROP POLICY IF EXISTS "shop_products_select_visible" ON public.shop_products;

CREATE POLICY "shop_products_select_visible" ON public.shop_products FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM tiktok_shops ts WHERE ts.id = shop_products.shop_id AND public.account_is_visible_to_user(ts.account_id, auth.uid())));

-- shop_settlements
DROP POLICY IF EXISTS "Users can view settlements from their shops" ON public.shop_settlements;
DROP POLICY IF EXISTS "shop_settlements_select_visible" ON public.shop_settlements;

CREATE POLICY "shop_settlements_select_visible" ON public.shop_settlements FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM tiktok_shops ts WHERE ts.id = shop_settlements.shop_id AND public.account_is_visible_to_user(ts.account_id, auth.uid())));

-- shop_performance
DROP POLICY IF EXISTS "Users can view performance from their shops" ON public.shop_performance;
DROP POLICY IF EXISTS "shop_performance_select_visible" ON public.shop_performance;

CREATE POLICY "shop_performance_select_visible" ON public.shop_performance FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM tiktok_shops ts WHERE ts.id = shop_performance.shop_id AND public.account_is_visible_to_user(ts.account_id, auth.uid())));


-- ===== STEP 3: CLEAN UP STALE TENANT MEMBERSHIPS =====
--
-- The legacy backfill gave users direct Seller memberships on EVERY tenant their
-- accounts touched. For Agency Admins this is wrong: their access to seller tenants
-- should come ONLY through the agency hierarchy (parent_tenant_id), not through
-- direct memberships.
--
-- For each user who holds an Agency Admin role:
--   - Delete their memberships on seller tenants that are NOT children of their agency.
--   - The agency hierarchy in tenant_is_visible_to_user already grants access to
--     child sellers, so direct memberships on those are also unnecessary (but harmless).

-- 3a. Remove agency-admin users' seller-tenant memberships where the seller
--     is NOT a child of ANY agency the user admins.
DELETE FROM tenant_memberships
WHERE id IN (
    SELECT stale_tm.id
    FROM tenant_memberships stale_tm
    JOIN tenants seller_t ON seller_t.id = stale_tm.tenant_id AND seller_t.type = 'seller'
    -- The user also has an Agency Admin membership somewhere
    JOIN tenant_memberships agency_tm ON agency_tm.user_id = stale_tm.user_id AND agency_tm.status = 'active'
    JOIN roles agency_role ON agency_role.id = agency_tm.role_id AND agency_role.name = 'Agency Admin'
    WHERE stale_tm.status = 'active'
      -- The seller is NOT a child of any agency the user admins
      AND NOT EXISTS (
          SELECT 1
          FROM tenant_memberships my_agency_tm
          JOIN roles ar ON ar.id = my_agency_tm.role_id AND ar.name = 'Agency Admin'
          JOIN tenants child_seller ON child_seller.parent_tenant_id = my_agency_tm.tenant_id
              AND child_seller.id = seller_t.id
          WHERE my_agency_tm.user_id = stale_tm.user_id AND my_agency_tm.status = 'active'
      )
);

-- 3b. Also remove direct seller-tenant memberships on child sellers for agency admins.
--     These are redundant (agency hierarchy already grants access) and would survive
--     if the seller is later unlinked from the agency.
DELETE FROM tenant_memberships
WHERE id IN (
    SELECT stale_tm.id
    FROM tenant_memberships stale_tm
    JOIN tenants seller_t ON seller_t.id = stale_tm.tenant_id AND seller_t.type = 'seller'
    JOIN tenant_memberships agency_tm ON agency_tm.user_id = stale_tm.user_id AND agency_tm.status = 'active'
    JOIN roles agency_role ON agency_role.id = agency_tm.role_id AND agency_role.name = 'Agency Admin'
    WHERE stale_tm.status = 'active'
      -- The seller IS a child of the user's agency — membership is redundant
      AND EXISTS (
          SELECT 1
          FROM tenant_memberships my_agency_tm
          JOIN roles ar ON ar.id = my_agency_tm.role_id AND ar.name = 'Agency Admin'
          JOIN tenants child_seller ON child_seller.parent_tenant_id = my_agency_tm.tenant_id
              AND child_seller.id = seller_t.id
          WHERE my_agency_tm.user_id = stale_tm.user_id AND my_agency_tm.status = 'active'
      )
);

-- 3c. Now clean up user_accounts rows that no longer pass visibility.
--     Must run AFTER membership cleanup so account_is_visible_to_user reflects new state.
DELETE FROM user_accounts
WHERE id IN (
    SELECT ua.id
    FROM user_accounts ua
    WHERE NOT public.account_is_visible_to_user(ua.account_id, ua.user_id)
);


-- ===== STEP 4: VERIFY =====

SELECT '4a. POLICIES_AFTER' as step, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('accounts', 'tiktok_shops', 'user_accounts')
ORDER BY tablename, policyname;

SELECT '4b. MEMBERSHIPS_AFTER' as step, p.email, t.name as tenant_name, t.type, r.name as role_name
FROM tenant_memberships tm
JOIN profiles p ON p.id = tm.user_id
JOIN tenants t ON t.id = tm.tenant_id
JOIN roles r ON r.id = tm.role_id
WHERE tm.status = 'active'
ORDER BY p.email, t.type, t.name;

SELECT '4c. HIERARCHY' as step, agency.name as agency, seller.name as linked_seller
FROM tenants seller
JOIN tenants agency ON agency.id = seller.parent_tenant_id AND agency.type = 'agency'
WHERE seller.type = 'seller'
ORDER BY agency.name, seller.name;
