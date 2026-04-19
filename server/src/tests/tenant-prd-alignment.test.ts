import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    statusDisablesTenantAccess,
    tenantStatusTriggersLifecycle,
} from '../services/tenant-lifecycle.service.js';

test('statusDisablesTenantAccess matches PRD deactivation statuses', () => {
    assert.equal(statusDisablesTenantAccess('active'), false);
    assert.equal(statusDisablesTenantAccess('inactive'), true);
    assert.equal(statusDisablesTenantAccess('suspended'), true);
    assert.equal(statusDisablesTenantAccess(undefined), false);
});

test('tenantStatusTriggersLifecycle applies agency and seller cleanup only when disabled', () => {
    assert.deepEqual(tenantStatusTriggersLifecycle('agency', 'inactive'), {
        deactivateAgency: true,
        deactivateSeller: false,
    });
    assert.deepEqual(tenantStatusTriggersLifecycle('seller', 'suspended'), {
        deactivateAgency: false,
        deactivateSeller: true,
    });
    assert.deepEqual(tenantStatusTriggersLifecycle('seller', 'active'), {
        deactivateAgency: false,
        deactivateSeller: false,
    });
});

test('PRD migration contains last-admin and unlink cleanup guards', () => {
    const sql = readFileSync(
        resolve(process.cwd(), 'supabase/migrations/20260416120000_prd_tenancy_alignment.sql'),
        'utf8'
    );

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ensure_not_last_admin/);
    assert.match(sql, /DELETE FROM public\.user_seller_assignments/);
    assert.match(sql, /UPDATE public\.dashboard_email_schedules/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.revoke_seller_agency_link/);
});

test('PRD invariants migration enforces type immutability and tenancy audits', () => {
    const sql = readFileSync(
        resolve(process.cwd(), 'supabase/migrations/20260416150000_tenant_invariants_audit_and_account_path.sql'),
        'utf8'
    );

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.prevent_tenant_type_change/);
    assert.match(sql, /CREATE TRIGGER trg_prevent_tenant_type_change/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_tenant_single/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.audit_tenant_link_change/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.audit_user_seller_assignment_change/);
});
