import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorOwnTasksRowScopeFromSystemRoles } from '../services/agency-task-coordinator-scope.service.js';

test('coordinator row scope: Agency Admin / AM are not limited to own tasks', () => {
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Agency Admin'])), false);
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Account Manager'])), false);
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Account Manager', 'Account Coordinator'])), false);
});

test('coordinator row scope: Account Coordinator without AM/Admin is limited', () => {
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set(['Account Coordinator'])), true);
});

test('coordinator row scope: custom-role-only (no system staff role) stays broad at API layer', () => {
    assert.equal(coordinatorOwnTasksRowScopeFromSystemRoles(new Set()), false);
});
