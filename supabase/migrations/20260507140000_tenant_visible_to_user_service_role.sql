-- API server calls visibility helpers with the service role; ensure it can execute
-- tenant_is_visible_to_user (used for read-only team APIs, e.g. AM/AC roster hints).
GRANT EXECUTE ON FUNCTION public.tenant_is_visible_to_user(uuid, uuid) TO service_role;
