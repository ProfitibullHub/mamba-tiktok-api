-- ---------------------------------------------------------------------------
-- User Notifications Table and RPCs
-- ---------------------------------------------------------------------------

-- 1. Create the `user_notifications` table
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_url VARCHAR(255),
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see only their own notifications
CREATE POLICY "Users can view their own notifications" 
    ON public.user_notifications
    FOR SELECT 
    USING (auth.uid() = user_id);

-- Policy: Users can update their own notifications (e.g., mark as read)
CREATE POLICY "Users can update their own notifications" 
    ON public.user_notifications
    FOR UPDATE 
    USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. create_user_notification RPC
-- SECURITY DEFINER so system functions can safely insert notifications.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user_notification(
    p_user_id UUID,
    p_type VARCHAR(50),
    p_title VARCHAR(255),
    p_message TEXT,
    p_action_url VARCHAR(255) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_id UUID;
BEGIN
    INSERT INTO public.user_notifications (user_id, type, title, message, action_url)
    VALUES (p_user_id, p_type, p_title, p_message, p_action_url)
    RETURNING id INTO v_new_id;
    
    RETURN v_new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Update manage_tenant_member to trigger notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_tenant_member(
    p_tenant_id     UUID,
    p_target_user   UUID,
    p_action        TEXT  -- 'suspend' | 'reactivate' | 'remove'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    UUID := auth.uid();
    v_is_admin  BOOLEAN := FALSE;
    v_membership RECORD;
    v_tenant_name TEXT;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_action NOT IN ('suspend', 'reactivate', 'remove') THEN
        RAISE EXCEPTION 'Invalid action: must be suspend, reactivate, or remove';
    END IF;

    -- Caller must be admin of this specific tenant (scoped check)
    IF public.user_is_agency_admin(p_tenant_id, v_caller)
       OR public.user_is_seller_admin(p_tenant_id, v_caller)
       OR public.user_is_platform_super_admin(v_caller) THEN
        v_is_admin := TRUE;
    END IF;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Only an admin of this tenant can manage its members';
    END IF;

    -- Cannot self-manage
    IF p_target_user = v_caller THEN
        RAISE EXCEPTION 'You cannot manage your own membership';
    END IF;

    -- Fetch the membership for this tenant
    SELECT * INTO v_membership
    FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
      AND user_id = p_target_user;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found for this user in this tenant';
    END IF;

    -- Prevent actions on Super Admins and platform admins
    IF EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_target_user AND role = 'admin'
    ) OR public.user_is_platform_super_admin(p_target_user) THEN
        RAISE EXCEPTION 'Cannot manage a platform admin or Super Admin via this function';
    END IF;

    -- Fetch tenant name for dynamic notification message
    SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
    IF v_tenant_name IS NULL THEN
        v_tenant_name := 'Unknown Tenant';
    END IF;

    IF p_action = 'suspend' THEN
        UPDATE public.tenant_memberships
        SET status = 'deactivated', updated_at = NOW()
        WHERE id = v_membership.id;

        PERFORM public.create_user_notification(
            p_target_user,
            'team_suspend',
            'Access Suspended',
            'Your access to ' || v_tenant_name || ' has been suspended by an administrator.',
            '/'
        );

    ELSIF p_action = 'reactivate' THEN
        UPDATE public.tenant_memberships
        SET status = 'active', updated_at = NOW()
        WHERE id = v_membership.id;

        PERFORM public.create_user_notification(
            p_target_user,
            'team_reactivate',
            'Access Restored',
            'Your access to ' || v_tenant_name || ' has been reactivated.',
            '/'
        );

    ELSIF p_action = 'remove' THEN
        DELETE FROM public.tenant_memberships WHERE id = v_membership.id;

        PERFORM public.create_user_notification(
            p_target_user,
            'team_remove',
            'Removed from Team',
            'You have been removed from ' || v_tenant_name || ' by an administrator.',
            '/'
        );
    END IF;
END;
$$;
