import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('RBAC v2 migration includes multi-role, entitlements, and financial restriction controls', () => {
    const sql = readFileSync(
        resolve(process.cwd(), 'supabase/migrations/20260417100000_rbac_v2_full_alignment.sql'),
        'utf8'
    );

    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.membership_roles/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.tenant_plan_entitlements/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.seller_financial_visibility_rules/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.tenant_feature_allowed/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_financial_field_access/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_user_effective_permissions_on_tenant/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delete_custom_role/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.audit_plan_entitlement_changes/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.audit_financial_visibility_rule_changes/);
});
