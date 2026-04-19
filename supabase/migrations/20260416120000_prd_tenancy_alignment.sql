-- PRD tenancy alignment:
-- - one canonical tenant per user (profiles.tenant_id)
-- - explicit agency assignment rows keyed by user_id
-- - request-scope helper resolves tenant_id, tenant_type, assigned_seller_ids once
-- - unlink clears seller assignments and disables future scheduled exports
-- - last-admin protections for seller and agency tenants

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id
    ON public.profiles (tenant_id);

WITH ranked_memberships AS (
    SELECT
        tm.user_id,
        tm.tenant_id,
        ROW_NUMBER() OVER (
            PARTITION BY tm.user_id
            ORDER BY
                CASE
                    WHEN tm.status = 'active' THEN 0
                    WHEN tm.status = 'invited' THEN 1
                    WHEN tm.status = 'deactivated' THEN 2
                    ELSE 3
                END,
                CASE
                    WHEN t.type = 'agency' THEN 0
                    WHEN t.type = 'seller' THEN 1
                    ELSE 2
                END,
                tm.updated_at DESC,
                tm.created_at DESC
        ) AS rn
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.status = 'active'
      AND t.type IN ('agency', 'seller')
)
UPDATE public.profiles p
SET tenant_id = rm.tenant_id
FROM ranked_memberships rm
WHERE p.id = rm.user_id
  AND rm.rn = 1
  AND p.tenant_id IS NULL;

WITH ranked_accounts AS (
    SELECT
        ua.user_id,
        a.tenant_id,
        ROW_NUMBER() OVER (
            PARTITION BY ua.user_id
            ORDER BY ua.created_at ASC, a.created_at ASC, a.id ASC
        ) AS rn
    FROM public.user_accounts ua
    JOIN public.accounts a ON a.id = ua.account_id
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE t.type = 'seller'
)
UPDATE public.profiles p
SET tenant_id = ra.tenant_id
FROM ranked_accounts ra
WHERE p.id = ra.user_id
  AND ra.rn = 1
  AND p.tenant_id IS NULL;

CREATE TEMP TABLE _prd_unresolved_profiles AS
SELECT
    p.id,
    gen_random_uuid() AS tenant_id,
    COALESCE(NULLIF(trim(p.full_name), ''), split_part(COALESCE(p.email, 'seller'), '@', 1), 'Seller') AS display_name
FROM public.profiles p
WHERE p.tenant_id IS NULL
  AND p.role <> 'admin'
  AND NOT EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      JOIN public.roles r ON r.id = tm.role_id
      WHERE tm.user_id = p.id
        AND r.name = 'Super Admin'
  );

INSERT INTO public.tenants (id, name, type, status)
SELECT
    up.tenant_id,
    CASE
        WHEN up.display_name = '' THEN 'New Seller'
        ELSE up.display_name
    END,
    'seller',
    'active'
FROM _prd_unresolved_profiles up;

CREATE TEMP TABLE _prd_created_tenants AS
SELECT
    up.id AS user_id,
    up.tenant_id
FROM _prd_unresolved_profiles up;

UPDATE public.profiles p
SET tenant_id = pct.tenant_id
FROM _prd_created_tenants pct
WHERE p.id = pct.user_id
  AND p.tenant_id IS NULL;

INSERT INTO public.tenant_memberships (tenant_id, user_id, role_id, status)
SELECT
    pct.tenant_id,
    pct.user_id,
    r.id,
    'active'
FROM _prd_created_tenants pct
JOIN public.roles r
    ON r.tenant_id IS NULL
   AND r.name = 'Seller Admin'
ON CONFLICT (tenant_id, user_id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE tenant_id IS NULL
          AND role <> 'admin'
          AND NOT EXISTS (
              SELECT 1
              FROM public.tenant_memberships tm
              JOIN public.roles r ON r.id = tm.role_id
              WHERE tm.user_id = profiles.id
                AND r.name = 'Super Admin'
          )
    ) THEN
        RAISE EXCEPTION 'Cannot enforce PRD tenant model: some non-platform profiles still have no canonical tenant_id';
    END IF;
END
$$;

DROP TABLE IF EXISTS _prd_created_tenants;
DROP TABLE IF EXISTS _prd_unresolved_profiles;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_product_users_require_tenant;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_product_users_require_tenant
    CHECK (
        tenant_id IS NOT NULL
        OR role = 'admin'
    );

CREATE OR REPLACE FUNCTION public.enforce_single_active_product_tenant_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type text;
    v_existing_tenant uuid;
BEGIN
    SELECT type INTO v_type
    FROM public.tenants
    WHERE id = NEW.tenant_id;

    IF v_type NOT IN ('agency', 'seller') OR NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;

    SELECT tm.tenant_id
    INTO v_existing_tenant
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = NEW.user_id
      AND tm.status = 'active'
      AND t.type IN ('agency', 'seller')
      AND tm.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1;

    IF v_existing_tenant IS NOT NULL AND v_existing_tenant <> NEW.tenant_id THEN
        RAISE EXCEPTION 'Phase 2 users may belong to exactly one seller/agency tenant';
    END IF;

    UPDATE public.profiles
    SET tenant_id = NEW.tenant_id,
        updated_at = NOW()
    WHERE id = NEW.user_id
      AND tenant_id IS DISTINCT FROM NEW.tenant_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_memberships_single_product_tenant ON public.tenant_memberships;
CREATE TRIGGER trg_tenant_memberships_single_product_tenant
    BEFORE INSERT OR UPDATE OF tenant_id, status
    ON public.tenant_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_single_active_product_tenant_membership();

ALTER TABLE public.user_seller_assignments
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS agency_tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.user_seller_assignments usa
SET
    user_id = tm.user_id,
    agency_tenant_id = tm.tenant_id
FROM public.tenant_memberships tm
JOIN public.tenants t ON t.id = tm.tenant_id
WHERE tm.id = usa.tenant_membership_id
  AND t.type = 'agency'
  AND (usa.user_id IS NULL OR usa.agency_tenant_id IS NULL);

ALTER TABLE public.user_seller_assignments
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN agency_tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_seller_assignments_user_seller_unique
    ON public.user_seller_assignments (user_id, seller_tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_seller_assignments_user
    ON public.user_seller_assignments (user_id, agency_tenant_id);

CREATE OR REPLACE FUNCTION public.validate_user_seller_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_tenant uuid;
    v_seller_parent uuid;
BEGIN
    SELECT tenant_id INTO v_profile_tenant
    FROM public.profiles
    WHERE id = NEW.user_id;

    IF v_profile_tenant IS NULL OR v_profile_tenant <> NEW.agency_tenant_id THEN
        RAISE EXCEPTION 'Assigned user must belong to the same agency tenant';
    END IF;

    SELECT parent_tenant_id INTO v_seller_parent
    FROM public.tenants
    WHERE id = NEW.seller_tenant_id
      AND type = 'seller';

    IF v_seller_parent IS NULL OR v_seller_parent <> NEW.agency_tenant_id THEN
        RAISE EXCEPTION 'Assigned seller must be actively linked to the same agency tenant';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_seller_assignment ON public.user_seller_assignments;
CREATE TRIGGER trg_validate_user_seller_assignment
    BEFORE INSERT OR UPDATE OF user_id, agency_tenant_id, seller_tenant_id
    ON public.user_seller_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_user_seller_assignment();

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
                      AND s.status = 'active'
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
                      AND s.status = 'active'
                )
        END,
        ARRAY[]::uuid[]
    );
$$;

CREATE OR REPLACE FUNCTION public.get_request_tenant_context(p_user_id uuid)
RETURNS TABLE (
    user_id uuid,
    tenant_id uuid,
    tenant_type text,
    assigned_seller_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id AS user_id,
        p.tenant_id,
        t.type AS tenant_type,
        public.get_assigned_seller_ids(p.id) AS assigned_seller_ids
    FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_assigned_seller_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_request_tenant_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assigned_seller_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_request_tenant_context(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_is_visible_to_user(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH ctx AS (
        SELECT *
        FROM public.get_request_tenant_context(p_user_id)
    )
    SELECT p_tenant_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1
            FROM ctx
            WHERE tenant_type = 'seller'
              AND tenant_id = p_tenant_id
        )
        OR EXISTS (
            SELECT 1
            FROM ctx
            WHERE tenant_type = 'agency'
              AND p_tenant_id = ANY(assigned_seller_ids)
        )
        OR EXISTS (
            SELECT 1
            FROM ctx
            WHERE tenant_type = 'agency'
              AND tenant_id = p_tenant_id
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.account_is_visible_to_user(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.tenant_is_visible_to_user(
        (SELECT a.tenant_id FROM public.accounts a WHERE a.id = p_account_id),
        p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.check_user_account_access(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.account_is_visible_to_user(p_account_id, p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.check_user_account_write_access(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.account_is_visible_to_user(p_account_id, p_user_id)
    AND NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.profiles p ON p.id = p_user_id
        JOIN public.tenant_memberships tm
            ON tm.tenant_id = p.tenant_id
            AND tm.user_id = p_user_id
            AND tm.status = 'active'
        JOIN public.roles r
            ON r.id = tm.role_id
           AND r.tenant_id IS NULL
           AND r.name = 'Seller User'
        WHERE a.id = p_account_id
          AND a.tenant_id = p.tenant_id
    );
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission_for_account(
    p_user_id uuid,
    p_account_id uuid,
    p_permission_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1
            FROM public.accounts a
            JOIN public.profiles p ON p.id = p_user_id
            JOIN public.tenant_memberships tm
                ON tm.tenant_id = p.tenant_id
               AND tm.user_id = p_user_id
               AND tm.status = 'active'
            JOIN public.role_permissions rp ON rp.role_id = tm.role_id
            JOIN public.permissions perm ON perm.id = rp.permission_id
            WHERE a.id = p_account_id
              AND perm.action = p_permission_action
              AND (
                    a.tenant_id = p.tenant_id
                 OR a.tenant_id = ANY(public.get_assigned_seller_ids(p_user_id))
              )
        );
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_tenant_members(p_tenant_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_tenant_id IS NOT NULL
    AND p_actor_id IS NOT NULL
    AND (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin')
        OR public.user_is_platform_super_admin(p_actor_id)
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.tenants target ON target.id = p_tenant_id
            JOIN public.tenant_memberships tm
                ON tm.user_id = p_actor_id
               AND tm.tenant_id = p.tenant_id
               AND tm.status = 'active'
            JOIN public.roles r ON r.id = tm.role_id
            WHERE p.id = p_actor_id
              AND (
                    (target.type = 'agency' AND p.tenant_id = p_tenant_id AND r.name = 'Agency Admin')
                 OR (target.type = 'seller' AND p.tenant_id = p_tenant_id AND r.name = 'Seller Admin')
                 OR (target.type = 'seller' AND target.parent_tenant_id = p.tenant_id AND r.name = 'Agency Admin')
              )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.ensure_not_last_admin(
    p_tenant_id uuid,
    p_target_user_id uuid,
    p_replacement_role_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_type text;
    v_target_role_name text;
    v_replacement_role_name text;
    v_admin_role_name text;
    v_admin_count int;
BEGIN
    SELECT type INTO v_tenant_type
    FROM public.tenants
    WHERE id = p_tenant_id;

    IF v_tenant_type = 'agency' THEN
        v_admin_role_name := 'Agency Admin';
    ELSIF v_tenant_type = 'seller' THEN
        v_admin_role_name := 'Seller Admin';
    ELSE
        RETURN;
    END IF;

    SELECT r.name INTO v_target_role_name
    FROM public.tenant_memberships tm
    JOIN public.roles r ON r.id = tm.role_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_target_user_id
      AND tm.status = 'active'
    LIMIT 1;

    IF v_target_role_name IS DISTINCT FROM v_admin_role_name THEN
        RETURN;
    END IF;

    IF p_replacement_role_id IS NOT NULL THEN
        SELECT name INTO v_replacement_role_name
        FROM public.roles
        WHERE id = p_replacement_role_id;

        IF v_replacement_role_name = v_admin_role_name THEN
            RETURN;
        END IF;
    END IF;

    SELECT COUNT(*)
    INTO v_admin_count
    FROM public.tenant_memberships tm
    JOIN public.roles r ON r.id = tm.role_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.status = 'active'
      AND r.name = v_admin_role_name;

    IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'Cannot remove or demote the last %', v_admin_role_name;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_set_member_role_for_actor(
    p_actor_id uuid,
    p_tenant_id uuid,
    p_target_user_id uuid,
    p_role_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mid uuid;
BEGIN
    IF NOT public.user_can_manage_tenant_members(p_tenant_id, p_actor_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    PERFORM public.ensure_not_last_admin(p_tenant_id, p_target_user_id, p_role_id);

    INSERT INTO public.tenant_memberships (tenant_id, user_id, role_id, status)
    VALUES (p_tenant_id, p_target_user_id, p_role_id, 'invited')
    ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role_id = EXCLUDED.role_id,
        status = CASE
            WHEN public.tenant_memberships.status = 'declined' THEN 'invited'
            ELSE public.tenant_memberships.status
        END,
        updated_at = NOW()
    RETURNING id INTO v_mid;

    RETURN v_mid;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_tenant_member(
    p_tenant_id uuid,
    p_target_user uuid,
    p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT public.user_can_manage_tenant_members(p_tenant_id, v_caller) THEN
        RAISE EXCEPTION 'Only an admin of this tenant can manage its members';
    END IF;

    IF p_target_user = v_caller THEN
        RAISE EXCEPTION 'You cannot manage your own membership';
    END IF;

    IF p_action NOT IN ('suspend', 'reactivate', 'remove') THEN
        RAISE EXCEPTION 'Invalid action';
    END IF;

    IF p_action IN ('suspend', 'remove') THEN
        PERFORM public.ensure_not_last_admin(p_tenant_id, p_target_user, NULL);
    END IF;

    IF p_action = 'suspend' THEN
        UPDATE public.tenant_memberships
        SET status = 'deactivated', updated_at = NOW()
        WHERE tenant_id = p_tenant_id
          AND user_id = p_target_user;
    ELSIF p_action = 'reactivate' THEN
        UPDATE public.tenant_memberships
        SET status = 'active', updated_at = NOW()
        WHERE tenant_id = p_tenant_id
          AND user_id = p_target_user;
    ELSE
        DELETE FROM public.tenant_memberships
        WHERE tenant_id = p_tenant_id
          AND user_id = p_target_user;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agency_grant_staff_seller_access(
    p_agency_tenant_id uuid,
    p_staff_user_id uuid,
    p_seller_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_caller_is_aa boolean;
    v_caller_is_am boolean;
    v_staff_role_name text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_caller_is_aa := public.user_is_agency_admin(p_agency_tenant_id, v_caller);

    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.tenant_memberships tm
            ON tm.user_id = p.id
           AND tm.tenant_id = p.tenant_id
           AND tm.status = 'active'
        JOIN public.roles r ON r.id = tm.role_id
        WHERE p.id = v_caller
          AND p.tenant_id = p_agency_tenant_id
          AND r.name = 'Account Manager'
    ) INTO v_caller_is_am;

    IF NOT v_caller_is_aa AND NOT v_caller_is_am THEN
        RAISE EXCEPTION 'Only Agency Admin or Account Manager can assign sellers to staff';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants s
        WHERE s.id = p_seller_tenant_id
          AND s.type = 'seller'
          AND s.parent_tenant_id = p_agency_tenant_id
          AND s.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_staff_user_id
          AND p.tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Assigned staff user must belong to this agency tenant';
    END IF;

    SELECT r.name INTO v_staff_role_name
    FROM public.profiles p
    JOIN public.tenant_memberships tm
        ON tm.user_id = p.id
       AND tm.tenant_id = p.tenant_id
       AND tm.status = 'active'
    JOIN public.roles r ON r.id = tm.role_id
    WHERE p.id = p_staff_user_id
      AND p.tenant_id = p_agency_tenant_id
      AND r.name IN ('Account Manager', 'Account Coordinator', 'Agency Admin')
    LIMIT 1;

    IF v_staff_role_name IS NULL THEN
        RAISE EXCEPTION 'User is not an active agency member';
    END IF;

    IF v_caller_is_am AND NOT v_caller_is_aa THEN
        IF v_staff_role_name <> 'Account Coordinator' THEN
            RAISE EXCEPTION 'Account Managers can only assign sellers to Account Coordinators';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.user_seller_assignments usa
            WHERE usa.user_id = v_caller
              AND usa.agency_tenant_id = p_agency_tenant_id
              AND usa.seller_tenant_id = p_seller_tenant_id
        ) THEN
            RAISE EXCEPTION 'Account Managers can only assign sellers from their own assigned scope';
        END IF;
    END IF;

    INSERT INTO public.user_seller_assignments (
        tenant_membership_id,
        user_id,
        agency_tenant_id,
        seller_tenant_id
    )
    VALUES (
        (
            SELECT tm.id
            FROM public.tenant_memberships tm
            WHERE tm.user_id = p_staff_user_id
              AND tm.tenant_id = p_agency_tenant_id
            LIMIT 1
        ),
        p_staff_user_id,
        p_agency_tenant_id,
        p_seller_tenant_id
    )
    ON CONFLICT (tenant_membership_id, seller_tenant_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_seller_agency_link(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_account_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT (
        public.user_is_agency_admin(p_agency_tenant_id, v_caller)
        OR public.user_is_platform_super_admin(v_caller)
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.tenant_memberships tm
                ON tm.user_id = p.id
               AND tm.tenant_id = p.tenant_id
               AND tm.status = 'active'
            JOIN public.roles r ON r.id = tm.role_id
            WHERE p.id = v_caller
              AND p.tenant_id = p_seller_tenant_id
              AND r.name = 'Seller Admin'
        )
    ) THEN
        RAISE EXCEPTION 'Only Agency Admin, Seller Admin, or Super Admin can unlink sellers';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE id = p_seller_tenant_id
          AND type = 'seller'
          AND parent_tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    UPDATE public.tenants
    SET parent_tenant_id = NULL,
        link_status = 'active',
        updated_at = NOW()
    WHERE id = p_seller_tenant_id;

    DELETE FROM public.user_seller_assignments
    WHERE seller_tenant_id = p_seller_tenant_id
      AND agency_tenant_id = p_agency_tenant_id;

    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE tenant_id = p_seller_tenant_id
    LIMIT 1;

    IF v_account_id IS NOT NULL THEN
        UPDATE public.dashboard_email_schedules
        SET enabled = false,
            updated_at = NOW()
        WHERE account_id = v_account_id
          AND created_by IN (
              SELECT id
              FROM public.profiles
              WHERE tenant_id = p_agency_tenant_id
          );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_seller_agency_link(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_seller_agency_link(uuid, uuid) TO authenticated;
