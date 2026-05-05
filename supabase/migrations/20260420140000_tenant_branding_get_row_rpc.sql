-- Full row read for tenant_branding (theme columns included).
-- PostgREST can omit newly added columns from REST responses until the schema cache reloads;
-- this SECURITY DEFINER function always returns the live table row.

DROP FUNCTION IF EXISTS public.tenant_branding_get_row(uuid);

CREATE OR REPLACE FUNCTION public.tenant_branding_get_row(p_tenant_id uuid)
RETURNS public.tenant_branding
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.tenant_branding
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.tenant_branding_get_row(uuid) IS
    'Service-role only: return full tenant_branding row (all columns) for API reads.';

REVOKE ALL ON FUNCTION public.tenant_branding_get_row(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_branding_get_row(uuid) TO service_role;
    