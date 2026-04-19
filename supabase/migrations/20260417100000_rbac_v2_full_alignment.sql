-- RBAC v2 full alignment:
-- - multi-role assignments with union-effective permissions
-- - immutable system roles
-- - soft delete + versioning for custom roles
-- - DB-driven plan entitlements
-- - seller financial visibility restrictions
-- - RBAC lifecycle audit coverage

ALTER TABLE public.roles
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS replaced_by_role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.membership_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id uuid NOT NULL REFERENCES public.tenant_memberships(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_roles_active
    ON public.membership_roles(membership_id, role_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_membership_roles_membership_active
    ON public.membership_roles(membership_id)
    WHERE revoked_at IS NULL;

INSERT INTO public.membership_roles (membership_id, role_id, snapshot_json)
SELECT
    tm.id,
    tm.role_id,
    jsonb_build_object(
        'source', 'backfill_tenant_memberships',
        'status', tm.status
    )
FROM public.tenant_memberships tm
WHERE tm.role_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.membership_roles mr
      WHERE mr.membership_id = tm.id
        AND mr.role_id = tm.role_id
        AND mr.revoked_at IS NULL
  );

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

    UPDATE public.tenant_memberships tm
    SET role_id = v_primary_role_id,
        updated_at = now()
    WHERE tm.id = v_membership_id
      AND tm.role_id IS DISTINCT FROM v_primary_role_id;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_membership_primary_role ON public.membership_roles;
CREATE TRIGGER trg_sync_membership_primary_role
    AFTER INSERT OR UPDATE OR DELETE
    ON public.membership_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_membership_primary_role_from_membership_roles();

CREATE OR REPLACE FUNCTION public.sync_membership_roles_from_primary_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.role_id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.membership_roles
    SET revoked_at = now()
    WHERE membership_id = NEW.id
      AND revoked_at IS NULL
      AND role_id <> NEW.role_id;

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

DROP TRIGGER IF EXISTS trg_sync_membership_roles_from_primary ON public.tenant_memberships;
CREATE TRIGGER trg_sync_membership_roles_from_primary
    AFTER INSERT OR UPDATE OF role_id
    ON public.tenant_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_membership_roles_from_primary_role();

CREATE OR REPLACE FUNCTION public.prevent_system_role_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.type = 'system' THEN
        RAISE EXCEPTION 'System-defined roles are immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_role_update ON public.roles;
CREATE TRIGGER trg_prevent_system_role_update
    BEFORE UPDATE OR DELETE
    ON public.roles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_system_role_mutation();

CREATE OR REPLACE FUNCTION public.prevent_system_role_permission_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_role_type text;
    v_seed_override text;
BEGIN
    v_seed_override := current_setting('app.allow_system_role_permission_mutation', true);
    IF COALESCE(v_seed_override, 'off') = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT type INTO v_role_type
    FROM public.roles
    WHERE id = COALESCE(NEW.role_id, OLD.role_id);

    IF v_role_type = 'system' THEN
        RAISE EXCEPTION 'Permissions for system-defined roles are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_role_permission_mutation ON public.role_permissions;
CREATE TRIGGER trg_prevent_system_role_permission_mutation
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.role_permissions
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_system_role_permission_mutation();

CREATE TABLE IF NOT EXISTS public.tenant_plan_entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_key text NOT NULL,
    allowed boolean NOT NULL DEFAULT false,
    source_plan_id text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_entitlements_tenant
    ON public.tenant_plan_entitlements(tenant_id, feature_key);

CREATE OR REPLACE FUNCTION public.tenant_feature_allowed(
    p_tenant_id uuid,
    p_feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT tpe.allowed
        FROM public.tenant_plan_entitlements tpe
        WHERE tpe.tenant_id = p_tenant_id
          AND tpe.feature_key = trim(p_feature_key)
        LIMIT 1
    ), false);
$$;

REVOKE ALL ON FUNCTION public.tenant_feature_allowed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_feature_allowed(uuid, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.seller_financial_visibility_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agency_tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    restrict_cogs boolean NOT NULL DEFAULT false,
    restrict_margin boolean NOT NULL DEFAULT false,
    restrict_custom_line_items boolean NOT NULL DEFAULT false,
    restricted_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    UNIQUE (seller_tenant_id, agency_tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_financial_visibility_rules_seller
    ON public.seller_financial_visibility_rules(seller_tenant_id);

CREATE OR REPLACE FUNCTION public.get_financial_field_access(
    p_user_id uuid,
    p_seller_tenant_id uuid
)
RETURNS TABLE (
    can_view_cogs boolean,
    can_view_margin boolean,
    can_view_custom_line_items boolean,
    restricted_fields text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ctx record;
    v_perm_view_cogs boolean := false;
    v_perm_view_margin boolean := false;
    v_perm_view_custom boolean := false;
    v_rule record;
BEGIN
    SELECT *
    INTO v_ctx
    FROM public.get_request_tenant_context(p_user_id)
    LIMIT 1;

    IF v_ctx.user_id IS NULL THEN
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[];
        RETURN;
    END IF;

    IF v_ctx.tenant_type = 'seller' AND v_ctx.tenant_id = p_seller_tenant_id THEN
        RETURN QUERY SELECT true, true, true, ARRAY[]::text[];
        RETURN;
    END IF;

    IF v_ctx.tenant_type = 'agency' AND NOT (p_seller_tenant_id = ANY(v_ctx.assigned_seller_ids)) THEN
        RETURN QUERY SELECT false, false, false, ARRAY['cogs', 'margin', 'custom_line_items']::text[];
        RETURN;
    END IF;

    v_perm_view_cogs := EXISTS (
        SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_cogs'
    );
    v_perm_view_margin := EXISTS (
        SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_margin'
    );
    v_perm_view_custom := EXISTS (
        SELECT 1 FROM public.get_user_effective_permissions_on_tenant(p_user_id, v_ctx.tenant_id) p WHERE p.action = 'view_custom_line_items'
    );

    SELECT *
    INTO v_rule
    FROM public.seller_financial_visibility_rules sfr
    WHERE sfr.seller_tenant_id = p_seller_tenant_id
      AND (sfr.agency_tenant_id IS NULL OR sfr.agency_tenant_id = v_ctx.tenant_id)
    ORDER BY sfr.agency_tenant_id NULLS LAST
    LIMIT 1;

    IF v_ctx.tenant_type = 'agency' AND v_rule.id IS NOT NULL THEN
        v_perm_view_cogs := v_perm_view_cogs AND NOT v_rule.restrict_cogs;
        v_perm_view_margin := v_perm_view_margin AND NOT v_rule.restrict_margin;
        v_perm_view_custom := v_perm_view_custom AND NOT v_rule.restrict_custom_line_items;
    END IF;

    RETURN QUERY
    SELECT
        v_perm_view_cogs,
        v_perm_view_margin,
        v_perm_view_custom,
        COALESCE(v_rule.restricted_fields, ARRAY[]::text[]);
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_field_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_financial_field_access(uuid, uuid) TO authenticated, service_role;

INSERT INTO public.permissions (action, description)
VALUES
    ('export_pnl', 'Export P&L reports'),
    ('schedule_export', 'Schedule recurring export delivery'),
    ('view_cogs', 'View COGS fields'),
    ('view_margin', 'View margin calculations'),
    ('view_custom_line_items', 'View custom financial line items'),
    ('manage_roles', 'Create/update/delete roles'),
    ('assign_roles', 'Assign roles to memberships')
ON CONFLICT (action) DO NOTHING;

DO $$
DECLARE
    v_export_pnl_id uuid;
    v_schedule_export_id uuid;
    v_dashboard_export_id uuid;
    v_seller_admin_id uuid;
    v_agency_admin_id uuid;
    v_am_id uuid;
BEGIN
    PERFORM set_config('app.allow_system_role_permission_mutation', 'on', true);

    SELECT id INTO v_export_pnl_id FROM public.permissions WHERE action = 'export_pnl';
    SELECT id INTO v_schedule_export_id FROM public.permissions WHERE action = 'schedule_export';
    SELECT id INTO v_dashboard_export_id FROM public.permissions WHERE action = 'dashboard.export_email';

    SELECT id INTO v_seller_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Seller Admin';
    SELECT id INTO v_agency_admin_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Agency Admin';
    SELECT id INTO v_am_id FROM public.roles WHERE tenant_id IS NULL AND name = 'Account Manager';

    IF v_export_pnl_id IS NOT NULL AND v_dashboard_export_id IS NOT NULL THEN
        IF v_seller_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_seller_admin_id, v_export_pnl_id) ON CONFLICT DO NOTHING;
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_seller_admin_id, v_schedule_export_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_agency_admin_id IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_agency_admin_id, v_export_pnl_id) ON CONFLICT DO NOTHING;
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_agency_admin_id, v_schedule_export_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_am_id IS NOT NULL THEN
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_am_id, v_export_pnl_id) ON CONFLICT DO NOTHING;
            INSERT INTO public.role_permissions(role_id, permission_id) VALUES (v_am_id, v_schedule_export_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    PERFORM set_config('app.allow_system_role_permission_mutation', 'off', true);
END $$;

CREATE OR REPLACE FUNCTION public.get_user_effective_permissions_on_tenant(
    p_user_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH active_membership_roles AS (
        SELECT DISTINCT mr.role_id
        FROM public.tenant_memberships tm
        JOIN public.membership_roles mr
          ON mr.membership_id = tm.id
         AND mr.revoked_at IS NULL
        JOIN public.roles r2
          ON r2.id = mr.role_id
         AND r2.deleted_at IS NULL
        WHERE tm.user_id = p_user_id
          AND tm.tenant_id = p_tenant_id
          AND tm.status = 'active'
    ),
    fallback_roles AS (
        SELECT DISTINCT tm.role_id
        FROM public.tenant_memberships tm
        JOIN public.roles r2
          ON r2.id = tm.role_id
         AND r2.deleted_at IS NULL
        WHERE tm.user_id = p_user_id
          AND tm.tenant_id = p_tenant_id
          AND tm.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM active_membership_roles)
    ),
    all_roles AS (
        SELECT role_id FROM active_membership_roles
        UNION
        SELECT role_id FROM fallback_roles
    )
    SELECT DISTINCT perm.action
    FROM all_roles ar
    JOIN public.role_permissions rp ON rp.role_id = ar.role_id
    JOIN public.permissions perm ON perm.id = rp.permission_id;
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
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT tenant_id INTO v_tid
    FROM public.roles
    WHERE id = p_role_id
      AND type = 'custom'
      AND deleted_at IS NULL;
    IF v_tid IS NULL THEN
        RAISE EXCEPTION 'Custom role not found';
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

CREATE OR REPLACE FUNCTION public.audit_rbac_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_action text;
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.type = 'custom' THEN
            v_action := 'role.create';
        ELSE
            RETURN NEW;
        END IF;
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, after_state, metadata)
        VALUES (v_actor, v_action, 'role', NEW.id::text, NEW.tenant_id, to_jsonb(NEW), jsonb_build_object('source', 'db_trigger'));
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.type = 'custom' THEN
            IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
                v_action := 'role.soft_delete';
            ELSE
                v_action := 'role.update';
            END IF;
            INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, after_state, metadata)
            VALUES (v_actor, v_action, 'role', NEW.id::text, NEW.tenant_id, to_jsonb(OLD), to_jsonb(NEW), jsonb_build_object('source', 'db_trigger'));
        END IF;
        RETURN NEW;
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_rbac_role_changes ON public.roles;
CREATE TRIGGER trg_audit_rbac_role_changes
    AFTER INSERT OR UPDATE
    ON public.roles
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_rbac_role_changes();

CREATE OR REPLACE FUNCTION public.audit_membership_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_tenant_id uuid;
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_memberships tm
    WHERE tm.id = COALESCE(NEW.membership_id, OLD.membership_id);

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, after_state, metadata)
        VALUES (v_actor, 'role.assignment', 'membership_role', NEW.id::text, v_tenant_id, to_jsonb(NEW), jsonb_build_object('source', 'db_trigger'));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, after_state, metadata)
        VALUES (v_actor, 'role.assignment_update', 'membership_role', NEW.id::text, v_tenant_id, to_jsonb(OLD), to_jsonb(NEW), jsonb_build_object('source', 'db_trigger'));
        RETURN NEW;
    ELSE
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, metadata)
        VALUES (v_actor, 'role.unassignment', 'membership_role', OLD.id::text, v_tenant_id, to_jsonb(OLD), jsonb_build_object('source', 'db_trigger'));
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_membership_role_changes ON public.membership_roles;
CREATE TRIGGER trg_audit_membership_role_changes
    AFTER INSERT OR UPDATE OR DELETE
    ON public.membership_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_membership_role_changes();

CREATE OR REPLACE FUNCTION public.audit_plan_entitlement_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, after_state, metadata)
        VALUES (v_actor, 'plan.entitlement_change', 'tenant_plan_entitlement', NEW.id::text, NEW.tenant_id, to_jsonb(NEW), jsonb_build_object('op', 'insert'));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, after_state, metadata)
        VALUES (v_actor, 'plan.entitlement_change', 'tenant_plan_entitlement', NEW.id::text, NEW.tenant_id, to_jsonb(OLD), to_jsonb(NEW), jsonb_build_object('op', 'update'));
        RETURN NEW;
    ELSE
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, metadata)
        VALUES (v_actor, 'plan.entitlement_change', 'tenant_plan_entitlement', OLD.id::text, OLD.tenant_id, to_jsonb(OLD), jsonb_build_object('op', 'delete'));
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_plan_entitlement_changes ON public.tenant_plan_entitlements;
CREATE TRIGGER trg_audit_plan_entitlement_changes
    AFTER INSERT OR UPDATE OR DELETE
    ON public.tenant_plan_entitlements
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_plan_entitlement_changes();

CREATE OR REPLACE FUNCTION public.audit_financial_visibility_rule_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, after_state, metadata)
        VALUES (v_actor, 'financial.restriction_change', 'seller_financial_visibility_rule', NEW.id::text, NEW.seller_tenant_id, to_jsonb(NEW), jsonb_build_object('op', 'insert'));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, after_state, metadata)
        VALUES (v_actor, 'financial.restriction_change', 'seller_financial_visibility_rule', NEW.id::text, NEW.seller_tenant_id, to_jsonb(OLD), to_jsonb(NEW), jsonb_build_object('op', 'update'));
        RETURN NEW;
    ELSE
        INSERT INTO public.audit_logs(actor_user_id, action, resource_type, resource_id, tenant_id, before_state, metadata)
        VALUES (v_actor, 'financial.restriction_change', 'seller_financial_visibility_rule', OLD.id::text, OLD.seller_tenant_id, to_jsonb(OLD), jsonb_build_object('op', 'delete'));
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_financial_visibility_rule_changes ON public.seller_financial_visibility_rules;
CREATE TRIGGER trg_audit_financial_visibility_rule_changes
    AFTER INSERT OR UPDATE OR DELETE
    ON public.seller_financial_visibility_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_financial_visibility_rule_changes();
