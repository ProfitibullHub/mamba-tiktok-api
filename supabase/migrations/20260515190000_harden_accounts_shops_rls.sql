-- Security: restore tenant/membership-scoped visibility for accounts + tiktok_shops.
-- 20260416120000 replaced tenant_is_visible_to_user with profile-context-only checks,
-- dropping direct tenant_memberships / agency-tree / AM assignment rules (cross-tenant leak risk
-- when combined with legacy permissive policies or stale user_accounts links).

-- ---------------------------------------------------------------------------
-- 1. Visibility helpers (SECURITY DEFINER — used by RLS policies)
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
        public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = p_user_id AND p.role = 'admin'
        )
        OR EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            WHERE tm.user_id = p_user_id
              AND tm.status = 'active'
              AND tm.tenant_id = p_tenant_id
        )
        OR public.user_is_agency_admin(p_tenant_id, p_user_id)
        OR public.user_is_agency_admin_of_seller_parent(p_tenant_id, p_user_id)
        OR public.user_is_seller_admin(p_tenant_id, p_user_id)
        OR EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            JOIN public.roles r
              ON r.id = tm.role_id
             AND r.tenant_id IS NULL
             AND r.name IN ('Account Manager', 'Account Coordinator')
            JOIN public.user_seller_assignments usa
              ON usa.tenant_membership_id = tm.id
             AND usa.seller_tenant_id = p_tenant_id
            WHERE tm.user_id = p_user_id
              AND tm.status = 'active'
        )
    );
$$;

COMMENT ON FUNCTION public.tenant_is_visible_to_user(uuid, uuid) IS
    'RLS visibility: platform super admin, legacy profiles.admin, active tenant membership, agency admin (incl. linked sellers), seller admin, AM/AC seller assignments.';

CREATE OR REPLACE FUNCTION public.account_is_visible_to_user(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.accounts a
        WHERE a.id = p_account_id
          AND a.tenant_id IS NOT NULL
          AND public.tenant_is_visible_to_user(a.tenant_id, p_user_id)
    );
$$;

COMMENT ON FUNCTION public.account_is_visible_to_user(uuid, uuid) IS
    'True when the account has a seller tenant_id and tenant_is_visible_to_user allows access.';

-- Keep server RPC in sync with RLS visibility.
CREATE OR REPLACE FUNCTION public.check_user_account_access(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.account_is_visible_to_user(p_account_id, p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop legacy / duplicate permissive policies (Postgres ORs multiple permissive policies)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their assigned accounts" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated users can create accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can update their accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete their accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can insert their own shops" ON public.accounts;

DROP POLICY IF EXISTS "Users can view shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can insert shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can update shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can delete shops for their accounts" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can view their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can insert their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can update their own shops" ON public.tiktok_shops;
DROP POLICY IF EXISTS "Users can delete their own shops" ON public.tiktok_shops;

DROP POLICY IF EXISTS "accounts_select_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete_visible" ON public.accounts;
DROP POLICY IF EXISTS "accounts_insert_rpc" ON public.accounts;

DROP POLICY IF EXISTS "tiktok_shops_select_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_insert_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_update_visible" ON public.tiktok_shops;
DROP POLICY IF EXISTS "tiktok_shops_delete_visible" ON public.tiktok_shops;

-- ---------------------------------------------------------------------------
-- 3. Enforce RLS (tenant-scoped single permissive policy per command)
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiktok_shops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select_visible" ON public.accounts
    FOR SELECT TO authenticated
    USING (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_update_visible" ON public.accounts
    FOR UPDATE TO authenticated
    USING (public.account_is_visible_to_user(id, auth.uid()))
    WITH CHECK (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "accounts_delete_visible" ON public.accounts
    FOR DELETE TO authenticated
    USING (public.account_is_visible_to_user(id, auth.uid()));

CREATE POLICY "tiktok_shops_select_visible" ON public.tiktok_shops
    FOR SELECT TO authenticated
    USING (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_insert_visible" ON public.tiktok_shops
    FOR INSERT TO authenticated
    WITH CHECK (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_update_visible" ON public.tiktok_shops
    FOR UPDATE TO authenticated
    USING (public.account_is_visible_to_user(account_id, auth.uid()))
    WITH CHECK (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY "tiktok_shops_delete_visible" ON public.tiktok_shops
    FOR DELETE TO authenticated
    USING (public.account_is_visible_to_user(account_id, auth.uid()));

-- user_accounts: only rows for accounts the user may see
DROP POLICY IF EXISTS "Users can view their account assignments" ON public.user_accounts;
DROP POLICY IF EXISTS "user_accounts_select_visible" ON public.user_accounts;

CREATE POLICY "user_accounts_select_visible" ON public.user_accounts
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND public.account_is_visible_to_user(account_id, auth.uid())
    );
