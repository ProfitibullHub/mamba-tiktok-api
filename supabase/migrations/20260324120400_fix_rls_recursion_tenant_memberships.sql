-- Fix PostgREST / Postgres 42P17 (infinite recursion) on tenant_memberships RLS.
-- Policies must not subquery tenant_memberships directly — that re-enters RLS.
-- SECURITY DEFINER helpers read memberships without triggering recursive checks.

CREATE OR REPLACE FUNCTION public.user_active_tenant_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tm.tenant_id
    FROM tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND tm.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.user_active_tenant_membership_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tm.id
    FROM tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND tm.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.user_active_tenant_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_active_tenant_membership_ids(uuid) FROM PUBLIC;

DROP POLICY IF EXISTS "tenant_memberships_select_own" ON tenant_memberships;
DROP POLICY IF EXISTS "tenant_memberships_select_cotenant" ON tenant_memberships;
DROP POLICY IF EXISTS "tenant_memberships_select_visible" ON tenant_memberships;

-- Own row OR any membership row for a tenant the user belongs to (team visibility)
CREATE POLICY "tenant_memberships_select_visible" ON tenant_memberships FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    OR tenant_id IN (SELECT public.user_active_tenant_ids(auth.uid()))
);

DROP POLICY IF EXISTS "user_seller_assignments_select" ON user_seller_assignments;

CREATE POLICY "user_seller_assignments_select" ON user_seller_assignments FOR SELECT TO authenticated
USING (
    tenant_membership_id IN (SELECT public.user_active_tenant_membership_ids(auth.uid()))
);

-- Remove legacy tenants policy that subqueried tenant_memberships (only if 201+ replaced it with tenants_select_visible).
DO $drop_legacy_tenants$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'tenants_select_visible'
    ) THEN
        EXECUTE 'DROP POLICY IF EXISTS "tenants_select_member" ON tenants';
    END IF;
END
$drop_legacy_tenants$;

COMMENT ON FUNCTION public.user_active_tenant_ids IS 'RLS helper: tenant IDs where user has active membership (bypasses RLS).';
COMMENT ON FUNCTION public.user_active_tenant_membership_ids IS 'RLS helper: tenant_memberships.id rows for user (bypasses RLS).';
