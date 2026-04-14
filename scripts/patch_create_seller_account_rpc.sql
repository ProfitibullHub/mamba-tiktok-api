-- Patch only: normalize create_seller_account_for_user to a single 3-arg overload.
-- Safe to run multiple times. Does not recreate policies or other migration objects.

DROP FUNCTION IF EXISTS public.create_seller_account_for_user(text, text);

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

    v_display_name := COALESCE(NULLIF(trim(p_name), ''), 'My Shop');

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

REVOKE ALL ON FUNCTION public.create_seller_account_for_user(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_seller_account_for_user(text, text, text) TO authenticated;
