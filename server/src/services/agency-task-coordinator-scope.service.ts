import { supabase } from '../config/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PRD §5.3 Account Coordinator: system roles on this agency tenant (primary + membership_roles),
 * only rows where roles.tenant_id IS NULL (global system roles).
 */
export async function collectAgencySystemRoleNames(
    agencyTenantId: string,
    userId: string,
): Promise<Set<string>> {
    const names = new Set<string>();
    const { data: memberships, error } = await supabase
        .from('tenant_memberships')
        .select('id, role_id')
        .eq('tenant_id', agencyTenantId)
        .eq('user_id', userId)
        .eq('status', 'active');
    if (error) {
        console.error('[agency-task-coordinator-scope] tenant_memberships', error.message);
        return names;
    }
    const rows = Array.isArray(memberships) ? memberships : [];
    if (rows.length === 0) return names;

    const membershipIds = rows
        .map((r: { id?: string }) => r.id)
        .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
    const roleIds = new Set(
        rows
            .map((r: { role_id?: string }) => r.role_id)
            .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
    );

    if (membershipIds.length > 0) {
        const { data: extra, error: mrErr } = await supabase
            .from('membership_roles')
            .select('role_id')
            .in('membership_id', membershipIds)
            .is('revoked_at', null);
        if (mrErr) {
            console.error('[agency-task-coordinator-scope] membership_roles', mrErr.message);
        } else {
            for (const r of extra || []) {
                const id =
                    typeof (r as { role_id?: string }).role_id === 'string' ?
                        (r as { role_id: string }).role_id
                    :   '';
                if (UUID_RE.test(id)) roleIds.add(id);
            }
        }
    }

    if (roleIds.size === 0) return names;
    const { data: roles, error: rErr } = await supabase
        .from('roles')
        .select('name, tenant_id')
        .in('id', [...roleIds]);
    if (rErr) {
        console.error('[agency-task-coordinator-scope] roles', rErr.message);
        return names;
    }
    for (const r of roles || []) {
        const row = r as { name?: string; tenant_id: string | null };
        if (row.tenant_id === null && typeof row.name === 'string') names.add(row.name);
    }
    return names;
}

/**
 * When true, task list/detail must be limited to rows where the user is creator or assignee
 * (within assigned-seller scope). Agency Admin / Account Manager keep org-wide task visibility
 * within their seller scope.
 */
export function coordinatorOwnTasksRowScopeFromSystemRoles(systemRoleNames: ReadonlySet<string>): boolean {
    if (systemRoleNames.has('Agency Admin') || systemRoleNames.has('Account Manager')) return false;
    return systemRoleNames.has('Account Coordinator');
}
