-- Enforce append-only semantics on branding and global audit logs.
-- This hardens audit immutability at the database layer.

CREATE OR REPLACE FUNCTION public.prevent_audit_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Audit rows are immutable and cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_branding_audit_immutable_update ON public.tenant_branding_audit;
CREATE TRIGGER trg_tenant_branding_audit_immutable_update
    BEFORE UPDATE ON public.tenant_branding_audit
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_row_mutation();

DROP TRIGGER IF EXISTS trg_tenant_branding_audit_immutable_delete ON public.tenant_branding_audit;
CREATE TRIGGER trg_tenant_branding_audit_immutable_delete
    BEFORE DELETE ON public.tenant_branding_audit
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_row_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_update ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable_update
    BEFORE UPDATE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_row_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_delete ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable_delete
    BEFORE DELETE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_row_mutation();
