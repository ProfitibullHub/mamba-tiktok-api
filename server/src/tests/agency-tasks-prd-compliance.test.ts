import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAMBA_REPO_ROOT } from './repo-root.js';
import { isAllowedAgencyTaskStatusTransition } from '../lib/agency-task-kanban-rules.js';
import { permissionSatisfied } from '../services/authorization.service.js';
import { taskPermissionEquivalenceMatches } from '../lib/task-permission-aliases.js';
import { coordinatorOwnTasksRowScopeFromSystemRoles } from '../services/agency-task-coordinator-scope.service.js';

test('PRD §4.2 Kanban transitions (allowed / rejected)', () => {
    assert.equal(isAllowedAgencyTaskStatusTransition('todo', 'todo'), true);
    assert.equal(isAllowedAgencyTaskStatusTransition('todo', 'in_progress'), true);
    assert.equal(isAllowedAgencyTaskStatusTransition('todo', 'done'), false);
    assert.equal(isAllowedAgencyTaskStatusTransition('in_progress', 'done'), true);
    assert.equal(isAllowedAgencyTaskStatusTransition('in_progress', 'todo'), false);
    assert.equal(isAllowedAgencyTaskStatusTransition('done', 'in_progress'), true);
    assert.equal(isAllowedAgencyTaskStatusTransition('done', 'todo'), false);
});

test('migration SQL enforces same transition matrix as agency-task-kanban-rules', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260522140000_agency_tasks.sql'),
        'utf8',
    );
    assert.match(sql, /OLD\.status = 'todo' AND NEW\.status <> 'in_progress'/);
    assert.match(sql, /OLD\.status = 'in_progress' AND NEW\.status <> 'done'/);
    assert.match(sql, /OLD\.status = 'done' AND NEW\.status <> 'in_progress'/);
    assert.match(sql, /agency_tasks_enforce_status_transition/);
});

test('migration: agency_tasks row invariants and insert default status', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260522140000_agency_tasks.sql'),
        'utf8',
    );
    assert.match(sql, /agency_tasks_enforce_row_invariants/);
    assert.match(sql, /parent_tenant_id = NEW\.tenant_id/);
    assert.match(sql, /INSERT must start in status todo/);
});

test('RLS: authenticated SELECT policy and visibility helper exist', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260523200000_agency_tasks_rls_authenticated_select.sql'),
        'utf8',
    );
    assert.match(sql, /agency_task_select_allowed_for_user/);
    assert.match(sql, /agency_tasks_select_authenticated/);
    assert.match(sql, /user_is_account_coordinator_only_on_agency/);
});

test('RLS: authenticated DML policies + immutable agency/seller trigger (PRD §12)', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260523210000_agency_tasks_prd_permissions_alias_rows_and_rls_dml.sql'),
        'utf8',
    );
    assert.match(sql, /agency_tasks_insert_authenticated/);
    assert.match(sql, /agency_tasks_update_authenticated/);
    assert.match(sql, /agency_tasks_delete_authenticated/);
    assert.match(sql, /trg_agency_tasks_immutable_agency_seller/);
    assert.match(sql, /INSERT INTO public\.permissions/);
    assert.match(sql, /'view_tasks'/);
});

test('Agency Admin full seller scope migration updates RPCs', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260523180000_agency_admin_tasks_full_seller_scope.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_assigned_seller_ids/);
    assert.match(sql, /membership_roles/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.agency_task_seller_accessible_for_user/);
});

test('RBAC: task permission aliases satisfy catalog actions (PRD §5.1)', () => {
    assert.equal(taskPermissionEquivalenceMatches(new Set(['create_task']), 'tasks.create'), true);
    assert.equal(taskPermissionEquivalenceMatches(new Set(['view_tasks']), 'tasks.view'), true);
    assert.equal(permissionSatisfied(new Set(['edit_task']), 'tasks.edit'), true);
    assert.equal(permissionSatisfied(new Set(['tasks.delete']), 'delete_task'), true);
    assert.equal(permissionSatisfied(new Set(['tasks.manage']), 'create_task'), true);
    assert.equal(permissionSatisfied(new Set(['tasks.manage']), 'view_tasks'), true);
});

test('RBAC: coordinator-only row scope flag (PRD §5.3)', () => {
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Account Coordinator'])), true);
    assert.equal(
        coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Account Coordinator', 'Agency Admin'])),
        false,
    );
    assert.equal(permissionSatisfied(new Set(['tasks.view']), 'tasks.create'), false);
});

test('tasks.routes: PATCH validates transitions before DB and audit uses snapshots', () => {
    const src = readFileSync(resolve(MAMBA_REPO_ROOT, 'server/src/routes/tasks.routes.ts'), 'utf8');
    assert.match(src, /isAllowedAgencyTaskStatusTransition/);
    assert.match(src, /assignOnlyPatch/);
    assert.match(src, /created_at: t\.created_at/);
});

test('tasks.routes: PRD §5.2 private gate + §8 seller scope helpers', () => {
    const src = readFileSync(resolve(MAMBA_REPO_ROOT, 'server/src/routes/tasks.routes.ts'), 'utf8');
    assert.match(src, /privateTaskDeniedForUser/);
    assert.match(src, /get_assigned_seller_ids\(user\) ∩/);
    assert.match(src, /resolveTaskSellerScope/);
});

test('migration: PRD §5.2 strict private visibility (RLS + permission copy)', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260523220000_agency_tasks_prd_strict_private_visibility.sql'),
        'utf8',
    );
    assert.match(sql, /NOT p_is_private/);
    assert.match(sql, /p_created_by IS NOT DISTINCT FROM p_user_id/);
    assert.match(sql, /p_assigned_to IS NOT DISTINCT FROM p_user_id/);
    const m = sql.match(
        /CREATE OR REPLACE FUNCTION public\.agency_task_select_allowed_for_user[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
    );
    assert.ok(m, 'expected agency_task_select_allowed_for_user dollar-quoted body');
    const fnBody = m[1];
    assert.ok(
        !fnBody.includes('view_private_tasks') && !fnBody.includes('tasks.view_private'),
        'select helper must not grant third-party private peek via view_private or manage',
    );
});
