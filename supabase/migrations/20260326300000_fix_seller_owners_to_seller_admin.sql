-- Fix: The original backfill (step 10 of 20260324120000) assigned Seller User
-- to all non-admin shop owners. Shop owners who connected their own shops
-- should be Seller Admin. Since each seller tenant was created from exactly
-- one account + one user_accounts row, every user who is the ONLY member
-- of their seller tenant is the original owner and should be Seller Admin.
--
-- For tenants with multiple members, the earliest member (by created_at)
-- is treated as the owner.

UPDATE tenant_memberships tm
SET role_id = (
    SELECT id FROM roles
    WHERE tenant_id IS NULL AND name = 'Seller Admin'
    LIMIT 1
),
    updated_at = NOW()
FROM (
    SELECT DISTINCT ON (tm2.tenant_id)
        tm2.id AS membership_id
    FROM tenant_memberships tm2
    JOIN tenants t ON t.id = tm2.tenant_id AND t.type = 'seller'
    WHERE tm2.status = 'active'
    ORDER BY tm2.tenant_id, tm2.created_at ASC
) owners
WHERE tm.id = owners.membership_id
  AND tm.role_id = (
      SELECT id FROM roles
      WHERE tenant_id IS NULL AND name = 'Seller User'
      LIMIT 1
  );
