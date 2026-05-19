-- PRD §5.1: PRD-style permission *rows* (view_tasks, create_task, …) mirrored onto roles that already hold tasks.*,
--             so effective permissions and RLS can evaluate either catalog or PRD names.
-- PRD §12 / defense in depth: authenticated INSERT/UPDATE/DELETE on agency_tasks (Express remains primary; service_role bypasses RLS).

-- ---------------------------------------------------------------------------
-- §5.1 — Alias permission rows (same semantics as tasks.* catalog slugs)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (action, description)
VALUES
    ('view_tasks', 'PRD alias: view agency task boards (mirrors tasks.view)'),
    ('create_task', 'PRD alias: create agency tasks (mirrors tasks.create)'),
    ('edit_task', 'PRD alias: edit agency tasks (mirrors tasks.edit)'),
    ('assign_task', 'PRD alias: assign agency tasks (mirrors tasks.assign)'),
    ('delete_task', 'PRD alias: delete agency tasks (mirrors tasks.delete)'),
    ('view_private_tasks', 'PRD alias: view others'' private tasks (mirrors tasks.view_private)'),
    ('create_private_task', 'PRD alias: create/mark private tasks (mirrors tasks.create_private)')
ON CONFLICT (action) DO NOTHING;

DO $$
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    -- Mirror each tasks.* grant onto the matching PRD alias for the same role.
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT rp.role_id, pa.id
    FROM public.role_permissions rp
    JOIN public.permissions pc ON pc.id = rp.permission_id
    JOIN public.permissions pa ON (
        (pc.action = 'tasks.view' AND pa.action = 'view_tasks')
        OR (pc.action = 'tasks.create' AND pa.action = 'create_task')
        OR (pc.action = 'tasks.edit' AND pa.action = 'edit_task')
        OR (pc.action = 'tasks.assign' AND pa.action = 'assign_task')
        OR (pc.action = 'tasks.delete' AND pa.action = 'delete_task')
        OR (pc.action = 'tasks.view_private' AND pa.action = 'view_private_tasks')
        OR (pc.action = 'tasks.create_private' AND pa.action = 'create_private_task')
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Roles that only carry the legacy umbrella still get all PRD aliases (same as granular tasks.*).
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT DISTINCT rp.role_id, pa.id
    FROM public.role_permissions rp
    JOIN public.permissions pm ON pm.id = rp.permission_id AND pm.action = 'tasks.manage'
    CROSS JOIN public.permissions pa
    WHERE pa.action IN (
        'view_tasks', 'create_task', 'edit_task', 'assign_task', 'delete_task',
        'view_private_tasks', 'create_private_task'
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- SELECT helper: accept catalog + PRD alias actions in permission checks
-- ---------------------------------------------------------------------------
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
                   WHERE ep.action IN ('tasks.view', 'view_tasks', 'tasks.manage')
               )
               AND (
                   NOT p_is_private
                   OR EXISTS (
                       SELECT 1
                       FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_agency_tenant_id) ep2
                       WHERE ep2.action IN ('tasks.view_private', 'view_private_tasks', 'tasks.manage')
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
    'Row-level SELECT for agency_tasks: seller access + tasks.view|view_tasks|tasks.manage + private/coordinator rules.';

-- RLS UPDATE cannot reference OLD inside WITH CHECK; keep agency/seller immutable in a trigger.
CREATE OR REPLACE FUNCTION public.agency_tasks_enforce_immutable_agency_seller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.seller_tenant_id IS DISTINCT FROM NEW.seller_tenant_id THEN
        RAISE EXCEPTION 'agency_tasks.tenant_id and seller_tenant_id are immutable on UPDATE';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_tasks_immutable_agency_seller ON public.agency_tasks;
CREATE TRIGGER trg_agency_tasks_immutable_agency_seller
    BEFORE UPDATE ON public.agency_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.agency_tasks_enforce_immutable_agency_seller();

-- ---------------------------------------------------------------------------
-- Authenticated DML helpers (SECURITY DEFINER: encapsulate seller RPC + RBAC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agency_task_authenticated_insert_allowed(
    p_user_id uuid,
    p_tenant_id uuid,
    p_seller_tenant_id uuid,
    p_is_private boolean,
    p_created_by uuid,
    p_status text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_user_id IS NOT NULL
       AND (
           public.user_is_platform_super_admin(p_user_id)
           OR (
               p_status = 'todo'
               AND p_created_by IS NOT NULL
               AND p_created_by = p_user_id
               AND public.agency_task_seller_accessible_for_user(p_tenant_id, p_seller_tenant_id, p_user_id)
               AND EXISTS (
                   SELECT 1
                   FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) ep
                   WHERE ep.action IN ('tasks.create', 'create_task', 'tasks.manage')
               )
               AND (
                   NOT p_is_private
                   OR EXISTS (
                       SELECT 1
                       FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) ep2
                       WHERE ep2.action IN ('tasks.create_private', 'create_private_task', 'tasks.manage')
                   )
               )
           )
       );
$$;

CREATE OR REPLACE FUNCTION public.agency_task_authenticated_update_row_allowed(
    p_user_id uuid,
    p_tenant_id uuid,
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
       AND (
           public.user_is_platform_super_admin(p_user_id)
           OR (
               public.agency_task_select_allowed_for_user(
                   p_user_id, p_tenant_id, p_seller_tenant_id, p_is_private, p_created_by, p_assigned_to
               )
               AND EXISTS (
                   SELECT 1
                   FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) ep
                   WHERE ep.action IN (
                       'tasks.edit', 'edit_task', 'tasks.assign', 'assign_task', 'tasks.manage'
                   )
               )
           )
       );
$$;

CREATE OR REPLACE FUNCTION public.agency_task_authenticated_delete_allowed(
    p_user_id uuid,
    p_tenant_id uuid,
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
       AND (
           public.user_is_platform_super_admin(p_user_id)
           OR (
               public.agency_task_select_allowed_for_user(
                   p_user_id, p_tenant_id, p_seller_tenant_id, p_is_private, p_created_by, p_assigned_to
               )
               AND EXISTS (
                   SELECT 1
                   FROM public.get_user_effective_permissions_on_tenant(p_user_id, p_tenant_id) ep
                   WHERE ep.action IN ('tasks.delete', 'delete_task', 'tasks.manage')
               )
           )
       );
$$;

REVOKE ALL ON FUNCTION public.agency_task_authenticated_insert_allowed(uuid, uuid, uuid, boolean, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_task_authenticated_insert_allowed(uuid, uuid, uuid, boolean, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.agency_task_authenticated_update_row_allowed(uuid, uuid, uuid, boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_task_authenticated_update_row_allowed(uuid, uuid, uuid, boolean, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.agency_task_authenticated_delete_allowed(uuid, uuid, uuid, boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_task_authenticated_delete_allowed(uuid, uuid, uuid, boolean, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.agency_tasks_enforce_immutable_agency_seller() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- RLS: authenticated mutations (service_role keeps FOR ALL policy; bypasses RLS)
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON public.agency_tasks TO authenticated;

DROP POLICY IF EXISTS "agency_tasks_insert_authenticated" ON public.agency_tasks;
CREATE POLICY "agency_tasks_insert_authenticated"
    ON public.agency_tasks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.agency_task_authenticated_insert_allowed(
            auth.uid(),
            tenant_id,
            seller_tenant_id,
            is_private,
            created_by,
            status
        )
    );

DROP POLICY IF EXISTS "agency_tasks_update_authenticated" ON public.agency_tasks;
CREATE POLICY "agency_tasks_update_authenticated"
    ON public.agency_tasks
    FOR UPDATE
    TO authenticated
    USING (
        public.agency_task_authenticated_update_row_allowed(
            auth.uid(),
            tenant_id,
            seller_tenant_id,
            is_private,
            created_by,
            assigned_to
        )
    )
    WITH CHECK (
        public.agency_task_authenticated_update_row_allowed(
            auth.uid(),
            tenant_id,
            seller_tenant_id,
            is_private,
            created_by,
            assigned_to
        )
    );

DROP POLICY IF EXISTS "agency_tasks_delete_authenticated" ON public.agency_tasks;
CREATE POLICY "agency_tasks_delete_authenticated"
    ON public.agency_tasks
    FOR DELETE
    TO authenticated
    USING (
        public.agency_task_authenticated_delete_allowed(
            auth.uid(),
            tenant_id,
            seller_tenant_id,
            is_private,
            created_by,
            assigned_to
        )
    );

COMMENT ON POLICY "agency_tasks_insert_authenticated" ON public.agency_tasks IS
    'Authenticated INSERT: seller scope + tasks.create|create_task|tasks.manage + private create rules + created_by = caller.';
COMMENT ON POLICY "agency_tasks_update_authenticated" ON public.agency_tasks IS
    'Authenticated UPDATE: row visibility + edit|assign family; tenant/seller immutability enforced by trigger.';
COMMENT ON POLICY "agency_tasks_delete_authenticated" ON public.agency_tasks IS
    'Authenticated DELETE: row visibility + tasks.delete|delete_task|tasks.manage.';

COMMENT ON TABLE public.agency_tasks IS
    'Agency Kanban tasks: Express (service_role) primary; authenticated SELECT/INSERT/UPDATE/DELETE via RLS helpers aligned with API rules.';

COMMENT ON POLICY "agency_tasks_select_authenticated" ON public.agency_tasks IS
    'Authenticated SELECT (migration 20260523200000); INSERT/UPDATE/DELETE policies added in 20260523210000.';
