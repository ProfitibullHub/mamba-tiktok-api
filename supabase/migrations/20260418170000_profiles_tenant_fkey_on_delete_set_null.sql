-- Deleting a tenant (admin user wipe, DELETE /api/admin/tenants/:id) failed with:
--   profiles_tenant_id_fkey ... ON DELETE RESTRICT
-- while profiles.tenant_id still pointed at that tenant.
-- profiles_product_users_require_tenant also blocked FK-driven SET NULL on tenant delete.
--
-- Fix: FK ON DELETE SET NULL + drop the table CHECK + enforce tenant on INSERT only
-- (normal app/RPC paths still supply tenant_id for new non-admin rows).

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_product_users_require_tenant;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_tenant_id_fkey;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.enforce_profile_tenant_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM 'admin' AND NEW.tenant_id IS NULL THEN
        RAISE EXCEPTION 'Non-admin profiles require tenant_id';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_require_tenant_on_insert ON public.profiles;
CREATE TRIGGER trg_profiles_require_tenant_on_insert
    BEFORE INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_profile_tenant_on_insert();
