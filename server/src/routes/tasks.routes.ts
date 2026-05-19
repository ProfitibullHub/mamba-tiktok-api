import express from 'express';
import { supabase } from '../config/supabase.js';
import {
    resolveRequestTenantContext,
    userIsPlatformSuperAdmin,
} from '../middleware/account-access.middleware.js';
import { authorize } from '../services/authorization.service.js';
import { permissionSatisfied } from '../services/authorization.service.js';
import { auditLog } from '../services/audit-logger.js';
import {
    collectAgencySystemRoleNames,
    coordinatorOwnTasksRowScopeFromSystemRoles,
} from '../services/agency-task-coordinator-scope.service.js';
import { isAllowedAgencyTaskStatusTransition } from '../lib/agency-task-kanban-rules.js';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgencyTaskRow = {
    id: string;
    tenant_id: string;
    seller_tenant_id: string;
    title: string;
    description: string | null;
    status: string;
    created_by: string | null;
    assigned_to: string | null;
    is_private: boolean;
    created_at: string;
    updated_at: string;
};

function rpcTruthy(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 't' || v === '1') return true;
    return false;
}

/** PRD §5.2: private tasks are readable only by creator, assignee, or platform super admin. */
async function privateTaskDeniedForUser(userId: string, task: AgencyTaskRow): Promise<boolean> {
    if (!task.is_private) return false;
    if (await userIsPlatformSuperAdmin(userId)) return false;
    return task.created_by !== userId && task.assigned_to !== userId;
}

/** PRD §5.3: Account Coordinator sees only own tasks (creator or assignee), not org-wide rows. */
async function coordinatorOwnTasksDeniesRow(
    agencyTenantId: string,
    userId: string,
    task: AgencyTaskRow,
): Promise<boolean> {
    if (await userIsPlatformSuperAdmin(userId)) return false;
    const systemRoleNames = await collectAgencySystemRoleNames(agencyTenantId, userId);
    if (!coordinatorOwnTasksRowScopeFromSystemRoles(systemRoleNames)) return false;
    return task.created_by !== userId && task.assigned_to !== userId;
}

async function resolveAssignedSellerIds(userId: string): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_assigned_seller_ids', { p_user_id: userId });
    if (error) {
        console.error('[tasks] get_assigned_seller_ids', error.message);
        return [];
    }
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))];
}

async function fetchChildSellerTenantIdsForAgency(agencyTenantId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('tenants')
        .select('id')
        .eq('parent_tenant_id', agencyTenantId)
        .eq('type', 'seller');
    if (error) {
        console.error('[tasks] fetchChildSellerTenantIdsForAgency', error.message);
        return [];
    }
    return [
        ...new Set(
            (data ?? [])
                .map((r: { id?: string }) => r.id)
                .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
        ),
    ];
}

/**
 * PRD §8: `tenant_id` is the acting agency; `seller_tenant_id` must lie in
 * `get_assigned_seller_ids(user) ∩ { child sellers of that agency }`.
 * Agency Admin: RPC returns all active child sellers (see migration `20260523180000_agency_admin_tasks_full_seller_scope.sql`).
 */
async function resolveTaskSellerScope(ctx: { userId: string; tenantId: string }): Promise<string[]> {
    if (await userIsPlatformSuperAdmin(ctx.userId)) {
        const all = await fetchChildSellerTenantIdsForAgency(ctx.tenantId);
        return all.length > 0 ? all : resolveAssignedSellerIds(ctx.userId);
    }
    const underAgency = new Set(await fetchChildSellerTenantIdsForAgency(ctx.tenantId));
    const assigned = await resolveAssignedSellerIds(ctx.userId);
    return assigned.filter((id) => underAgency.has(id));
}

async function sellerAccessible(params: {
    agencyTenantId: string;
    sellerTenantId: string;
    userId: string;
}): Promise<boolean> {
    if (await userIsPlatformSuperAdmin(params.userId)) return true;
    const { data, error } = await supabase.rpc('agency_task_seller_accessible_for_user', {
        p_agency_tenant_id: params.agencyTenantId,
        p_seller_tenant_id: params.sellerTenantId,
        p_user_id: params.userId,
    });
    if (error) {
        console.error('[tasks] agency_task_seller_accessible_for_user', error.message);
        return false;
    }
    return rpcTruthy(data);
}

async function resolvePrimaryAccountForSellerTenant(sellerTenantId: string): Promise<string | null> {
    const { data, error } = await supabase.from('accounts').select('id').eq('tenant_id', sellerTenantId).limit(1);
    if (error || !Array.isArray(data)) {
        console.error('[tasks] resolve account for seller', error?.message);
        return null;
    }
    const id = typeof data[0]?.id === 'string' ? data[0]?.id : null;
    return id;
}

async function enrichTasksWithProfiles(tasks: AgencyTaskRow[]) {
    const ids = new Set<string>();
    for (const t of tasks) {
        if (t.created_by) ids.add(t.created_by);
        if (t.assigned_to) ids.add(t.assigned_to);
    }
    const list = [...ids];
    if (list.length === 0) {
        return tasks.map((t) => ({
            ...t,
            created_by_profile: null as null | { id: string; full_name: string | null; email: string | null },
            assigned_to_profile: null as null | { id: string; full_name: string | null; email: string | null },
        }));
    }
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', list);
    if (error) {
        console.error('[tasks] enrich profiles', error.message);
        return tasks.map((t) => ({
            ...t,
            created_by_profile: null,
            assigned_to_profile: null,
        }));
    }
    const map = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    return tasks.map((t) => ({
        ...t,
        created_by_profile: t.created_by ? map.get(t.created_by) ?? null : null,
        assigned_to_profile: t.assigned_to ? map.get(t.assigned_to) ?? null : null,
    }));
}

/** Require agency JWT context (Phase 2: seller-side UX excluded). */
async function gateAgencyContext(req: express.Request, res: express.Response) {
    const ctx = await resolveRequestTenantContext(req);
    if (!ctx) {
        res.status(401).json({ success: false, error: 'Authorization required' });
        return null;
    }
    if (ctx.tenantType !== 'agency') {
        res.status(403).json({ success: false, error: 'Tasks are available to agency workspaces only.' });
        return null;
    }
    return ctx;
}

router.get('/assignees', async (req: express.Request, res: express.Response) => {
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;

    const auth = await authorize(req, { action: 'tasks.view' });
    if (!auth.allowed) {
        res.status(auth.status).json({ success: false, error: auth.reason });
        return;
    }

    const { data: memberships, error } = await supabase
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'active');
    if (error) {
        console.error('[tasks] assignees memberships', error.message);
        res.status(500).json({ success: false, error: 'Failed to load assignees' });
        return;
    }

    const userIds = [
        ...new Set(
            (Array.isArray(memberships) ? memberships : [])
                .map((m: { user_id?: string }) => m.user_id)
                .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
        ),
    ];

    let profiles: Array<{ id: string; full_name: string | null; email: string | null }> = [];
    if (userIds.length > 0) {
        const { data: profilesData, error: profErr } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);
        if (profErr) {
            console.error('[tasks] assignees profiles', profErr.message);
            res.status(500).json({ success: false, error: 'Failed to load assignees' });
            return;
        }
        profiles = profilesData ?? [];
    }

    const mapped = profiles.map((p) => ({
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
    }));

    mapped.sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
    res.json({ success: true, data: mapped });
});

router.get('/', async (req: express.Request, res: express.Response) => {
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;

    const auth = await authorize(req, { action: 'tasks.view' });
    if (!auth.allowed) {
        res.status(auth.status).json({ success: false, error: auth.reason });
        return;
    }

    const sellerFilter = typeof req.query.sellerTenantId === 'string' ? req.query.sellerTenantId.trim() : '';
    const assignedFilter = typeof req.query.assignedTo === 'string' ? req.query.assignedTo.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    let limit =
        typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 100;
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    limit = Math.min(limit, 200);

    let offset =
        typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const sellerScope = await resolveTaskSellerScope({ userId: ctx.userId, tenantId: ctx.tenantId });
    if (sellerScope.length === 0) {
        res.json({ success: true, data: [], pagination: { limit, offset, total: 0 } });
        return;
    }

    let sellerCandidates = sellerScope;

    if (sellerFilter) {
        if (!UUID_RE.test(sellerFilter) || !sellerCandidates.includes(sellerFilter)) {
            res.status(403).json({ success: false, error: 'Seller not in scope.' });
            return;
        }
        sellerCandidates = [sellerFilter];
    }

    let q = supabase
        .from('agency_tasks')
        .select('*', { count: 'exact' })
        .eq('tenant_id', ctx.tenantId)
        .in('seller_tenant_id', sellerCandidates)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

    const isSa = await userIsPlatformSuperAdmin(ctx.userId);
    const uidEscaped = auth.context.userId.replace(/"/g, '');
    const systemRoleNames = isSa ? new Set<string>() : await collectAgencySystemRoleNames(ctx.tenantId, ctx.userId);
    const coordinatorOwnOnly = !isSa && coordinatorOwnTasksRowScopeFromSystemRoles(systemRoleNames);
    // PRD §5.3: coordinator — own tasks only. PRD §5.2: everyone else — public OR own private (creator/assignee).
    if (coordinatorOwnOnly) {
        q = q.or(`created_by.eq.${uidEscaped},assigned_to.eq.${uidEscaped}`);
    } else if (!isSa) {
        q = q.or(`is_private.eq.false,created_by.eq.${uidEscaped},assigned_to.eq.${uidEscaped}`);
    }

    if (assignedFilter && UUID_RE.test(assignedFilter)) q = q.eq('assigned_to', assignedFilter);

    const allowedStatuses = ['todo', 'in_progress', 'done'];
    if (statusFilter && allowedStatuses.includes(statusFilter)) q = q.eq('status', statusFilter);

    const { data, error, count } = await q;
    if (error) {
        console.error('[tasks] list agency_tasks', error.message);
        res.status(500).json({ success: false, error: 'Failed to load tasks.' });
        return;
    }

    const rows = (Array.isArray(data) ? data : []) as AgencyTaskRow[];
    const enriched = await enrichTasksWithProfiles(rows);
    res.json({
        success: true,
        data: enriched,
        pagination: {
            limit,
            offset,
            total: typeof count === 'number' ? count : enriched.length,
        },
    });
});

router.get('/:taskId', async (req: express.Request, res: express.Response) => {
    const taskId = req.params.taskId;
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;
    if (!UUID_RE.test(taskId)) {
        res.status(400).json({ success: false, error: 'Invalid task id' });
        return;
    }

    const auth = await authorize(req, { action: 'tasks.view' });
    if (!auth.allowed) {
        res.status(auth.status).json({ success: false, error: auth.reason });
        return;
    }

    const { data: row, error } = await supabase.from('agency_tasks').select('*').eq('id', taskId).maybeSingle();

    if (error || !row) {
        if (error) console.error('[tasks] get task', error.message);
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
    }

    const task = row as AgencyTaskRow;
    if (task.tenant_id !== ctx.tenantId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }
    const seeSeller = await sellerAccessible({
        agencyTenantId: ctx.tenantId,
        sellerTenantId: task.seller_tenant_id,
        userId: ctx.userId,
    });
    if (!seeSeller) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    if (await coordinatorOwnTasksDeniesRow(ctx.tenantId, ctx.userId, task)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    if (await privateTaskDeniedForUser(ctx.userId, task)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    const [enrichedRow] = await enrichTasksWithProfiles([task]);
    res.json({ success: true, data: enrichedRow });
});

router.post('/', async (req: express.Request, res: express.Response) => {
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;

    const body = (req.body || {}) as {
        seller_tenant_id?: string;
        title?: string;
        description?: string | null;
        assigned_to?: string | null;
        is_private?: boolean;
    };

    const sellerTenantId =
        typeof body.seller_tenant_id === 'string' ? body.seller_tenant_id.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!UUID_RE.test(sellerTenantId) || title.length === 0) {
        res.status(400).json({ success: false, error: 'seller_tenant_id and title are required.' });
        return;
    }

    const seeSeller = await sellerAccessible({ agencyTenantId: ctx.tenantId, sellerTenantId, userId: ctx.userId });
    if (!seeSeller) {
        res.status(403).json({ success: false, error: 'Seller not accessible for this tenant.' });
        return;
    }

    const accountId = await resolvePrimaryAccountForSellerTenant(sellerTenantId);
    if (!accountId) {
        res.status(400).json({ success: false, error: 'No account mapped for seller tenant.' });
        return;
    }

    const authCreate = await authorize(req, { action: 'tasks.create', accountId });
    if (!authCreate.allowed) {
        res.status(authCreate.status).json({ success: false, error: authCreate.reason });
        return;
    }

    const mergedEff = authCreate.context.effectivePermissions;
    const wantsPrivate = body.is_private === true;
    if (
        wantsPrivate &&
        !permissionSatisfied(mergedEff, 'tasks.create_private') &&
        !(await userIsPlatformSuperAdmin(ctx.userId))
    ) {
        res.status(403).json({ success: false, error: 'Permission missing: tasks.create_private' });
        return;
    }

    let assignedUuid: string | null = null;
    if (typeof body.assigned_to === 'string') {
        const trimmedAssign = body.assigned_to.trim();
        if (trimmedAssign.length > 0) {
            if (!UUID_RE.test(trimmedAssign)) {
                res.status(400).json({ success: false, error: 'Invalid assigned_to' });
                return;
            }

            const authAssign = await authorize(req, { action: 'tasks.assign', accountId });
            if (!authAssign.allowed) {
                res.status(authAssign.status).json({ success: false, error: authAssign.reason });
                return;
            }

            assignedUuid = trimmedAssign;

            const { data: assigneeTenant, error: profErr } = await supabase
                .from('profiles')
                .select('tenant_id')
                .eq('id', trimmedAssign)
                .maybeSingle();
            if (profErr || assigneeTenant?.tenant_id !== ctx.tenantId) {
                res.status(400).json({ success: false, error: 'Assignee must belong to the agency workspace.' });
                return;
            }
            const assigneeOk = await sellerAccessible({
                agencyTenantId: ctx.tenantId,
                sellerTenantId,
                userId: trimmedAssign,
            });
            if (!assigneeOk) {
                res.status(403).json({ success: false, error: 'Assignee does not have access to this seller.' });
                return;
            }
        }
    } else if (body.assigned_to !== undefined && body.assigned_to !== null) {
        res.status(400).json({ success: false, error: 'Invalid assigned_to' });
        return;
    }

    const description =
        typeof body.description === 'string'
            ? body.description
            : body.description === undefined || body.description === null
              ? null
              : '';

    const insertPayload = {
        tenant_id: ctx.tenantId,
        seller_tenant_id: sellerTenantId,
        title,
        description: description === '' ? null : description,
        status: 'todo' as const,
        created_by: ctx.userId,
        assigned_to: assignedUuid,
        is_private: wantsPrivate,
    };

    const { data: inserted, error } = await supabase.from('agency_tasks').insert(insertPayload).select('*').single();

    if (error || !inserted) {
        console.error('[tasks] insert', error?.message);
        res.status(500).json({ success: false, error: 'Could not create task.' });
        return;
    }

    const taskRow = inserted as AgencyTaskRow;
    await auditLog(req, {
        action: 'task.create',
        resourceType: 'agency_task',
        resourceId: taskRow.id,
        tenantId: ctx.tenantId,
        metadata: { seller_tenant_id: sellerTenantId },
        afterState: snapshotTask(taskRow),
    });

    const [enriched] = await enrichTasksWithProfiles([taskRow]);
    res.status(201).json({ success: true, data: enriched });
});

function snapshotTask(t: Partial<AgencyTaskRow>): Record<string, unknown> {
    return {
        id: t.id,
        tenant_id: t.tenant_id,
        seller_tenant_id: t.seller_tenant_id,
        title: t.title,
        description: t.description,
        status: t.status,
        created_by: t.created_by,
        assigned_to: t.assigned_to,
        is_private: t.is_private,
        created_at: t.created_at ?? null,
        updated_at: t.updated_at ?? null,
    };
}

router.patch('/:taskId', async (req: express.Request, res: express.Response) => {
    const taskId = req.params.taskId;
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;

    if (!UUID_RE.test(taskId)) {
        res.status(400).json({ success: false, error: 'Invalid task id' });
        return;
    }

    const { data: raw, error: loadErr } = await supabase.from('agency_tasks').select('*').eq('id', taskId).maybeSingle();
    if (loadErr || !raw) {
        if (loadErr) console.error('[tasks] patch load', loadErr.message);
        res.status(404).json({ success: false, error: 'Task not found.' });
        return;
    }

    const beforeRow = raw as AgencyTaskRow;
    if (beforeRow.tenant_id !== ctx.tenantId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }
    const seeSeller = await sellerAccessible({
        agencyTenantId: ctx.tenantId,
        sellerTenantId: beforeRow.seller_tenant_id,
        userId: ctx.userId,
    });
    if (!seeSeller) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    if (await coordinatorOwnTasksDeniesRow(ctx.tenantId, ctx.userId, beforeRow)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    if (await privateTaskDeniedForUser(ctx.userId, beforeRow)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    const accountId = await resolvePrimaryAccountForSellerTenant(beforeRow.seller_tenant_id);
    if (!accountId) {
        res.status(400).json({ success: false, error: 'No account mapped for seller tenant.' });
        return;
    }

    const payload = (req.body || {}) as {
        title?: string;
        description?: string | null;
        status?: string;
        assigned_to?: string | null;
        is_private?: boolean;
    };

    let needsEdit = Object.prototype.hasOwnProperty.call(payload, 'title')
        || Object.prototype.hasOwnProperty.call(payload, 'description')
        || Object.prototype.hasOwnProperty.call(payload, 'status')
        || Object.prototype.hasOwnProperty.call(payload, 'is_private');
    let needsAssign = Object.prototype.hasOwnProperty.call(payload, 'assigned_to');

    if (!needsEdit && Object.keys(payload).length === 1 && payload.assigned_to !== undefined) needsAssign = true;

    if (needsAssign) {
        const authAssignGate = await authorize(req, { action: 'tasks.assign', accountId });
        if (!authAssignGate.allowed) {
            res.status(authAssignGate.status).json({ success: false, error: authAssignGate.reason });
            return;
        }
    }

    if (needsEdit) {
        const authEdit = await authorize(req, { action: 'tasks.edit', accountId });
        if (!authEdit.allowed) {
            res.status(authEdit.status).json({ success: false, error: authEdit.reason });
            return;
        }
        const eff = authEdit.context.effectivePermissions;
        if (Object.prototype.hasOwnProperty.call(payload, 'is_private')) {
            const togglesPrivate =
                typeof payload.is_private === 'boolean' && payload.is_private !== beforeRow.is_private;
            if (
                togglesPrivate &&
                payload.is_private === true &&
                !permissionSatisfied(eff, 'tasks.create_private') &&
                !(await userIsPlatformSuperAdmin(ctx.userId))
            ) {
                const ownerOk = beforeRow.created_by !== null && beforeRow.created_by === ctx.userId;
                if (!ownerOk) {
                    res.status(403).json({ success: false, error: 'Permission missing: tasks.create_private' });
                    return;
                }
            }
        }
    } else if (!needsAssign) {
        res.status(400).json({ success: false, error: 'No fields to update.' });
        return;
    }

    const updateRow: Partial<AgencyTaskRow> = {};

    if (needsEdit) {
        if (typeof payload.title === 'string') {
            updateRow.title = payload.title.trim();
            if ((updateRow.title?.length ?? 0) === 0) {
                res.status(400).json({ success: false, error: 'title cannot be empty' });
                return;
            }
        }
        if ('description' in payload) {
            updateRow.description =
                payload.description === null || typeof payload.description === 'string'
                    ? payload.description
                    : '';
        }
        if (typeof payload.status === 'string') {
            const s = payload.status.trim();
            if (!['todo', 'in_progress', 'done'].includes(s)) {
                res.status(400).json({ success: false, error: 'invalid status' });
                return;
            }
            if (!isAllowedAgencyTaskStatusTransition(beforeRow.status, s)) {
                res.status(400).json({ success: false, error: 'Invalid task status transition' });
                return;
            }
            updateRow.status = s;
        }
        if (typeof payload.is_private === 'boolean') {
            updateRow.is_private = payload.is_private;
        }
    }

    if (needsAssign) {
        if (payload.assigned_to === undefined) {
            // no-op skip
        } else if (payload.assigned_to === null) {
            updateRow.assigned_to = null;
        } else if (typeof payload.assigned_to === 'string' && UUID_RE.test(payload.assigned_to)) {
            const assign = payload.assigned_to;

            const { data: assigneeTenant, error: profErr } = await supabase
                .from('profiles')
                .select('tenant_id')
                .eq('id', assign)
                .maybeSingle();
            if (profErr || assigneeTenant?.tenant_id !== ctx.tenantId) {
                res.status(400).json({ success: false, error: 'Assignee must belong to the agency workspace.' });
                return;
            }
            const assigneeOk = await sellerAccessible({
                agencyTenantId: ctx.tenantId,
                sellerTenantId: beforeRow.seller_tenant_id,
                userId: assign,
            });
            if (!assigneeOk) {
                res.status(403).json({ success: false, error: 'Assignee does not have access to this seller.' });
                return;
            }
            updateRow.assigned_to = assign;
        } else {
            res.status(400).json({ success: false, error: 'Invalid assigned_to' });
            return;
        }
    }

    if (Object.keys(updateRow).length === 0) {
        res.status(400).json({ success: false, error: 'Nothing to apply.' });
        return;
    }

    const { data: updated, error: updateErr } = await supabase
        .from('agency_tasks')
        .update(updateRow)
        .eq('id', taskId)
        .eq('tenant_id', ctx.tenantId)
        .select('*')
        .maybeSingle();

    if (updateErr || !updated) {
        const msg = updateErr?.message ?? '';
        if (msg.includes('Invalid task status transition')) {
            res.status(400).json({ success: false, error: 'Invalid task status transition' });
            return;
        }
        console.error('[tasks] patch apply', msg);
        res.status(400).json({ success: false, error: msg || 'Update failed.' });
        return;
    }

    const afterRow = updated as AgencyTaskRow;

    const assignmentChanged = (beforeRow.assigned_to ?? null) !== (afterRow.assigned_to ?? null);
    const updateKeys = Object.keys(updateRow);
    const assignOnlyPatch =
        assignmentChanged && updateKeys.length === 1 && updateKeys[0] === 'assigned_to';

    if (assignOnlyPatch) {
        await auditLog(req, {
            action: 'task.assign',
            resourceType: 'agency_task',
            resourceId: afterRow.id,
            tenantId: ctx.tenantId,
            metadata: { seller_tenant_id: beforeRow.seller_tenant_id },
            beforeState: snapshotTask(beforeRow),
            afterState: snapshotTask(afterRow),
        });
    } else {
        await auditLog(req, {
            action: 'task.update',
            resourceType: 'agency_task',
            resourceId: afterRow.id,
            tenantId: ctx.tenantId,
            metadata: {
                seller_tenant_id: beforeRow.seller_tenant_id,
                ...(assignmentChanged ? { assignment_changed: true } : {}),
            },
            beforeState: snapshotTask(beforeRow),
            afterState: snapshotTask(afterRow),
        });
    }

    const [enriched] = await enrichTasksWithProfiles([afterRow]);
    res.json({ success: true, data: enriched });
});

router.delete('/:taskId', async (req: express.Request, res: express.Response) => {
    const taskId = req.params.taskId;
    const ctx = await gateAgencyContext(req, res);
    if (!ctx) return;

    if (!UUID_RE.test(taskId)) {
        res.status(400).json({ success: false, error: 'Invalid task id' });
        return;
    }

    const { data: raw, error: loadErr } = await supabase.from('agency_tasks').select('*').eq('id', taskId).maybeSingle();
    if (loadErr || !raw) {
        res.status(404).json({ success: false, error: 'Task not found.' });
        return;
    }

    const task = raw as AgencyTaskRow;

    if (task.tenant_id !== ctx.tenantId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }
    const visible = await sellerAccessible({
        agencyTenantId: ctx.tenantId,
        sellerTenantId: task.seller_tenant_id,
        userId: ctx.userId,
    });
    if (!visible) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    if (await coordinatorOwnTasksDeniesRow(ctx.tenantId, ctx.userId, task)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    const accountId = await resolvePrimaryAccountForSellerTenant(task.seller_tenant_id);
    if (!accountId) {
        res.status(400).json({ success: false, error: 'No account mapped for seller tenant.' });
        return;
    }

    const authDel = await authorize(req, { action: 'tasks.delete', accountId });
    if (!authDel.allowed) {
        res.status(authDel.status).json({ success: false, error: authDel.reason });
        return;
    }

    if (await privateTaskDeniedForUser(ctx.userId, task)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
    }

    const { error: delErr } = await supabase.from('agency_tasks').delete().eq('id', taskId).eq('tenant_id', ctx.tenantId);

    if (delErr) {
        console.error('[tasks] delete', delErr.message);
        res.status(500).json({ success: false, error: 'Could not delete task.' });
        return;
    }

    await auditLog(req, {
        action: 'task.delete',
        resourceType: 'agency_task',
        resourceId: task.id,
        tenantId: ctx.tenantId,
        metadata: { seller_tenant_id: task.seller_tenant_id },
        beforeState: snapshotTask(task),
    });

    res.json({ success: true });
});

export default router;
