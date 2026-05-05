-- Fix multi-role collapse bug:
-- membership_roles -> tenant_memberships.role_id sync was triggering a reverse sync
-- that revoked all other active roles, effectively forcing single-role.
--
-- This patch preserves multiple active membership_roles while still keeping
-- tenant_memberships.role_id aligned as a primary/display role.

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
    ORDER BY mr.created_at DESC, mr.id DESC
    LIMIT 1;

    -- Prevent reverse-sync trigger from collapsing active roles.
    PERFORM set_config('app.skip_membership_role_reverse_sync', 'on', true);

    UPDATE public.tenant_memberships tm
    SET role_id = v_primary_role_id,
        updated_at = now()
    WHERE tm.id = v_membership_id
      AND tm.role_id IS DISTINCT FROM v_primary_role_id;

    PERFORM set_config('app.skip_membership_role_reverse_sync', 'off', true);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_membership_roles_from_primary_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_skip text;
BEGIN
    v_skip := current_setting('app.skip_membership_role_reverse_sync', true);
    IF COALESCE(v_skip, 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    IF NEW.role_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Keep multi-role sets intact; only ensure the primary role exists as active.
    INSERT INTO public.membership_roles (membership_id, role_id, snapshot_json)
    SELECT
        NEW.id,
        NEW.role_id,
        jsonb_build_object('source', 'primary_role_sync')
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.membership_roles mr
        WHERE mr.membership_id = NEW.id
          AND mr.role_id = NEW.role_id
          AND mr.revoked_at IS NULL
    );

    RETURN NEW;
END;
$$;
