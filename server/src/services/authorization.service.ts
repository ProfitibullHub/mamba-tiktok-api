import type { Request } from 'express';
import { supabase } from '../config/supabase.js';
import { auditLog } from './audit-logger.js';
import { resolveRequestTenantContext, type RequestTenantContext, userCanAccessAccount, userIsPlatformSuperAdmin } from '../middleware/account-access.middleware.js';
import { statusDisablesTenantAccess } from './tenant-lifecycle.service.js';
import {
    ACTION_TIKTOK_SHOP_DATA,
    ACTION_TIKTOK_ADS_DATA,
    FEATURE_TIKTOK_SHOP,
    FEATURE_TIKTOK_ADS,
} from '../constants/tiktok-entitlements.js';
import { isTaskRbacActionName, taskPermissionEquivalenceMatches } from '../lib/task-permission-aliases.js';

/** Narrow shop GET/HEAD: settlements + sync metadata only (no shop-data, orders, or delta). */
export const ACTION_VIEW_PNL_SHOP_FALLBACK = 'view_pnl.shop_fallback';
/** Broader than strict P&L fallback: includes financials.view for cache/settlement reads. */
export const ACTION_FINANCIALS_SHOP_FALLBACK = 'financials.shop_fallback';

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

const ACCOUNT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROLE_DEFINITION_ACTIONS = new Set(['roles.manage', 'manage_roles', 'assign_roles']);

/** Map UI / catalog permissions to the actions enforced on specific routes (e.g. view_pnl ↔ financials.view). */
export function permissionSatisfied(effective: Set<string>, required: string): boolean {
    if (effective.has(required)) return true;
    if (ROLE_DEFINITION_ACTIONS.has(required)) {
        for (const a of ROLE_DEFINITION_ACTIONS) {
            if (effective.has(a)) return true;
        }
    }
    if (required === 'view_pnl') {
        if (effective.has('financials.view')) return true;
        if (effective.has('financials.restricted')) return true;
    }
    if (required === ACTION_VIEW_PNL_SHOP_FALLBACK) {
        return effective.has('view_pnl') || effective.has('financials.restricted');
    }
    if (required === ACTION_FINANCIALS_SHOP_FALLBACK) {
        return (
            effective.has('financials.view') ||
            effective.has('view_pnl') ||
            effective.has('financials.restricted')
        );
    }
    /** PRD §5.1 aliases (`create_task`, …) ↔ catalog `tasks.*` (custom roles / external docs). */
    if (taskPermissionEquivalenceMatches(effective, required)) {
        return true;
    }
    /** Legacy umbrella: custom roles may still carry `tasks.manage` from prior seeds. */
    if (effective.has('tasks.manage') && isTaskRbacActionName(required)) {
        return true;
    }
    return false;
}

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

/** Seller + parent-agency + assignment-agency effective perms (matches user_has_permission_for_account sources). */
async function fetchEffectivePermissionActionsForAccount(userId: string, accountId: string): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_user_effective_permissions_for_account', {
        p_user_id: userId,
        p_account_id: accountId,
    });
    if (error) {
        console.error('[authz] get_user_effective_permissions_for_account', error.message);
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

    let effectiveForRbac = context.effectivePermissions;
    if (options.accountId && ACCOUNT_UUID_RE.test(options.accountId)) {
        const accountScoped = await fetchEffectivePermissionActionsForAccount(context.userId, options.accountId);
        effectiveForRbac = new Set([...context.effectivePermissions, ...accountScoped]);
    }

    const hasPermission = permissionSatisfied(effectiveForRbac, options.action);
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

/**
 * GET/HEAD paths where finance-only roles may read synced settlement/cache metadata without full
 * `tiktok.shop.data` (no shop overview, orders, products, or delta — those stay shop-data only).
 */
export function tiktokShopPathEligibleForNarrowFinancialShopRead(req: Pick<Request, 'method' | 'baseUrl' | 'path'>): boolean {
    const m = (req.method || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') return false;
    const full = `${req.baseUrl || ''}${req.path || ''}`.split('?')[0];
    if (full.includes('/clear')) return false;
    const patterns = [
        /\/api\/tiktok-shop\/settlements\/synced\/[^/]+$/,
        /\/api\/tiktok-shop\/cache-status\/[^/]+$/,
    ];
    return patterns.some((re) => re.test(full));
}

/** TikTok Shop read routes: tiktok.shop.data, or narrow finance fallbacks on settlement/cache paths only. */
export async function authorizeTikTokShopDataReadWithFinancialFallback(
    req: Request,
    accountId: string
): Promise<AuthorizationResult> {
    const primary = await authorize(req, {
        action: ACTION_TIKTOK_SHOP_DATA,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId,
    });
    if (primary.allowed) return primary;
    if (
        primary.status === 403 &&
        (primary.reason?.includes('Permission missing') ?? false) &&
        tiktokShopPathEligibleForNarrowFinancialShopRead(req)
    ) {
        const asPnl = await authorize(req, {
            action: ACTION_VIEW_PNL_SHOP_FALLBACK,
            featureKey: FEATURE_TIKTOK_SHOP,
            accountId,
        });
        if (asPnl.allowed) return asPnl;
        return authorize(req, {
            action: ACTION_FINANCIALS_SHOP_FALLBACK,
            featureKey: FEATURE_TIKTOK_SHOP,
            accountId,
        });
    }
    return primary;
}

/** Ads read routes: tiktok.ads.data, or financials.view on GET/HEAD (marketing spend for full-financial roles). */
export async function authorizeTikTokAdsDataReadWithFinancialFallback(
    req: Request,
    accountId: string
): Promise<AuthorizationResult> {
    const primary = await authorize(req, {
        action: ACTION_TIKTOK_ADS_DATA,
        featureKey: FEATURE_TIKTOK_ADS,
        accountId,
    });
    if (primary.allowed) return primary;
    const m = (req.method || 'GET').toUpperCase();
    if (
        primary.status === 403 &&
        (primary.reason?.includes('Permission missing') ?? false) &&
        (m === 'GET' || m === 'HEAD' || m === 'OPTIONS')
    ) {
        return authorize(req, {
            action: 'financials.view',
            featureKey: FEATURE_TIKTOK_ADS,
            accountId,
        });
    }
    return primary;
}

/** Synced shop data OR P&L permission, for non-HTTP-path checks (e.g. dashboard email export). */
export async function authorizeTiktokShopDataOrViewPnl(
    req: Request,
    accountId: string,
    denyAction?: string
): Promise<AuthorizationResult> {
    const primary = await authorize(req, {
        action: ACTION_TIKTOK_SHOP_DATA,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId,
        denyAction,
    });
    if (primary.allowed) return primary;
    if (primary.status === 403 && (primary.reason?.includes('Permission missing') ?? false)) {
        return authorize(req, {
            action: 'view_pnl',
            featureKey: FEATURE_TIKTOK_SHOP,
            accountId,
            denyAction,
        });
    }
    return primary;
}
