-- Update the RPC default fallback name from 'My Shop' to 'New Seller'
CREATE OR REPLACE FUNCTION public.create_seller_account_for_user(
    p_name text DEFAULT NULL,
    p_email text DEFAULT NULL,
    p_tiktok_handle text DEFAULT NULL
)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tenant_id uuid;
    v_role_id uuid;
    v_display_name text;
    new_row public.accounts;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
        RAISE EXCEPTION 'Profile required';
    END IF;

    IF p_email IS NOT NULL AND trim(p_email) <> '' THEN
        UPDATE profiles
        SET email = trim(p_email), updated_at = NOW()
        WHERE id = v_uid AND (email IS NULL OR trim(email) = '');
    END IF;

    SELECT id INTO v_role_id
    FROM roles
    WHERE tenant_id IS NULL AND name = 'Seller Admin'
    LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Seller Admin system role missing';
    END IF;

    v_display_name := COALESCE(NULLIF(trim(p_name), ''), 'New Seller');

    INSERT INTO tenants (name, type, status)
    VALUES (v_display_name, 'seller', 'active')
    RETURNING id INTO v_tenant_id;
    
    INSERT INTO accounts (name, tiktok_handle, status, tenant_id)
    VALUES (
        v_display_name,
        NULLIF(trim(p_tiktok_handle), ''),
        'active',
        v_tenant_id
    )
    RETURNING * INTO new_row;

    INSERT INTO user_accounts (user_id, account_id)
    VALUES (v_uid, new_row.id)
    ON CONFLICT (user_id, account_id) DO NOTHING;

    INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (v_tenant_id, v_uid, v_role_id, 'active')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW();

    RETURN new_row;
END;
$$;

-- Fix existing "My Shop" placeholders:
-- 1. Rename accounts+tenants that have a real TikTok shop to the shop's name
-- 2. Delete orphan accounts+tenants named "My Shop" that have no connected shops

-- Step 1: Rename accounts that have at least one TikTok shop connected
UPDATE accounts a
SET name = sub.shop_name,
    tiktok_handle = lower(regexp_replace(sub.shop_name, '\s+', '', 'g')),
    updated_at = NOW()
FROM (
    SELECT DISTINCT ON (ts.account_id)
        ts.account_id,
        ts.shop_name
    FROM tiktok_shops ts
    JOIN accounts acc ON acc.id = ts.account_id
    WHERE acc.name = 'My Shop'
    ORDER BY ts.account_id, ts.created_at ASC
) sub
WHERE a.id = sub.account_id;

-- Step 2: Rename tenants whose accounts were just renamed
UPDATE tenants t
SET name = a.name,
    updated_at = NOW()
FROM accounts a
WHERE a.tenant_id = t.id
  AND t.name = 'My Shop'
  AND a.name <> 'My Shop';

-- Step 3: Delete orphan "My Shop" accounts that have NO tiktok_shops at all.
-- First remove related rows, then the account, then the tenant.

-- 3a. Delete tenant_memberships for orphan tenants
DELETE FROM tenant_memberships
WHERE tenant_id IN (
    SELECT a.tenant_id
    FROM accounts a
    LEFT JOIN tiktok_shops ts ON ts.account_id = a.id
    WHERE a.name = 'My Shop'
      AND ts.id IS NULL
);

-- 3b. Delete user_accounts for orphan accounts
DELETE FROM user_accounts
WHERE account_id IN (
    SELECT a.id
    FROM accounts a
    LEFT JOIN tiktok_shops ts ON ts.account_id = a.id
    WHERE a.name = 'My Shop'
      AND ts.id IS NULL
);

-- 3c. Capture orphan tenant IDs before deleting accounts
CREATE TEMP TABLE _orphan_tenant_ids AS
SELECT a.tenant_id
FROM accounts a
LEFT JOIN tiktok_shops ts ON ts.account_id = a.id
WHERE a.name = 'My Shop'
  AND ts.id IS NULL;

-- 3d. Delete the orphan accounts
DELETE FROM accounts
WHERE id IN (
    SELECT a.id
    FROM accounts a
    LEFT JOIN tiktok_shops ts ON ts.account_id = a.id
    WHERE a.name = 'My Shop'
      AND ts.id IS NULL
);

-- 3e. Delete the orphan tenants (only if no other accounts reference them)
DELETE FROM tenants
WHERE id IN (SELECT tenant_id FROM _orphan_tenant_ids)
  AND NOT EXISTS (
      SELECT 1 FROM accounts a2 WHERE a2.tenant_id = tenants.id
  );

DROP TABLE IF EXISTS _orphan_tenant_ids;
