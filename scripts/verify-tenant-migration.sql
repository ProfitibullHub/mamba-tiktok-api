-- Run in Supabase SQL Editor (staging) after migrations through 20260324120300 (includes check_user_account_access for API).
-- Expect: no rows returned by the failure checks; counts should match as described.

-- 1) Every account has a seller tenant and counts match
SELECT
    (SELECT COUNT(*) FROM accounts) AS accounts_cnt,
    (SELECT COUNT(*) FROM tenants WHERE type = 'seller') AS seller_tenants_cnt,
    CASE
        WHEN (SELECT COUNT(*) FROM accounts) = (SELECT COUNT(*) FROM tenants WHERE type = 'seller')
        THEN 'OK: accounts = seller tenants'
        ELSE 'FAIL: accounts and seller tenants differ'
    END AS accounts_vs_tenants;

-- 2) Legacy links are mirrored into memberships (user_accounts ⊆ tenant_memberships per account)
SELECT ua.user_id, a.tenant_id, ua.account_id
FROM user_accounts ua
JOIN accounts a ON a.id = ua.account_id
WHERE NOT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    WHERE tm.user_id = ua.user_id
      AND tm.tenant_id = a.tenant_id
      AND tm.status = 'active'
)
LIMIT 20;
-- Expect: 0 rows (empty result).

-- 3) No account missing tenant_id
SELECT id, name FROM accounts WHERE tenant_id IS NULL LIMIT 20;
-- Expect: 0 rows.

-- 4) RPC registered — expect one overload: p_name, p_email, p_tiktok_handle
SELECT proname, proargnames, oidvectortypes(proargtypes) AS arg_types
FROM pg_proc
WHERE proname = 'create_seller_account_for_user';

-- 5) Agency RPCs present (after 20260324120200_agency_minimal_rpcs.sql)
SELECT proname, proargnames
FROM pg_proc
WHERE proname IN (
    'create_agency_tenant',
    'agency_add_staff_membership',
    'agency_link_seller_tenant',
    'agency_grant_staff_seller_access'
)
ORDER BY proname;
