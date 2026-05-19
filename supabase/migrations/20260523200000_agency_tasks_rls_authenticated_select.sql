-- Defense in depth: agency_tasks readable under JWT (PostgREST) with the same rules as GET /api/tasks.
-- Writes remain service_role + Express (no authenticated INSERT/UPDATE/DELETE grants).

CREATE OR REPLACE FUNCTION public.user_is_account_coordinator_only_on_agency(
    p_user_id uuid,
    p_agency_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH names AS (
        SELECT r.name
        FROM public.tenant_memberships tm
        JOIN public.roles r ON r.id = tm.role_id
        WHERE tm.user_id = p_user_id
          AND tm.tenant_id = p_agency_tenant_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
        UNION
        SELECT r.name
        FROM public.tenant_memberships tm
        JOIN public.membership_roles mr
            ON mr.membership_id = tm.id
           AND mr.revoked_at IS NULL
        JOIN public.roles r ON r.id = mr.role_id
        WHERE tm.user_id = p_user_id
          AND tm.tenant_id = p_agency_tenant_id
          AND tm.status = 'active'
          AND r.tenant_id IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM names WHERE name = 'Account Coordinator')
       AND NOT EXISTS (SELECT 1 FROM names WHERE name IN ('Agency Admin', 'Account Manager'));
$$;

COMMENT ON FUNCTION public.user_is_account_coordinator_only_on_agency(uuid, uuid) IS
    'True when the user holds system Account Coordinator on the agency tenant but not Agency Admin / Account Manager (PRD §5.3 coordinator row scope).';

CREATE OR REPLACE FUNCTION public.agency_task_select_allowed_for_user(
    p_user_id uuid,
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid,
    p_is_private boolean,
    p_created_by uuid,
    p_assigned_to uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_user_id IS NOT NULL
       AND p_agency_tenant_id IS NOT NULL
       AND p_seller_tenant_id IS NOT NULL
       AND (
           public.user_is_platform_super_admin(p_user_id)
           OR (
               public.agency_task_seller_accessible_for_user(
                   p_agency_tenant_id,
                   p_seller_tenant_id,
                   p_user_id
               )
               AND EXISTS (
                   SELECT 1
                   FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_agency_tenant_id) ep
                   WHERE ep.action IN ('tasks.view', 'tasks.manage')
               )
               AND (
                   NOT p_is_private
                   OR EXISTS (
                       SELECT 1
                       FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_agency_tenant_id) ep2
                       WHERE ep2.action IN ('tasks.view_private', 'tasks.manage')
                   )
                   OR p_created_by IS NOT DISTINCT FROM p_user_id
                   OR p_assigned_to IS NOT DISTINCT FROM p_user_id
               )
               AND (
                   NOT public.user_is_account_coordinator_only_on_agency(p_user_id, p_agency_tenant_id)
                   OR p_created_by IS NOT DISTINCT FROM p_user_id
                   OR p_assigned_to IS NOT DISTINCT FROM p_user_id
               )
           )
       );
$$;

COMMENT ON FUNCTION public.agency_task_select_allowed_for_user(uuid, uuid, uuid, boolean, uuid, uuid) IS
    'Row-level SELECT for agency_tasks: seller access RPC + tasks.view/manage + private/coordinator rules (aligns with Express list/detail).';

REVOKE ALL ON FUNCTION public.user_is_account_coordinator_only_on_agency(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_account_coordinator_only_on_agency(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.agency_task_select_allowed_for_user(uuid, uuid, uuid, boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_task_select_allowed_for_user(uuid, uuid, uuid, boolean, uuid, uuid) TO authenticated;

GRANT SELECT ON public.agency_tasks TO authenticated;

DROP POLICY IF EXISTS "agency_tasks_select_authenticated" ON public.agency_tasks;
CREATE POLICY "agency_tasks_select_authenticated"
    ON public.agency_tasks
    FOR SELECT
    TO authenticated
    USING (
        public.agency_task_select_allowed_for_user(
            auth.uid(),
            tenant_id,
            seller_tenant_id,
            is_private,
            created_by,
            assigned_to
        )
    );

COMMENT ON POLICY "agency_tasks_select_authenticated" ON public.agency_tasks IS
    'Authenticated reads mirror API task visibility; mutations stay service_role.';

COMMENT ON TABLE public.agency_tasks IS
    'Agency Kanban tasks: Express (service_role) for writes; authenticated SELECT via RLS + agency_task_select_allowed_for_user.';
