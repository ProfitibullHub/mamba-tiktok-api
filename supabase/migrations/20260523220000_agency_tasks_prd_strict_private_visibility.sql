-- PRD §5.2: Private tasks are visible only to creator and assignee (not via view_private_tasks / tasks.manage peek).
-- Aligns RLS SELECT with Express list/detail/delete/patch.

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
    'PRD §5.2 / §5.3: row SELECT when seller-accessible + tasks.view; private rows only for creator or assignee; coordinator org-wide carve-out for public own rows.';

UPDATE public.permissions
SET description = 'Reserved (custom roles); private task *read* visibility is PRD §5.2 — creator or assignee only.'
WHERE action = 'tasks.view_private';

UPDATE public.permissions
SET description = 'Reserved (custom roles); mirrors tasks.view_private naming; read visibility PRD §5.2.'
WHERE action = 'view_private_tasks';
