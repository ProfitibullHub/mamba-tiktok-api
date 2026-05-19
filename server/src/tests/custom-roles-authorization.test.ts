import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionSatisfied } from '../services/authorization.service.js';

test('permissionSatisfied treats roles.manage, manage_roles, assign_roles as synonyms', () => {
    assert.equal(permissionSatisfied(new Set(['roles.manage']), 'manage_roles'), true);
    assert.equal(permissionSatisfied(new Set(['assign_roles']), 'roles.manage'), true);
    assert.equal(permissionSatisfied(new Set(['manage_roles']), 'assign_roles'), true);
    assert.equal(permissionSatisfied(new Set(['other.action']), 'manage_roles'), false);
});

test('permissionSatisfied PRD §5.1 task aliases (create_task, …) match catalog tasks.*', () => {
    assert.equal(permissionSatisfied(new Set(['create_task']), 'tasks.create'), true);
    assert.equal(permissionSatisfied(new Set(['assign_task']), 'tasks.assign'), true);
    assert.equal(permissionSatisfied(new Set(['view_private_tasks']), 'tasks.view_private'), true);
    assert.equal(permissionSatisfied(new Set(['tasks.edit']), 'edit_task'), true);
    assert.equal(permissionSatisfied(new Set(['delete_task']), 'tasks.view'), false);
});

test('permissionSatisfied treats legacy tasks.manage as full tasks.* umbrella', () => {
    const legacy = new Set(['tasks.manage']);
    assert.equal(permissionSatisfied(legacy, 'tasks.view'), true);
    assert.equal(permissionSatisfied(legacy, 'tasks.create_private'), true);
    assert.equal(permissionSatisfied(legacy, 'tasks.assign'), true);
    assert.equal(permissionSatisfied(new Set(['tasks.assign']), 'tasks.delete'), false);
    assert.equal(permissionSatisfied(new Set(['tasks.edit']), 'tasks.manage'), false);
});

test('permissionSatisfied keeps view_pnl alias for financials permissions', () => {
    assert.equal(permissionSatisfied(new Set(['financials.view']), 'view_pnl'), true);
    assert.equal(permissionSatisfied(new Set(['financials.restricted']), 'view_pnl'), true);
    assert.equal(permissionSatisfied(new Set(['tiktok.shop.data']), 'view_pnl'), false);
});
