-- Direct Supabase writes (agency_fees, affiliate_settlements) must match API write rules:
-- visible account, and not "Seller User" on that account's seller tenant.

CREATE OR REPLACE FUNCTION public.user_can_write_shop_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL
    AND public.account_is_visible_to_user(p_account_id, auth.uid())
    AND NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.tenant_memberships tm
            ON tm.tenant_id = a.tenant_id
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
        JOIN public.roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Seller User'
        WHERE a.id = p_account_id
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_write_shop_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_write_shop_account(uuid) TO authenticated;

COMMENT ON FUNCTION public.user_can_write_shop_account(uuid) IS
    'Whether the current session may INSERT/UPDATE/DELETE shop-scoped rows for this account. Denies Seller User on the account tenant; same logic as check_user_account_write_access.';

-- ── agency_fees ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage their own agency fees" ON public.agency_fees;

CREATE POLICY agency_fees_select_tenant_visible
    ON public.agency_fees
    FOR SELECT
    USING (public.account_is_visible_to_user(account_id, auth.uid()));

CREATE POLICY agency_fees_insert_writable
    ON public.agency_fees
    FOR INSERT
    WITH CHECK (public.user_can_write_shop_account(account_id));

CREATE POLICY agency_fees_update_writable
    ON public.agency_fees
    FOR UPDATE
    USING (public.user_can_write_shop_account(account_id))
    WITH CHECK (public.user_can_write_shop_account(account_id));

CREATE POLICY agency_fees_delete_writable
    ON public.agency_fees
    FOR DELETE
    USING (public.user_can_write_shop_account(account_id));

-- ── affiliate_settlements (account_id stored as text UUID; table may come from manual scripts) ──
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'affiliate_settlements'
    ) THEN
        DROP POLICY IF EXISTS "Users can view their own affiliate settlements" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can insert their own affiliate settlements" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can update their own affiliate settlements" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can delete their own affiliate settlements" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can view affiliate settlements for their accounts" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can insert affiliate settlements for their accounts" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can update affiliate settlements for their accounts" ON public.affiliate_settlements;
        DROP POLICY IF EXISTS "Users can delete affiliate settlements for their accounts" ON public.affiliate_settlements;

        CREATE POLICY affiliate_settlements_select_tenant_visible
            ON public.affiliate_settlements
            FOR SELECT
            USING (public.account_is_visible_to_user((account_id)::uuid, auth.uid()));

        CREATE POLICY affiliate_settlements_insert_writable
            ON public.affiliate_settlements
            FOR INSERT
            WITH CHECK (public.user_can_write_shop_account((account_id)::uuid));

        CREATE POLICY affiliate_settlements_update_writable
            ON public.affiliate_settlements
            FOR UPDATE
            USING (public.user_can_write_shop_account((account_id)::uuid))
            WITH CHECK (public.user_can_write_shop_account((account_id)::uuid));

        CREATE POLICY affiliate_settlements_delete_writable
            ON public.affiliate_settlements
            FOR DELETE
            USING (public.user_can_write_shop_account((account_id)::uuid));
    END IF;
END $$;
