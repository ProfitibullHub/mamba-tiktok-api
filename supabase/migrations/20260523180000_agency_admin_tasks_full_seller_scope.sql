-- PRD §5.3: Agency Admin — full access to all tasks for every seller linked under the agency.
-- 1) get_assigned_seller_ids: treat Agency Admin when granted via membership_roles (not only primary role_id).
-- 2) agency_task_seller_accessible_for_user: allow any child seller when user is Agency Admin on p_agency_tenant_id
--    (primary or membership_roles); AM/AC still require assignment scope via get_assigned_seller_ids + active membership.

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
                WHERE pc.tenant_type = 'agency'
                  AND (
                      EXISTS (
                          SELECT 1
                          FROM public.tenant_memberships tm
                          JOIN public.roles r ON r.id = tm.role_id
                          WHERE tm.tenant_id = pc.tenant_id
                            AND tm.user_id = p_user_id
                            AND tm.status = 'active'
                            AND r.tenant_id IS NULL
                            AND r.name = 'Agency Admin'
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM public.tenant_memberships tm
                          JOIN public.membership_roles mr
                            ON mr.membership_id = tm.id
                           AND mr.revoked_at IS NULL
                          JOIN public.roles r ON r.id = mr.role_id
                          WHERE tm.tenant_id = pc.tenant_id
                            AND tm.user_id = p_user_id
                            AND tm.status = 'active'
                            AND r.tenant_id IS NULL
                            AND r.name = 'Agency Admin'
                      )
                  )
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

COMMENT ON FUNCTION public.get_assigned_seller_ids(uuid) IS
    'Seller tenant UUIDs the user may access: seller-profile home tenant; agency-profile Agency Admin = all child sellers (primary or membership_roles); else user_seller_assignments for that agency.';

CREATE OR REPLACE FUNCTION public.agency_task_seller_accessible_for_user(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_agency_tenant_id IS NOT NULL
       AND p_seller_tenant_id IS NOT NULL
       AND p_user_id IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM public.tenants s
           WHERE s.id = p_seller_tenant_id
             AND s.type = 'seller'
             AND s.parent_tenant_id = p_agency_tenant_id
       )
       AND (
           public.user_is_platform_super_admin(p_user_id)
           OR EXISTS (
               SELECT 1
               FROM public.tenant_memberships tm
               WHERE tm.tenant_id = p_agency_tenant_id
                 AND tm.user_id = p_user_id
                 AND tm.status = 'active'
                 AND (
                     EXISTS (
                         SELECT 1
                         FROM public.roles r
                         WHERE r.id = tm.role_id
                           AND r.tenant_id IS NULL
                           AND r.name = 'Agency Admin'
                     )
                     OR EXISTS (
                         SELECT 1
                         FROM public.membership_roles mr
                         JOIN public.roles r ON r.id = mr.role_id
                         WHERE mr.membership_id = tm.id
                           AND mr.revoked_at IS NULL
                           AND r.tenant_id IS NULL
                           AND r.name = 'Agency Admin'
                     )
                 )
           )
           OR (
               EXISTS (
                   SELECT 1
                   FROM public.tenant_memberships tm
                   WHERE tm.tenant_id = p_agency_tenant_id
                     AND tm.user_id = p_user_id
                     AND tm.status = 'active'
               )
               AND p_seller_tenant_id = ANY (public.get_assigned_seller_ids(p_user_id))
           )
       );
$$;

COMMENT ON FUNCTION public.agency_task_seller_accessible_for_user(uuid, uuid, uuid) IS
    'True when seller is a child of the agency and: platform super admin; or Agency Admin on this agency (any linked seller); or active agency member and seller in get_assigned_seller_ids (AM/AC assignment scope).';
