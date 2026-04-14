-- user_accounts: only return rows where the linked account is visible under tenant rules
-- (seller own tenant, agency linked sellers, AM/AC assignments — same as account_is_visible_to_user).

DROP POLICY IF EXISTS "Users can view their account assignments" ON public.user_accounts;
DROP POLICY IF EXISTS "user_accounts_select_visible" ON public.user_accounts;

CREATE POLICY "user_accounts_select_visible" ON public.user_accounts FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    AND public.account_is_visible_to_user(account_id, auth.uid())
);

COMMENT ON POLICY "user_accounts_select_visible" ON public.user_accounts IS
    'User sees only their own links, and only for accounts they may access per tenant/agency/assignment rules.';
