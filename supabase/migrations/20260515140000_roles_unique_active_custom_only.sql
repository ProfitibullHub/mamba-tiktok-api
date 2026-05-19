-- Global UNIQUE (tenant_id, name) blocks creating a new custom role with the same name as a
-- soft-deleted row. Enforce uniqueness only for active custom roles; keep one row per system role name.

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_tenant_name_unique;
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_tenant_id_name_key;

-- System roles (tenant_id IS NULL): e.g. Super Admin, Agency Admin — unique by name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_system_name_null_tenant
    ON public.roles (name)
    WHERE tenant_id IS NULL;

-- Custom roles: at most one non-deleted row per (tenant_id, name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_custom_tenant_name_active
    ON public.roles (tenant_id, name)
    WHERE tenant_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX public.uq_roles_custom_tenant_name_active IS
    'Custom role display names may be reused after the previous row is soft-deleted (deleted_at set).';
