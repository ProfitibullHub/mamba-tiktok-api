-- Restrict create_agency_tenant to Super Admins and legacy platform admins.
-- Previously any authenticated user could call this and self-appoint as Agency Admin.

CREATE OR REPLACE FUNCTION public.create_agency_tenant(p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role_id uuid;
    v_agency_id uuid;
    v_label text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Only Super Admins (platform membership or legacy profiles.role = admin) may create agencies.
    IF NOT (
        EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role = 'admin')
        OR public.user_is_platform_super_admin(v_uid)
    ) THEN
        RAISE EXCEPTION 'Only Super Admins can create agency tenants';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
        RAISE EXCEPTION 'Profile required';
    END IF;

    SELECT id INTO v_role_id
    FROM roles
    WHERE tenant_id IS NULL AND name = 'Agency Admin'
    LIMIT 1;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Agency Admin system role missing';
    END IF;

    v_label := COALESCE(NULLIF(trim(p_name), ''), 'New Agency');

    INSERT INTO tenants (name, type, status)
    VALUES (v_label, 'agency', 'active')
    RETURNING id INTO v_agency_id;

    -- Super Admin creates the agency but does NOT auto-join it;
    -- the first Agency Admin should be assigned separately via tenant_set_member_role.
    RETURN v_agency_id;
END;
$$;

COMMENT ON FUNCTION public.create_agency_tenant IS
    'Super Admin only: creates a new agency tenant. Assign an Agency Admin separately after creation.';
