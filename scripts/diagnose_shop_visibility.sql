-- Run this in Supabase SQL Editor to diagnose why an agency user sees all shops.
-- Replace the UUID below with David's user id.

-- 1. Check profiles.role (must NOT be 'admin' for agency-only scoping)
SELECT id, email, role FROM profiles WHERE email = 'david@gmail.com';

-- 2. Check if user has Super Admin membership (would grant full visibility)
SELECT tm.id, t.name, t.type, r.name as role_name
FROM tenant_memberships tm
JOIN tenants t ON t.id = tm.tenant_id
JOIN roles r ON r.id = tm.role_id
WHERE tm.user_id = (SELECT id FROM profiles WHERE email = 'david@gmail.com')
  AND tm.status = 'active';

-- 3. List ALL active RLS policies on 'accounts' (look for duplicates!)
SELECT policyname, permissive, cmd, qual::text
FROM pg_policies WHERE tablename = 'accounts' AND schemaname = 'public';

-- 4. List ALL active RLS policies on 'tiktok_shops'
SELECT policyname, permissive, cmd, qual::text
FROM pg_policies WHERE tablename = 'tiktok_shops' AND schemaname = 'public';

-- 5. How many user_accounts rows does David have? (legacy links)
SELECT ua.account_id, a.name, a.tenant_id
FROM user_accounts ua
JOIN accounts a ON a.id = ua.account_id
WHERE ua.user_id = (SELECT id FROM profiles WHERE email = 'david@gmail.com');

-- 6. Which accounts does tenant_is_visible_to_user allow?
SELECT a.id, a.name, a.tenant_id, t.name as tenant_name, t.type
FROM accounts a
LEFT JOIN tenants t ON t.id = a.tenant_id
WHERE account_is_visible_to_user(a.id, (SELECT id FROM profiles WHERE email = 'david@gmail.com'));
