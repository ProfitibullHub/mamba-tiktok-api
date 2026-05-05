-- Enforce canonical Super Admin model:
-- 1) Super Admin memberships must belong to platform tenant only
-- 2) Every profiles.role='admin' user must have active platform Super Admin membership
-- 3) Future inserts/updates are guarded at DB level to prevent drift

DO $$
DECLARE
    v_platform_tenant_id uuid;
    v_super_admin_role_id uuid;
BEGIN
    -- Ensure platform tenant exists
    SELECT id
    INTO v_platform_tenant_id
    FROM public.tenants
    WHERE type = 'platform'
    ORDER BY created_at
    LIMIT 1;

    IF v_platform_tenant_id IS NULL THEN
        INSERT INTO public.tenants (name, type, status)
        VALUES ('Mamba Platform', 'platform', 'active')
        RETURNING id INTO v_platform_tenant_id;
    END IF;

    -- Ensure system Super Admin role exists
    SELECT id
    INTO v_super_admin_role_id
    FROM public.roles
    WHERE tenant_id IS NULL
      AND name = 'Super Admin'
    LIMIT 1;

    IF v_super_admin_role_id IS NULL THEN
        INSERT INTO public.roles (tenant_id, name, description, type, scope)
        VALUES (NULL, 'Super Admin', 'Internal platform operator', 'system', 'platform')
        RETURNING id INTO v_super_admin_role_id;
    END IF;

    -- Deactivate any non-platform memberships that currently use Super Admin role
    UPDATE public.tenant_memberships tm
    SET status = 'deactivated',
        updated_at = NOW()
    WHERE tm.role_id = v_super_admin_role_id
      AND tm.status = 'active'
      AND tm.tenant_id <> v_platform_tenant_id;

    -- Backfill: every legacy platform admin profile must have active platform Super Admin membership
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role_id, status)
    SELECT v_platform_tenant_id, p.id, v_super_admin_role_id, 'active'
    FROM public.profiles p
    WHERE p.role = 'admin'
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = 'active',
        updated_at = NOW();
END
$$;

-- Guard: Super Admin role can only be assigned on platform tenant
CREATE OR REPLACE FUNCTION public.enforce_super_admin_platform_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role_name text;
    v_role_tenant_id uuid;
    v_tenant_type text;
BEGIN
    SELECT r.name, r.tenant_id
    INTO v_role_name, v_role_tenant_id
    FROM public.roles r
    WHERE r.id = NEW.role_id;

    IF v_role_name = 'Super Admin' AND v_role_tenant_id IS NULL THEN
        SELECT t.type
        INTO v_tenant_type
        FROM public.tenants t
        WHERE t.id = NEW.tenant_id;

        IF v_tenant_type IS DISTINCT FROM 'platform' THEN
            RAISE EXCEPTION 'Super Admin membership must belong to a platform tenant';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_platform_membership ON public.tenant_memberships;
CREATE TRIGGER trg_enforce_super_admin_platform_membership
    BEFORE INSERT OR UPDATE OF tenant_id, role_id
    ON public.tenant_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_super_admin_platform_membership();

-- Guard + auto-backfill for future profiles.role='admin' inserts/updates
CREATE OR REPLACE FUNCTION public.ensure_admin_profile_has_platform_super_admin_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_platform_tenant_id uuid;
    v_super_admin_role_id uuid;
BEGIN
    IF NEW.role = 'admin' THEN
        SELECT id
        INTO v_platform_tenant_id
        FROM public.tenants
        WHERE type = 'platform'
        ORDER BY created_at
        LIMIT 1;

        IF v_platform_tenant_id IS NULL THEN
            INSERT INTO public.tenants (name, type, status)
            VALUES ('Mamba Platform', 'platform', 'active')
            RETURNING id INTO v_platform_tenant_id;
        END IF;

        SELECT id
        INTO v_super_admin_role_id
        FROM public.roles
        WHERE tenant_id IS NULL
          AND name = 'Super Admin'
        LIMIT 1;

        IF v_super_admin_role_id IS NULL THEN
            RAISE EXCEPTION 'Super Admin role missing';
        END IF;

        INSERT INTO public.tenant_memberships (tenant_id, user_id, role_id, status)
        VALUES (v_platform_tenant_id, NEW.id, v_super_admin_role_id, 'active')
        ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role_id = EXCLUDED.role_id,
            status = 'active',
            updated_at = NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_admin_super_admin_backfill ON public.profiles;
CREATE TRIGGER trg_profiles_admin_super_admin_backfill
    AFTER INSERT OR UPDATE OF role
    ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_admin_profile_has_platform_super_admin_membership();
