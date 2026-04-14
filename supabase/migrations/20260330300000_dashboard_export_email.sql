-- Dashboard export / email digest: permission + account-scoped check + optional schedules for cron.

INSERT INTO public.permissions (action, description) VALUES
    ('dashboard.export_email', 'Export dashboard summary and send scheduled digest emails for accessible shops')
ON CONFLICT (action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.action = 'dashboard.export_email'
WHERE r.tenant_id IS NULL AND r.name IN ('Account Manager', 'Agency Admin', 'Seller Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- True if p_user_id holds p_permission_action for data governed by this seller account
-- (direct seller membership, parent-agency membership, or AM/AC assignment + agency role grants).
CREATE OR REPLACE FUNCTION public.user_has_permission_for_account(
    p_user_id uuid,
    p_account_id uuid,
    p_permission_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller'
            JOIN public.tenant_memberships tm ON tm.tenant_id = s.id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller' AND s.parent_tenant_id IS NOT NULL
            JOIN public.tenant_memberships tm ON tm.tenant_id = s.parent_tenant_id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.tenants s ON s.id = a.tenant_id AND s.type = 'seller'
            JOIN public.user_seller_assignments usa ON usa.seller_tenant_id = s.id
            JOIN public.tenant_memberships tm ON tm.id = usa.tenant_membership_id AND tm.user_id = p_user_id AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.action = p_permission_action
            WHERE a.id = p_account_id
        );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.user_has_permission_for_account(uuid, uuid, text) IS
    'Whether p_user_id has permission action on seller account p_account_id (seller, parent agency, or AM/AC assignment path).';

-- Scheduled daily digests (processed by backend cron with service role).
CREATE TABLE IF NOT EXISTS public.dashboard_email_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.tiktok_shops(id) ON DELETE CASCADE,
    recipient_email text NOT NULL,
    timezone text NOT NULL DEFAULT 'America/Los_Angeles',
    hour_utc smallint NOT NULL DEFAULT 14 CHECK (hour_utc >= 0 AND hour_utc < 24),
    enabled boolean NOT NULL DEFAULT true,
    last_sent_on date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_email_schedules_cron
    ON public.dashboard_email_schedules (enabled, hour_utc)
    WHERE enabled = true;

COMMENT ON TABLE public.dashboard_email_schedules IS
    'Daily automated dashboard summary emails; backend cron sends when UTC hour matches hour_utc.';

ALTER TABLE public.dashboard_email_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard_email_schedules_select_own" ON public.dashboard_email_schedules;
CREATE POLICY "dashboard_email_schedules_select_own" ON public.dashboard_email_schedules
    FOR SELECT TO authenticated
    USING (created_by = auth.uid());

DROP POLICY IF EXISTS "dashboard_email_schedules_insert_own" ON public.dashboard_email_schedules;
CREATE POLICY "dashboard_email_schedules_insert_own" ON public.dashboard_email_schedules
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "dashboard_email_schedules_update_own" ON public.dashboard_email_schedules;
CREATE POLICY "dashboard_email_schedules_update_own" ON public.dashboard_email_schedules
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "dashboard_email_schedules_delete_own" ON public.dashboard_email_schedules;
CREATE POLICY "dashboard_email_schedules_delete_own" ON public.dashboard_email_schedules
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());
