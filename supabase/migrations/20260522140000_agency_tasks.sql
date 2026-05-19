-- Agency Kanban tasks: seller-scoped, tenant-isolated (Express + service role; no JWT table access).

-- ---------------------------------------------------------------------------
-- Permissions (granular tasks.* + legacy tasks.manage alias in application)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (action, description)
VALUES
    ('tasks.view', 'View agency task boards and task details'),
    ('tasks.create', 'Create agency tasks'),
    ('tasks.edit', 'Edit agency tasks and kanban status'),
    ('tasks.assign', 'Assign or reassign agency tasks'),
    ('tasks.delete', 'Delete agency tasks'),
    ('tasks.view_private', 'View private agency tasks created by others'),
    ('tasks.create_private', 'Create or mark tasks private')
ON CONFLICT (action) DO NOTHING;

-- System role rows in role_permissions are immutable unless app.allow_system_role_permission_mutation = on
-- (see trg_prevent_system_role_permission_mutation in 20260417100000_rbac_v2_full_alignment.sql).
DO $$
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.tenant_id IS NULL AND r.name = 'Agency Admin'
      AND p.action IN (
        'tasks.manage',
        'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.delete',
        'tasks.view_private', 'tasks.create_private'
      )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.tenant_id IS NULL AND r.name = 'Account Manager'
      AND p.action IN (
        'tasks.manage',
        'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.delete',
        'tasks.view_private', 'tasks.create_private'
      )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    DELETE FROM public.role_permissions rp
    USING public.roles r, public.permissions p
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
      AND r.tenant_id IS NULL AND r.name = 'Account Coordinator' AND p.action = 'tasks.manage';

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.tenant_id IS NULL AND r.name = 'Account Coordinator'
      AND p.action IN ('tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    DELETE FROM public.role_permissions rp
    USING public.roles r, public.permissions p
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
      AND r.tenant_id IS NULL AND r.name = 'Seller Admin' AND p.action = 'tasks.manage';
END $$;

-- ---------------------------------------------------------------------------
-- Visibility: seller child of agency AND user sees seller via assignments (or AA); platform SA bypass.
-- ---------------------------------------------------------------------------
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
           OR (
               EXISTS (
                   SELECT 1
                   FROM public.profiles prof
                   JOIN public.tenants ag ON ag.id = prof.tenant_id
                   WHERE prof.id = p_user_id
                     AND prof.tenant_id = p_agency_tenant_id
                     AND ag.type = 'agency'
               )
               AND p_seller_tenant_id = ANY (public.get_assigned_seller_ids(p_user_id))
           )
       );
$$;

COMMENT ON FUNCTION public.agency_task_seller_accessible_for_user(uuid, uuid, uuid) IS
    'True when seller tenant is linked to the agency and the user may access that seller (assignment scope / agency admin breadth via get_assigned_seller_ids), or platform super admin.';

REVOKE ALL ON FUNCTION public.agency_task_seller_accessible_for_user(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_task_seller_accessible_for_user(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- agency_tasks table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    seller_tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
    title text NOT NULL,
    description text NULL,
    status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    created_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    assigned_to uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    is_private boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agency_tasks_title_len CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 500),
    CONSTRAINT agency_tasks_description_len CHECK (
        description IS NULL OR char_length(description) <= 16000
    )
);

CREATE INDEX IF NOT EXISTS idx_agency_tasks_tenant_seller_status
    ON public.agency_tasks (tenant_id, seller_tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agency_tasks_tenant_updated
    ON public.agency_tasks (tenant_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.agency_tasks_enforce_row_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_agency_ok boolean;
    v_seller_ok boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.type = 'agency'
    )
    INTO v_agency_ok;
    IF NOT v_agency_ok THEN
        RAISE EXCEPTION 'agency_tasks.tenant_id must reference an agency tenant';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.tenants s
        WHERE s.id = NEW.seller_tenant_id
          AND s.type = 'seller'
          AND s.parent_tenant_id = NEW.tenant_id
    )
    INTO v_seller_ok;
    IF NOT v_seller_ok THEN
        RAISE EXCEPTION 'agency_tasks.seller_tenant_id must be a seller linked to tenant_id agency';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_tasks_invariants ON public.agency_tasks;
CREATE TRIGGER trg_agency_tasks_invariants
    BEFORE INSERT OR UPDATE OF tenant_id, seller_tenant_id ON public.agency_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.agency_tasks_enforce_row_invariants();

CREATE OR REPLACE FUNCTION public.agency_tasks_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'todo' THEN
        RAISE EXCEPTION 'agency_tasks INSERT must start in status todo';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_tasks_insert_defaults ON public.agency_tasks;
CREATE TRIGGER trg_agency_tasks_insert_defaults
    BEFORE INSERT ON public.agency_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.agency_tasks_insert_defaults();

CREATE OR REPLACE FUNCTION public.agency_tasks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_tasks_updated ON public.agency_tasks;
CREATE TRIGGER trg_agency_tasks_updated
    BEFORE UPDATE ON public.agency_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.agency_tasks_touch_updated_at();

CREATE OR REPLACE FUNCTION public.agency_tasks_enforce_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    IF (OLD.status = 'todo' AND NEW.status <> 'in_progress')
       OR (OLD.status = 'in_progress' AND NEW.status <> 'done')
       OR (OLD.status = 'done' AND NEW.status <> 'in_progress')
    THEN
        RAISE EXCEPTION 'Invalid task status transition: % → %', OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agency_tasks_enforce_status_transition IS
    'PRD Kanban: todo→in_progress; in_progress→done or todo; done→in_progress (reopen).';

DROP TRIGGER IF EXISTS trg_agency_tasks_status ON public.agency_tasks;
CREATE TRIGGER trg_agency_tasks_status
    BEFORE UPDATE OF status ON public.agency_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.agency_tasks_enforce_status_transition();

COMMENT ON TABLE public.agency_tasks IS 'Agency team Kanban tasks; enforced via API/service_role (Phase 2, agency-only UX).';

ALTER TABLE public.agency_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agency_tasks FROM PUBLIC;
REVOKE ALL ON TABLE public.agency_tasks FROM anon, authenticated;
GRANT ALL ON TABLE public.agency_tasks TO service_role;

CREATE POLICY "Service role full access to agency_tasks"
    ON public.agency_tasks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
