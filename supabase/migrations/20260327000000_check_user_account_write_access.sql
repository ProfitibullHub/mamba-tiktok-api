-- Seller User: read-only on shop/account data. Seller Admin (and agency/platform roles) may write.

CREATE OR REPLACE FUNCTION public.check_user_account_write_access(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.account_is_visible_to_user(p_account_id, p_user_id)
    AND NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.tenant_memberships tm
            ON tm.tenant_id = a.tenant_id
            AND tm.user_id = p_user_id
            AND tm.status = 'active'
        JOIN public.roles r ON r.id = tm.role_id AND r.tenant_id IS NULL AND r.name = 'Seller User'
        WHERE a.id = p_account_id
    );
$$;

REVOKE ALL ON FUNCTION public.check_user_account_write_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_account_write_access(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.check_user_account_write_access(uuid, uuid) IS
    'True if p_user_id may mutate data for p_account_id. Denies Seller User membership on that account''s tenant; allows Seller Admin, agency/platform roles, legacy admin.';
