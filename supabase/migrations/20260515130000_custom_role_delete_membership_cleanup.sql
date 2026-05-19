-- When a custom role is soft-deleted:
-- 1) Remove all membership_roles rows for that role (and rely on primary-role sync).
-- 2) Remove any tenant_memberships still using it as primary (user leaves the tenant —
--    matches product expectation for members who only had this custom role).
-- 3) Idempotent delete_custom_role: no error if role is already soft-deleted.
-- Also: if deleting the last active membership_role leaves no roles, drop the membership
-- (avoids NOT NULL violation on tenant_memberships.role_id).

CREATE OR REPLACE FUNCTION public.sync_membership_primary_role_from_membership_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_membership_id uuid;
    v_primary_role_id uuid;
BEGIN
    v_membership_id := COALESCE(NEW.membership_id, OLD.membership_id);

    SELECT mr.role_id
    INTO v_primary_role_id
    FROM public.membership_roles mr
    WHERE mr.membership_id = v_membership_id
      AND mr.revoked_at IS NULL
      AND EXISTS (
          SELECT 1 FROM public.roles r
          WHERE r.id = mr.role_id AND r.deleted_at IS NULL
      )
    ORDER BY mr.created_at DESC, mr.id DESC
    LIMIT 1;

    PERFORM set_config('app.skip_membership_role_reverse_sync', 'on', true);

    IF v_primary_role_id IS NULL THEN
        DELETE FROM public.tenant_memberships WHERE id = v_membership_id;
    ELSE
        UPDATE public.tenant_memberships tm
        SET role_id = v_primary_role_id,
            updated_at = now()
        WHERE tm.id = v_membership_id
          AND tm.role_id IS DISTINCT FROM v_primary_role_id;
    END IF;

    PERFORM set_config('app.skip_membership_role_reverse_sync', 'off', true);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_custom_role(
    p_role_id uuid,
    p_replaced_by_role_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- All assignments to this custom role (active and historical rows).
    DELETE FROM public.membership_roles WHERE role_id = p_role_id;

    -- Memberships whose primary still points at this role (e.g. inconsistent backfill).
    DELETE FROM public.tenant_memberships WHERE role_id = p_role_id;

    UPDATE public.roles
    SET deleted_at = now(),
        replaced_by_role_id = p_replaced_by_role_id,
        version = version + 1,
        updated_at = now()
    WHERE id = p_role_id
      AND type = 'custom'
      AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_role(p_role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_tid uuid;
    v_deleted timestamptz;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id, deleted_at
    INTO v_tid, v_deleted
    FROM public.roles
    WHERE id = p_role_id
      AND type = 'custom';

    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Custom role not found';
    END IF;

    IF v_deleted IS NOT NULL THEN
        RETURN;
    END IF;

    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND role = 'admin')
        OR public.user_is_platform_super_admin(v_caller)
        OR public.user_can_manage_tenant_members(v_tid, v_caller)
    ) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    PERFORM public.soft_delete_custom_role(p_role_id, NULL);
END;
$$;

COMMENT ON FUNCTION public.soft_delete_custom_role(uuid, uuid) IS
    'Soft-delete a custom role and remove all membership_roles + tenant_memberships that depended on it as sole or supplemental assignment.';
