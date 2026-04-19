-- PRD completion pass:
-- 1) tenant.type immutable after creation
-- 2) tenancy audit coverage for link + assignment mutations
-- 3) canonical seller-account path (tenant is identity, account is integration profile)

CREATE OR REPLACE FUNCTION public.prevent_tenant_type_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'Tenant type is immutable after creation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_tenant_type_change ON public.tenants;
CREATE TRIGGER trg_prevent_tenant_type_change
    BEFORE UPDATE OF type
    ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_tenant_type_change();

-- Canonicalize seller account representation:
-- - tenant remains the identity boundary
-- - account remains technical integration profile and must be 1:1 with seller tenant
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.accounts a
        WHERE a.tenant_id IS NOT NULL
        GROUP BY a.tenant_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce 1:1 seller account mapping: duplicate accounts exist for at least one tenant_id';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_tenant_single
    ON public.accounts (tenant_id)
    WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE VIEW public.seller_account_projection AS
SELECT
    t.id AS seller_tenant_id,
    t.name AS seller_name,
    t.status AS seller_status,
    a.id AS account_id,
    a.name AS account_name,
    a.status AS account_status
FROM public.tenants t
LEFT JOIN public.accounts a
    ON a.tenant_id = t.id
WHERE t.type = 'seller';

CREATE OR REPLACE FUNCTION public.get_seller_account_id(p_seller_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT a.id
    FROM public.accounts a
    WHERE a.tenant_id = p_seller_tenant_id
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_seller_account_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_account_id(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_tenant_link_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.type <> 'seller' THEN
        RETURN NEW;
    END IF;

    IF OLD.parent_tenant_id IS DISTINCT FROM NEW.parent_tenant_id THEN
        IF OLD.parent_tenant_id IS NULL AND NEW.parent_tenant_id IS NOT NULL THEN
            INSERT INTO public.audit_logs (
                actor_user_id,
                action,
                resource_type,
                resource_id,
                tenant_id,
                metadata
            ) VALUES (
                v_actor,
                'tenant.link_created',
                'tenant_link',
                NEW.id::text,
                NEW.parent_tenant_id,
                jsonb_build_object(
                    'agencyTenantId', NEW.parent_tenant_id,
                    'sellerTenantId', NEW.id,
                    'source', 'db_trigger'
                )
            );
        ELSIF OLD.parent_tenant_id IS NOT NULL AND NEW.parent_tenant_id IS NULL THEN
            INSERT INTO public.audit_logs (
                actor_user_id,
                action,
                resource_type,
                resource_id,
                tenant_id,
                metadata
            ) VALUES (
                v_actor,
                'tenant.link_revoked',
                'tenant_link',
                NEW.id::text,
                OLD.parent_tenant_id,
                jsonb_build_object(
                    'agencyTenantId', OLD.parent_tenant_id,
                    'sellerTenantId', NEW.id,
                    'source', 'db_trigger'
                )
            );
        ELSE
            INSERT INTO public.audit_logs (
                actor_user_id,
                action,
                resource_type,
                resource_id,
                tenant_id,
                metadata
            ) VALUES (
                v_actor,
                'tenant.link_revoked',
                'tenant_link',
                NEW.id::text,
                OLD.parent_tenant_id,
                jsonb_build_object(
                    'agencyTenantId', OLD.parent_tenant_id,
                    'sellerTenantId', NEW.id,
                    'source', 'db_trigger_transfer_old'
                )
            );

            INSERT INTO public.audit_logs (
                actor_user_id,
                action,
                resource_type,
                resource_id,
                tenant_id,
                metadata
            ) VALUES (
                v_actor,
                'tenant.link_created',
                'tenant_link',
                NEW.id::text,
                NEW.parent_tenant_id,
                jsonb_build_object(
                    'agencyTenantId', NEW.parent_tenant_id,
                    'sellerTenantId', NEW.id,
                    'source', 'db_trigger_transfer_new'
                )
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_tenant_link_change ON public.tenants;
CREATE TRIGGER trg_audit_tenant_link_change
    AFTER UPDATE OF parent_tenant_id
    ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_tenant_link_change();

CREATE OR REPLACE FUNCTION public.audit_user_seller_assignment_change()
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
        INSERT INTO public.audit_logs (
            actor_user_id,
            action,
            resource_type,
            resource_id,
            tenant_id,
            metadata
        ) VALUES (
            v_actor,
            'assignment.seller_added',
            'user_seller_assignment',
            NEW.id::text,
            NEW.agency_tenant_id,
            jsonb_build_object(
                'agencyTenantId', NEW.agency_tenant_id,
                'sellerTenantId', NEW.seller_tenant_id,
                'userId', NEW.user_id,
                'source', 'db_trigger'
            )
        );
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_logs (
            actor_user_id,
            action,
            resource_type,
            resource_id,
            tenant_id,
            metadata
        ) VALUES (
            v_actor,
            'assignment.seller_removed',
            'user_seller_assignment',
            OLD.id::text,
            OLD.agency_tenant_id,
            jsonb_build_object(
                'agencyTenantId', OLD.agency_tenant_id,
                'sellerTenantId', OLD.seller_tenant_id,
                'userId', OLD.user_id,
                'source', 'db_trigger'
            )
        );
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (OLD.user_id, OLD.agency_tenant_id, OLD.seller_tenant_id)
           IS DISTINCT FROM
           (NEW.user_id, NEW.agency_tenant_id, NEW.seller_tenant_id) THEN
            INSERT INTO public.audit_logs (
                actor_user_id,
                action,
                resource_type,
                resource_id,
                tenant_id,
                before_state,
                after_state,
                metadata
            ) VALUES (
                v_actor,
                'assignment.seller_updated',
                'user_seller_assignment',
                NEW.id::text,
                NEW.agency_tenant_id,
                jsonb_build_object(
                    'agencyTenantId', OLD.agency_tenant_id,
                    'sellerTenantId', OLD.seller_tenant_id,
                    'userId', OLD.user_id
                ),
                jsonb_build_object(
                    'agencyTenantId', NEW.agency_tenant_id,
                    'sellerTenantId', NEW.seller_tenant_id,
                    'userId', NEW.user_id
                ),
                jsonb_build_object('source', 'db_trigger')
            );
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_seller_assignment_change ON public.user_seller_assignments;
CREATE TRIGGER trg_audit_user_seller_assignment_change
    AFTER INSERT OR UPDATE OR DELETE
    ON public.user_seller_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_user_seller_assignment_change();
