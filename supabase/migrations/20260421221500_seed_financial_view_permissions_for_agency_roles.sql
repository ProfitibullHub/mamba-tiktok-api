-- Ensure baseline financial visibility permissions exist for agency roles.
-- This allows "unchecked restrictions" to actually restore visibility.

DO $$
DECLARE
    v_view_cogs uuid;
    v_view_margin uuid;
    v_view_custom uuid;
    v_agency_admin uuid;
    v_am uuid;
    v_ac uuid;
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    SELECT id INTO v_view_cogs FROM public.permissions WHERE action = 'view_cogs';
    SELECT id INTO v_view_margin FROM public.permissions WHERE action = 'view_margin';
    SELECT id INTO v_view_custom FROM public.permissions WHERE action = 'view_custom_line_items';

    SELECT id INTO v_agency_admin FROM public.roles WHERE tenant_id IS NULL AND name = 'Agency Admin';
    SELECT id INTO v_am FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Manager';
    SELECT id INTO v_ac FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Coordinator';

    IF v_view_cogs IS NOT NULL THEN
        IF v_agency_admin IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_agency_admin, v_view_cogs) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_am, v_view_cogs) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_ac, v_view_cogs) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_view_margin IS NOT NULL THEN
        IF v_agency_admin IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_agency_admin, v_view_margin) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_am, v_view_margin) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_ac, v_view_margin) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_view_custom IS NOT NULL THEN
        IF v_agency_admin IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_agency_admin, v_view_custom) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_am, v_view_custom) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_ac, v_view_custom) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    PERFORM set_config('app.allow_system_role_permission_mutation', 'off', true);
END $$;
