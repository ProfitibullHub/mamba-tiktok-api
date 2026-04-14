-- Backfill: ensure every profiles.role = 'admin' user has an active
-- Super Admin membership on the platform tenant.
-- This allows the app to gate on tenant_memberships instead of profiles.role.

INSERT INTO public.tenant_memberships (user_id, tenant_id, role_id, status)
SELECT
    p.id,
    plat.id,
    sa.id,
    'active'
FROM public.profiles p
CROSS JOIN (
    SELECT id FROM public.tenants WHERE type = 'platform' ORDER BY created_at LIMIT 1
) plat
CROSS JOIN (
    SELECT id FROM public.roles WHERE name = 'Super Admin' AND tenant_id IS NULL LIMIT 1
) sa
WHERE p.role = 'admin'
  AND NOT EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.user_id = p.id
        AND tm.tenant_id = plat.id
        AND tm.role_id  = sa.id
  );
