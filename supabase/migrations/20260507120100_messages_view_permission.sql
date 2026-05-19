-- Split PRD view vs send: add messages.view and grant wherever messages.send exists (including custom roles).
-- System role rows in role_permissions are normally immutable (trg_prevent_system_role_permission_mutation);
-- use the same seed escape hatch as other migrations.

INSERT INTO public.permissions (action, description) VALUES
    ('messages.view', 'View unified email-backed messaging conversations')
ON CONFLICT (action) DO NOTHING;

DO $$
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT DISTINCT rp.role_id, p_view.id
    FROM public.role_permissions rp
    JOIN public.permissions p_send ON p_send.id = rp.permission_id AND p_send.action = 'messages.send'
    JOIN public.permissions p_view ON p_view.action = 'messages.view'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;
