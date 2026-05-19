import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAMBA_REPO_ROOT } from './repo-root.js';

test('custom roles RPC migration uses effective permissions for account and admin checks', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260514120000_custom_roles_effective_permission_rpcs.sql'),
        'utf8'
    );

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.user_has_permission_for_account/);
    assert.match(sql, /get_user_effective_permissions_on_tenant\(p_user_id, a\.tenant_id\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.user_can_manage_tenant_members/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.user_is_agency_admin_of_seller_parent/);
});

test('custom role delete migration cleans memberships and is idempotent', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260515130000_custom_role_delete_membership_cleanup.sql'),
        'utf8'
    );

    assert.match(sql, /DELETE FROM public\.membership_roles WHERE role_id = p_role_id/);
    assert.match(sql, /DELETE FROM public\.tenant_memberships WHERE role_id = p_role_id/);
    assert.match(sql, /IF v_deleted IS NOT NULL THEN/);
});

test('roles uniqueness allows reusing custom role name after soft-delete', () => {
    const sql = readFileSync(
        resolve(MAMBA_REPO_ROOT, 'supabase/migrations/20260515140000_roles_unique_active_custom_only.sql'),
        'utf8'
    );

    assert.match(sql, /DROP CONSTRAINT IF EXISTS roles_tenant_name_unique/);
    assert.match(sql, /uq_roles_custom_tenant_name_active/);
    assert.match(sql, /deleted_at IS NULL/);
});
