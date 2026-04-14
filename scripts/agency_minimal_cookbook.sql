-- Cookbook: agency slice (run in SQL Editor or psql). Replace UUIDs with real ids from your project.
-- Prefer RPCs from the app when possible; this is for ops / debugging.

-- ---------------------------------------------------------------------------
-- A) Flow using RPCs (caller = JWT user in Supabase client; in SQL Editor use
--    "Run as authenticated" or set role — usually you test from the app instead).
-- ---------------------------------------------------------------------------

-- 1) Seller signs up → already have seller tenant + account via create_seller_account_for_user.
--    Note seller_tenant_id = accounts.tenant_id for that shop.

-- 2) Agency owner (logged-in user) creates agency:
--    select create_agency_tenant('My Agency Name');  -- returns agency uuid

-- 3) Agency Admin links a seller tenant under the agency:
--    select agency_link_seller_tenant('<agency_tenant_id>'::uuid, '<seller_tenant_id>'::uuid);

-- 4) Agency Admin adds an Account Manager (profile must exist):
--    select agency_add_staff_membership('<agency_tenant_id>'::uuid, '<staff_user_id>'::uuid, 'Account Manager');

-- 5) Agency Admin assigns that AM to a seller (seller must already be linked in step 3):
--    select agency_grant_staff_seller_access('<agency_tenant_id>'::uuid, '<staff_user_id>'::uuid, '<seller_tenant_id>'::uuid);

-- ---------------------------------------------------------------------------
-- B) Pure SQL equivalent (service role / postgres only — bypasses RPC auth checks)
-- ---------------------------------------------------------------------------

/*
-- Create agency tenant
INSERT INTO tenants (name, type, status)
VALUES ('Demo Agency', 'agency', 'active')
RETURNING id;

-- Agency Admin membership for user U1 on agency A
INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
SELECT '<AGENCY_ID>'::uuid, '<USER_U1>'::uuid, r.id, 'active'
FROM roles r
WHERE r.tenant_id IS NULL AND r.name = 'Agency Admin'
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role_id = EXCLUDED.role_id, status = 'active', updated_at = NOW();

-- Link seller tenant S1 under agency A
UPDATE tenants
SET parent_tenant_id = '<AGENCY_ID>'::uuid, updated_at = NOW()
WHERE id = '<SELLER_TENANT_S1>'::uuid AND type = 'seller';

-- AM membership for user U2
INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
SELECT '<AGENCY_ID>'::uuid, '<USER_U2>'::uuid, r.id, 'active'
FROM roles r
WHERE r.tenant_id IS NULL AND r.name = 'Account Manager'
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role_id = EXCLUDED.role_id, status = 'active', updated_at = NOW();

-- Assignment: AM U2 → seller S1 (use tenant_memberships.id for U2 on agency)
INSERT INTO user_seller_assignments (tenant_membership_id, seller_tenant_id)
SELECT tm.id, '<SELLER_TENANT_S1>'::uuid
FROM tenant_memberships tm
JOIN roles r ON r.id = tm.role_id
WHERE tm.tenant_id = '<AGENCY_ID>'::uuid
  AND tm.user_id = '<USER_U2>'::uuid
  AND r.name = 'Account Manager'
ON CONFLICT DO NOTHING;
*/

-- ---------------------------------------------------------------------------
-- C) Useful lookups
-- ---------------------------------------------------------------------------

-- Seller tenant for an account
-- SELECT id AS seller_tenant_id, name FROM tenants WHERE id = (SELECT tenant_id FROM accounts WHERE id = '<account_id>');

-- List sellers under an agency
-- SELECT id, name, status FROM tenants WHERE parent_tenant_id = '<agency_id>' AND type = 'seller';
