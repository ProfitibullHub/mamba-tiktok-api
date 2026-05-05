-- Fix agency/seller tenant deletion when branding audit immutability is enabled.
-- tenant_branding_audit is append-only and protected against DELETE, so cascading
-- tenant deletes must not attempt to remove audit rows.

DO $$
DECLARE
    fk record;
BEGIN
    -- Preserve audit records by nulling tenant_id when tenant is deleted.
    ALTER TABLE public.tenant_branding_audit
        ALTER COLUMN tenant_id DROP NOT NULL;

    -- Drop any existing FK(s) on tenant_id regardless of generated constraint name.
    FOR fk IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ck.attnum
        WHERE c.contype = 'f'
          AND n.nspname = 'public'
          AND t.relname = 'tenant_branding_audit'
          AND a.attname = 'tenant_id'
    LOOP
        EXECUTE format('ALTER TABLE public.tenant_branding_audit DROP CONSTRAINT %I', fk.conname);
    END LOOP;

    ALTER TABLE public.tenant_branding_audit
        ADD CONSTRAINT tenant_branding_audit_tenant_id_fkey
        FOREIGN KEY (tenant_id)
        REFERENCES public.tenants(id)
        ON DELETE SET NULL;
END $$;
