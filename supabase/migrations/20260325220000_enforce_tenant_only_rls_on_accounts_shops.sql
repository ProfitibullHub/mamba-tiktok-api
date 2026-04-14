-- CRITICAL: Drop ALL old permissive SELECT policies on accounts and tiktok_shops.
-- Multiple permissive policies are OR'd by Postgres, so ANY surviving
-- user_accounts-based policy leaks data past tenant scoping.

-- ===== accounts =====
DROP POLICY IF EXISTS "Users can view their assigned accounts" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated users can create accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update their accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete their accounts" ON public.accounts;
DROP POLICY IF EXISTS "accounts_select_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete_visible" ON public.accounts;

CREATE POLICY "accounts_select_visible" ON public.accounts FOR SELECT TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_update_visible" ON public.accounts FOR UPDATE TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()))
WITH CHECK (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_delete_visible" ON public.accounts FOR DELETE TO authenticated
USING (public.account_is_visible_to_user(id, auth.uid()));

-- INSERT: only via RPCs (create_seller_account_for_user etc.)
DROP POLICY IF EXISTS "accounts_insert_rpc" ON public.accounts;

-- ===== tiktok_shops =====
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

-- ===== shop_orders =====
DROP POLICY IF EXISTS "Users can view orders from their shops" ON public.shop_orders;
DROP POLICY IF EXISTS "Users can insert orders to their shops" ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_select_visible" ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_insert_visible" ON public.shop_orders;

CREATE POLICY "shop_orders_select_visible" ON public.shop_orders FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM tiktok_shops ts
    WHERE ts.id = shop_orders.shop_id
      AND public.account_is_visible_to_user(ts.account_id, auth.uid())
));

CREATE POLICY "shop_orders_insert_visible" ON public.shop_orders FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM tiktok_shops ts
    WHERE ts.id = shop_orders.shop_id
      AND public.account_is_visible_to_user(ts.account_id, auth.uid())
));

-- ===== shop_products =====
DROP POLICY IF EXISTS "Users can view products from their shops" ON public.shop_products;
DROP POLICY IF EXISTS "shop_products_select_visible" ON public.shop_products;

CREATE POLICY "shop_products_select_visible" ON public.shop_products FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM tiktok_shops ts
    WHERE ts.id = shop_products.shop_id
      AND public.account_is_visible_to_user(ts.account_id, auth.uid())
));

-- ===== shop_settlements =====
DROP POLICY IF EXISTS "Users can view settlements from their shops" ON public.shop_settlements;
DROP POLICY IF EXISTS "shop_settlements_select_visible" ON public.shop_settlements;

CREATE POLICY "shop_settlements_select_visible" ON public.shop_settlements FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM tiktok_shops ts
    WHERE ts.id = shop_settlements.shop_id
      AND public.account_is_visible_to_user(ts.account_id, auth.uid())
));

-- ===== shop_performance =====
DROP POLICY IF EXISTS "Users can view performance from their shops" ON public.shop_performance;
DROP POLICY IF EXISTS "shop_performance_select_visible" ON public.shop_performance;

CREATE POLICY "shop_performance_select_visible" ON public.shop_performance FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM tiktok_shops ts
    WHERE ts.id = shop_performance.shop_id
      AND public.account_is_visible_to_user(ts.account_id, auth.uid())
));

-- ===== user_accounts =====
DROP POLICY IF EXISTS "Users can view their account assignments" ON public.user_accounts;
DROP POLICY IF EXISTS "user_accounts_select_visible" ON public.user_accounts;

CREATE POLICY "user_accounts_select_visible" ON public.user_accounts FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    AND public.account_is_visible_to_user(account_id, auth.uid())
);
