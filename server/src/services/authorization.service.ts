import type { Request } from 'express';
import { supabase } from '../config/supabase.js';
import { auditLog } from './audit-logger.js';
import { resolveRequestTenantContext, type RequestTenantContext, userCanAccessAccount, userIsPlatformSuperAdmin } from '../middleware/account-access.middleware.js';
import { statusDisablesTenantAccess } from './tenant-lifecycle.service.js';

export type AuthorizationContext = RequestTenantContext & {
    effectivePermissions: Set<string>;
};

export type AuthorizeOptions = {
    action: string;
    accountId?: string;
    featureKey?: string;
    denyAction?: string;
};

export type AuthorizationResult =
    | { allowed: true; context: AuthorizationContext }
    | { allowed: false; status: 401 | 403; reason: string; context?: AuthorizationContext };

const RBAC_V2_AUTHZ_ENABLED = process.env.RBAC_V2_AUTHZ !== 'false';

async function fetchEffectivePermissionActions(userId: string, tenantId: string): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_user_effective_permissions_on_tenant', {
        p_user_id: userId,
        p_tenant_id: tenantId,
    });
    if (error) {
        console.error('[authz] get_user_effective_permissions_on_tenant', error.message);
        return new Set<string>();
    }
    const rows = Array.isArray(data) ? data : [];
    const out = new Set<string>();
    for (const row of rows) {
        const action = typeof row?.action === 'string' ? row.action : null;
        if (action) out.add(action);
    }
    return out;
}

async function featureAllowed(tenantId: string, featureKey: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('tenant_feature_allowed', {
        p_tenant_id: tenantId,
        p_feature_key: featureKey,
    });
    if (error) {
        console.error('[authz] tenant_feature_allowed', error.message);
        return false;
    }
    return data === true;
}

async function resolveFeatureTenantId(
    contextTenantId: string,
    accountId?: string
): Promise<string> {
    if (!accountId) return contextTenantId;
    const { data, error } = await supabase.from('accounts').select('tenant_id').eq('id', accountId).maybeSingle();
    if (error) {
        console.error('[authz] resolve feature tenant from account', error.message);
        return contextTenantId;
    }
    const tenantId = typeof data?.tenant_id === 'string' ? data.tenant_id : null;
    return tenantId || contextTenantId;
}

async function logDenied(req: Request, options: AuthorizeOptions, reason: string, context?: AuthorizationContext): Promise<void> {
    await auditLog(req, {
        action: options.denyAction || 'permission.denied',
        resourceType: 'authorization',
        tenantId: context?.tenantId || null,
        metadata: {
            reason,
            action: options.action,
            accountId: options.accountId || null,
            featureKey: options.featureKey || null,
        },
    });
}

export async function resolveAuthorizationContext(req: Request): Promise<AuthorizationContext | null> {
    const base = await resolveRequestTenantContext(req);
    if (!base) return null;
    const effectivePermissions = await fetchEffectivePermissionActions(base.userId, base.tenantId);
    return {
        ...base,
        effectivePermissions,
    };
}

export async function authorize(req: Request, options: AuthorizeOptions): Promise<AuthorizationResult> {
    const context = await resolveAuthorizationContext(req);
    if (!context) {
        await logDenied(req, options, 'unauthenticated');
        return { allowed: false, status: 401, reason: 'Authorization required' };
    }

    if (statusDisablesTenantAccess(context.tenantStatus)) {
        await logDenied(req, options, 'tenant_inactive_or_suspended', context);
        return { allowed: false, status: 403, reason: 'Access blocked while tenant is inactive or suspended', context };
    }

    // Platform super admins bypass tenant-scoped RBAC + plan entitlements.
    // Their role is global and should never be blocked by account tenant feature flags.
    if (await userIsPlatformSuperAdmin(context.userId)) {
        return { allowed: true, context };
    }

    if (options.accountId) {
        const okAccount = await userCanAccessAccount(context.userId, options.accountId, req.method, req);
        if (!okAccount) {
            await logDenied(req, options, 'account_scope_denied', context);
            return { allowed: false, status: 403, reason: 'Access denied', context };
        }
    }

    if (!RBAC_V2_AUTHZ_ENABLED) {
        return { allowed: true, context };
    }

    const hasPermission = context.effectivePermissions.has(options.action);
    if (!hasPermission) {
        await logDenied(req, options, 'permission_missing', context);
        return { allowed: false, status: 403, reason: `Permission missing: ${options.action}`, context };
    }

    if (options.featureKey) {
        // For account-scoped routes, entitlement must be evaluated on the owning seller tenant
        // (accounts.tenant_id), not the caller's current profile tenant.
        const featureTenantId = await resolveFeatureTenantId(context.tenantId, options.accountId);
        const allowed = await featureAllowed(featureTenantId, options.featureKey);
        if (!allowed) {
            await logDenied(req, options, 'plan_entitlement_denied', context);
            return { allowed: false, status: 403, reason: `Plan does not allow: ${options.featureKey}`, context };
        }
    }

    return { allowed: true, context };
}
