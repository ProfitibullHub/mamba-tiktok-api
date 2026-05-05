-- Seller User (read-only) can view synced TikTok Shop/Ads dashboard data without tiktok.auth (OAuth).
-- tiktok.auth remains for connect/reconnect/sync/clear and other mutating routes.

INSERT INTO public.permissions (action, description)
VALUES
    ('tiktok.shop.data', 'View synced TikTok Shop data for accounts you can access'),
    ('tiktok.ads.data', 'View synced TikTok Ads data for accounts you can access'),
    ('view_pnl', 'View P&L / finance dashboard data for accounts you can access')
ON CONFLICT (action) DO NOTHING;

DO $$
DECLARE
    v_shop_data_id uuid;
    v_ads_data_id uuid;
    v_view_pnl_id uuid;
    v_seller_user_id uuid;
    v_seller_admin_id uuid;
    v_am_id uuid;
    v_ac_id uuid;
    v_agency_admin_id uuid;
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    SELECT id INTO v_shop_data_id FROM public.permissions WHERE action = 'tiktok.shop.data';
    SELECT id INTO v_ads_data_id FROM public.permissions WHERE action = 'tiktok.ads.data';
    SELECT id INTO v_view_pnl_id FROM public.permissions WHERE action = 'view_pnl';

    SELECT id INTO v_seller_user_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Seller User';
    SELECT id INTO v_seller_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Seller Admin';
    SELECT id INTO v_am_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Manager';
    SELECT id INTO v_ac_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Coordinator';
    SELECT id INTO v_agency_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Agency Admin';

    -- Read permissions: seller-facing + agency staff who operate dashboards
    IF v_shop_data_id IS NOT NULL THEN
        IF v_seller_user_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_user_id, v_shop_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_seller_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_admin_id, v_shop_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_am_id, v_shop_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_ac_id, v_shop_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_agency_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_agency_admin_id, v_shop_data_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_ads_data_id IS NOT NULL THEN
        IF v_seller_user_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_user_id, v_ads_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_seller_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_admin_id, v_ads_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_am_id, v_ads_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_ac_id, v_ads_data_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_agency_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_agency_admin_id, v_ads_data_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_view_pnl_id IS NOT NULL THEN
        IF v_seller_user_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_user_id, v_view_pnl_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_seller_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_seller_admin_id, v_view_pnl_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_am_id, v_view_pnl_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_ac_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_ac_id, v_view_pnl_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_agency_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_agency_admin_id, v_view_pnl_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    PERFORM set_config('app.allow_system_role_permission_mutation', 'off', true);
END $$;
