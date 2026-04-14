import { supabase } from './supabase';

/** When true, permission ceiling + tenant directory use Edge Functions that forward to RPC with the user JWT (see supabase/functions/). */
function teamRolesViaEdge(): boolean {
    const v = import.meta.env.VITE_TEAM_ROLES_VIA_EDGE;
    return v === 'true' || v === '1';
}

/** Structured logging for Team & roles Supabase calls (check console when RPCs fail). */
export function logTeamRpcError(context: string, err: unknown): void {
    const e = err as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
        status?: number;
    };
    console.error(`[Mamba team RPC] ${context}`, {
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        status: e?.status,
        raw: err,
    });
}

/** PostgREST: function missing from schema / wrong name (HTTP 404 body). */
/** Human-readable message for UI (PostgREST errors are plain objects, not always Error). */
export function formatTeamRpcFailure(err: unknown): string {
    if (err == null) return 'Unknown error';
    if (err instanceof Error) return err.message;
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

export function isTeamRpcMissingFromDb(err: unknown): boolean {
    if (err == null) return false;
    const e = err as { message?: string; code?: string; details?: string; status?: number };
    const code = String(e.code ?? '');
    const msg = String(e.message ?? '').toLowerCase();
    const details = String(e.details ?? '').toLowerCase();
    if (code === 'PGRST202' || code === 'PGRST301') return true;
    if (msg.includes('could not find the function') || msg.includes('schema cache')) return true;
    if (details.includes('could not find the function')) return true;
    if (e.status === 404 && (msg.includes('rpc') || msg.includes('function'))) return true;
    return false;
}

export async function createCustomRole(
    tenantId: string,
    name: string,
    description: string | null,
    permissionActions: string[]
) {
    const { data, error } = await supabase.rpc('create_custom_role', {
        p_tenant_id: tenantId,
        p_name: name,
        p_description: description ?? '',
        p_permission_actions: permissionActions,
    });
    if (error) logTeamRpcError(`create_custom_role(${tenantId})`, error);
    return { data: data as string | null, error };
}

export async function updateCustomRole(
    roleId: string,
    name: string | null,
    description: string | null,
    permissionActions: string[] | null
) {
    const { error } = await supabase.rpc('update_custom_role', {
        p_role_id: roleId,
        p_name: name,
        p_description: description,
        p_permission_actions: permissionActions,
    });
    if (error) logTeamRpcError(`update_custom_role(${roleId})`, error);
    return { error };
}

export async function deleteCustomRole(roleId: string) {
    const { error } = await supabase.rpc('delete_custom_role', { p_role_id: roleId });
    if (error) logTeamRpcError(`delete_custom_role(${roleId})`, error);
    return { error };
}

/** Permission actions the current user may assign to custom roles on this tenant; null = unbounded (platform operator). */
export async function getMyCustomRolePermissionCeiling(tenantId: string) {
    if (teamRolesViaEdge()) {
        const { data, error } = await supabase.functions.invoke('get_permission_ceiling', {
            body: { p_tenant_id: tenantId },
        });
        if (error) {
            logTeamRpcError(`Edge get_permission_ceiling(${tenantId})`, error);
            return { data: null, error };
        }
        const payload = data as { actions?: string[] | null; error?: string | null } | null;
        if (payload?.error) {
            const e = new Error(payload.error);
            logTeamRpcError(`Edge get_permission_ceiling body error (${tenantId})`, e);
            return { data: null, error: e };
        }
        return { data: (payload?.actions ?? null) as string[] | null, error: null };
    }

    const attempts = [
        'get_my_custom_role_permission_ceiling',
        'get_user_permission_ceiling',
    ] as const;
    let lastError: unknown;
    for (const fn of attempts) {
        const { data, error } = await supabase.rpc(fn, { p_tenant_id: tenantId });
        if (!error) {
            return { data: data as string[] | null, error: null };
        }
        logTeamRpcError(`${fn}(${tenantId})`, error);
        lastError = error;
        if (!isTeamRpcMissingFromDb(error)) {
            return { data: null, error };
        }
    }
    return {
        data: null,
        error: new Error(
            'Database function get_my_custom_role_permission_ceiling is missing. Apply Supabase migrations (e.g. 20260330240000 and 20260330270000) with supabase db push or the SQL editor.'
        ),
    };
}

export async function tenantSetMemberRole(tenantId: string, userId: string, roleId: string) {
    const { data, error } = await supabase.rpc('tenant_set_member_role', {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_role_id: roleId,
    });
    if (error) logTeamRpcError(`tenant_set_member_role(${tenantId})`, error);
    return { data: data as string | null, error };
}

export async function tenantDirectoryForAdmin(tenantId: string) {
    if (teamRolesViaEdge()) {
        const { data, error } = await supabase.functions.invoke('get_directory_for_tenant', {
            body: { p_tenant_id: tenantId },
        });
        if (error) {
            logTeamRpcError(`Edge get_directory_for_tenant(${tenantId})`, error);
            return { data: null, error };
        }
        const payload = data as { rows?: unknown; error?: string | null } | null;
        if (payload?.error) {
            const e = new Error(payload.error);
            logTeamRpcError(`Edge get_directory_for_tenant body error (${tenantId})`, e);
            return { data: null, error: e };
        }
        return { data: payload?.rows ?? null, error: null };
    }

    const attempts = ['tenant_directory_for_admin', 'get_tenant_directory_for_admin'] as const;
    let lastError: unknown;
    for (const fn of attempts) {
        const { data, error } = await supabase.rpc(fn, { p_tenant_id: tenantId });
        if (!error) {
            return { data, error: null };
        }
        logTeamRpcError(`${fn}(${tenantId})`, error);
        lastError = error;
        if (!isTeamRpcMissingFromDb(error)) {
            return { data: null, error };
        }
    }
    return {
        data: null,
        error: new Error(
            'Database function tenant_directory_for_admin is missing or unreachable. Apply Supabase migrations with supabase db push.'
        ),
    };
}

export async function grantSuperAdminMembership(userId: string) {
    const { data, error } = await supabase.rpc('grant_super_admin_membership', {
        p_user_id: userId,
    });
    if (error) logTeamRpcError(`grant_super_admin_membership(${userId})`, error);
    return { data: data as string | null, error };
}

export async function revokeSuperAdminMembership(userId: string) {
    const { error } = await supabase.rpc('revoke_super_admin_membership', {
        p_user_id: userId,
    });
    if (error) logTeamRpcError(`revoke_super_admin_membership(${userId})`, error);
    return { error };
}

export async function listPlatformSuperAdmins() {
    const { data, error } = await supabase.rpc('list_platform_super_admins');
    if (error) logTeamRpcError('list_platform_super_admins', error);
    return { data, error };
}

/** Seller Admin or internal operator: link user to shop account for dashboard + optional Seller User membership. */
export async function grantUserAccessToSellerAccount(targetUserId: string, accountId: string) {
    const { error } = await supabase.rpc('grant_user_access_to_seller_account', {
        p_target_user_id: targetUserId,
        p_account_id: accountId,
    });
    if (error) logTeamRpcError(`grant_user_access_to_seller_account(${accountId})`, error);
    return { error };
}

/** Agency Admin / Seller Admin: suspend, reactivate, or remove a member within their own tenant. */
export async function manageTenantMember(
    tenantId: string,
    targetUserId: string,
    action: 'suspend' | 'reactivate' | 'remove'
) {
    const { error } = await supabase.rpc('manage_tenant_member', {
        p_tenant_id: tenantId,
        p_target_user: targetUserId,
        p_action: action,
    });
    if (error) logTeamRpcError(`manage_tenant_member(${tenantId}, ${action})`, error);
    return { error };
}
