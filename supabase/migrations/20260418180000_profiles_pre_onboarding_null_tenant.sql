-- New users should not be forced into a seller tenant (or use their personal name as org)
-- before formal onboarding. Allow INSERT with tenant_id NULL; first tenant_membership / RPC
-- still sets profiles.tenant_id via existing triggers.

DROP TRIGGER IF EXISTS trg_profiles_require_tenant_on_insert ON public.profiles;
DROP FUNCTION IF EXISTS public.enforce_profile_tenant_on_insert();
