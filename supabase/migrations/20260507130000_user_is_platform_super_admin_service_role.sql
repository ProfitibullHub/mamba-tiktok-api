-- API server uses SUPABASE_SERVICE_ROLE_KEY. user_is_platform_super_admin was only granted to
-- `authenticated`, so RPC could fail and platform Super Admins were not recognized server-side.
GRANT EXECUTE ON FUNCTION public.user_is_platform_super_admin(uuid) TO service_role;
