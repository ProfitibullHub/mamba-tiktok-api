-- Allow agencies to keep seeing linked sellers even when seller tenant is inactive/suspended.
-- Access to shop data remains blocked by tenant status checks in API middleware.

CREATE OR REPLACE FUNCTION public.get_assigned_seller_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH profile_ctx AS (
        SELECT p.tenant_id, t.type AS tenant_type
        FROM public.profiles p
        JOIN public.tenants t ON t.id = p.tenant_id
        WHERE p.id = p_user_id
    )
    SELECT COALESCE(
        CASE
            WHEN EXISTS (SELECT 1 FROM profile_ctx WHERE tenant_type = 'seller') THEN
                ARRAY(SELECT tenant_id FROM profile_ctx)
            WHEN EXISTS (
                SELECT 1
                FROM profile_ctx pc
                JOIN public.tenant_memberships tm ON tm.tenant_id = pc.tenant_id
                JOIN public.roles r ON r.id = tm.role_id
                WHERE pc.tenant_type = 'agency'
                  AND tm.user_id = p_user_id
                  AND tm.status = 'active'
                  AND r.tenant_id IS NULL
                  AND r.name = 'Agency Admin'
            ) THEN
                ARRAY(
                    SELECT s.id
                    FROM public.tenants s
                    JOIN profile_ctx pc ON pc.tenant_id = s.parent_tenant_id
                    WHERE pc.tenant_type = 'agency'
                      AND s.type = 'seller'
                )
            ELSE
                ARRAY(
                    SELECT usa.seller_tenant_id
                    FROM public.user_seller_assignments usa
                    JOIN public.tenants s ON s.id = usa.seller_tenant_id
                    JOIN profile_ctx pc ON pc.tenant_id = usa.agency_tenant_id
                    WHERE pc.tenant_type = 'agency'
                      AND usa.user_id = p_user_id
                      AND s.parent_tenant_id = pc.tenant_id
                )
        END,
        ARRAY[]::uuid[]
    );
$$;
