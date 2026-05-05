-- Server calls this RPC with the service role, so auth.uid() is NULL. Accept an explicit
-- actor id from trusted API handlers (same permission checks as before).

DROP FUNCTION IF EXISTS public.revoke_seller_agency_link(uuid, uuid);

CREATE OR REPLACE FUNCTION public.revoke_seller_agency_link(
    p_agency_tenant_id uuid,
    p_seller_tenant_id uuid,
    p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := COALESCE(p_actor_id, auth.uid());
    v_account_id uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT (
        public.user_is_agency_admin(p_agency_tenant_id, v_caller)
        OR public.user_is_platform_super_admin(v_caller)
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.tenant_memberships tm
                ON tm.user_id = p.id
               AND tm.tenant_id = p.tenant_id
               AND tm.status = 'active'
            JOIN public.roles r ON r.id = tm.role_id
            WHERE p.id = v_caller
              AND p.tenant_id = p_seller_tenant_id
              AND r.name = 'Seller Admin'
        )
    ) THEN
        RAISE EXCEPTION 'Only Agency Admin, Seller Admin, or Super Admin can unlink sellers';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE id = p_seller_tenant_id
          AND type = 'seller'
          AND parent_tenant_id = p_agency_tenant_id
    ) THEN
        RAISE EXCEPTION 'Seller is not linked to this agency';
    END IF;

    UPDATE public.tenants
    SET parent_tenant_id = NULL,
        link_status = 'active',
        updated_at = NOW()
    WHERE id = p_seller_tenant_id;

    DELETE FROM public.user_seller_assignments
    WHERE seller_tenant_id = p_seller_tenant_id
      AND agency_tenant_id = p_agency_tenant_id;

    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE tenant_id = p_seller_tenant_id
    LIMIT 1;

    IF v_account_id IS NOT NULL THEN
        UPDATE public.dashboard_email_schedules
        SET enabled = false,
            updated_at = NOW()
        WHERE account_id = v_account_id
          AND created_by IN (
              SELECT id
              FROM public.profiles
              WHERE tenant_id = p_agency_tenant_id
          );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_seller_agency_link(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_seller_agency_link(uuid, uuid, uuid) TO authenticated;
