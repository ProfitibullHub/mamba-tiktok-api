-- M1: Agency tenant branding (no logo) + append-only audit + RBAC permissions.
-- Server uses service role for reads/writes; RLS enabled with no authenticated policies.

-- ---------------------------------------------------------------------------
-- 1. Branding row (one per agency tenant; logo_url deferred to M2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_branding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    primary_color text,
    secondary_color text,
    display_name text,
    email_sender_name text,
    email_sender_address text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_branding_tenant UNIQUE (tenant_id),
    CONSTRAINT tenant_branding_display_name_len CHECK (
        display_name IS NULL OR (char_length(trim(display_name)) BETWEEN 1 AND 120)
    ),
    CONSTRAINT tenant_branding_email_sender_name_len CHECK (
        email_sender_name IS NULL OR (char_length(trim(email_sender_name)) BETWEEN 1 AND 120)
    ),
    CONSTRAINT tenant_branding_email_sender_address_len CHECK (
        email_sender_address IS NULL OR (char_length(trim(email_sender_address)) BETWEEN 3 AND 254)
    ),
    CONSTRAINT tenant_branding_primary_color_hex CHECK (
        primary_color IS NULL OR primary_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    ),
    CONSTRAINT tenant_branding_secondary_color_hex CHECK (
        secondary_color IS NULL OR secondary_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    )
);

CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON public.tenant_branding (tenant_id);

-- PG forbids subqueries in CHECK constraints; enforce agency-only tenant_id with a trigger.
CREATE OR REPLACE FUNCTION public.tenant_branding_enforce_agency_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = NEW.tenant_id
          AND t.type = 'agency'
    ) THEN
        RAISE EXCEPTION 'tenant_branding.tenant_id must reference an agency tenant (got %)', NEW.tenant_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_branding_enforce_agency_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_branding_enforce_agency_tenant() TO service_role;

COMMENT ON FUNCTION public.tenant_branding_enforce_agency_tenant() IS
    'Ensures tenant_branding rows only reference tenants.type = agency.';

DROP TRIGGER IF EXISTS trg_tenant_branding_agency_only ON public.tenant_branding;
CREATE TRIGGER trg_tenant_branding_agency_only
    BEFORE INSERT OR UPDATE OF tenant_id ON public.tenant_branding
    FOR EACH ROW
    EXECUTE FUNCTION public.tenant_branding_enforce_agency_tenant();

COMMENT ON TABLE public.tenant_branding IS
    'Agency-level white-label settings (M1: colors + naming + email identity fields; logo in M2).';

DROP TRIGGER IF EXISTS trg_tenant_branding_updated_at ON public.tenant_branding;
CREATE TRIGGER trg_tenant_branding_updated_at
    BEFORE UPDATE ON public.tenant_branding
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Immutable audit trail (append-only via service role / controlled writes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_branding_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    action text NOT NULL CHECK (action IN ('create', 'update')),
    before_json jsonb,
    after_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_branding_audit_tenant_created
    ON public.tenant_branding_audit (tenant_id, created_at DESC);

COMMENT ON TABLE public.tenant_branding_audit IS
    'Append-only branding change history (before/after snapshots).';

ALTER TABLE public.tenant_branding_audit ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Resolve whether a user may read branding for a given agency tenant
--    (direct agency visibility, or visibility on any child seller under that agency)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_resolve_branding_agency(
    p_user_id uuid,
    p_agency_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_agency_tenant_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenants a WHERE a.id = p_agency_tenant_id AND a.type = 'agency')
    AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR public.tenant_is_visible_to_user(p_agency_tenant_id, p_user_id)
        OR EXISTS (
            SELECT 1
            FROM public.tenants s
            WHERE s.type = 'seller'
              AND s.parent_tenant_id = p_agency_tenant_id
              AND public.tenant_is_visible_to_user(s.id, p_user_id)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_resolve_branding_agency(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_resolve_branding_agency(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.user_can_resolve_branding_agency(uuid, uuid) IS
    'True if the user may read agency branding for p_agency_tenant_id (agency staff, child seller members, AM/AC, admins).';

-- ---------------------------------------------------------------------------
-- 4. Permissions + role grants (system roles only)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (action, description)
VALUES
    ('view_brand_settings', 'View agency white-label / branding settings'),
    ('edit_brand_settings', 'Edit agency white-label / branding settings')
ON CONFLICT (action) DO NOTHING;

DO $$
DECLARE
    v_view_id uuid;
    v_edit_id uuid;
    v_agency_admin_id uuid;
    v_am_id uuid;
    v_ac_id uuid;
    v_seller_admin_id uuid;
    v_seller_user_id uuid;
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    SELECT id INTO v_view_id FROM public.permissions WHERE action = 'view_brand_settings';
    SELECT id INTO v_edit_id FROM public.permissions WHERE action = 'edit_brand_settings';

    SELECT id INTO v_agency_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Agency Admin';
    SELECT id INTO v_am_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Manager';
    SELECT id INTO v_ac_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Coordinator';
    SELECT id INTO v_seller_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Seller Admin';
    SELECT id INTO v_seller_user_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Seller User';

    IF v_view_id IS NOT NULL THEN
        IF v_agency_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_agency_admin_id, v_view_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_am_id, v_view_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_ac_id, v_view_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_seller_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_admin_id, v_view_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_seller_user_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_user_id, v_view_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_edit_id IS NOT NULL AND v_agency_admin_id IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_agency_admin_id, v_edit_id) ON CONFLICT DO NOTHING;
    END IF;

    PERFORM set_config('app.allow_system_role_permission_mutation', 'off', true);
END $$;
