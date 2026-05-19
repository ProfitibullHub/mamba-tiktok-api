-- Document which access helpers are security boundaries vs UI/RLS convenience.
-- No behavior change.

COMMENT ON FUNCTION public.user_can_access_account(uuid) IS
    'UI convenience only (ShopPage, useShopAccessFlags): whether auth.uid() may view this account. '
    'Uses account_is_visible_to_user with SECURITY INVOKER. Not a security boundary — callers with a '
    'valid JWT can skip the UI and query PostgREST or /api/* directly. Enforcement: RLS on shop tables '
    'and check_user_account_access on the Express API (service_role).';

COMMENT ON FUNCTION public.user_can_write_shop_account(uuid) IS
    'Whether auth.uid() may INSERT/UPDATE/DELETE shop-scoped rows for this account (denies Seller User '
    'on the account seller tenant). Used in RLS policies and UI mutation gating. Direct Supabase writes '
    'must still pass RLS; Express mutations use check_user_account_write_access via account-access middleware.';

COMMENT ON FUNCTION public.check_user_account_access(uuid, uuid) IS
    'Server/API enforcement: whether p_user_id may read data for p_account_id. Granted to service_role only; '
    'used by Express account-access middleware. Same visibility rule as account_is_visible_to_user / RLS.';

COMMENT ON FUNCTION public.check_user_account_write_access(uuid, uuid) IS
    'Server/API enforcement for mutating routes: visible account and not Seller User on the account seller tenant. '
    'Granted to service_role only; used by Express account-access middleware for non-GET (except allowed sync paths).';
