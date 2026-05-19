/**
 * Ingestion monitoring: which audit_logs rows surface in the ops dashboard,
 * and how they map to product PRD audit sections (RBAC, tenancy, P&L, etc.).
 */

export type MonitoringAuditPrdCategory =
    | 'tiktok_ingestion'
    | 'rbac_permissions_plans'
    | 'financial_visibility'
    | 'exports'
    | 'tenancy'
    | 'branding'
    | 'pl'
    | 'tasks'
    | 'other';

export function monitoringAuditRowIncluded(row: { action?: string | null; resource_type?: string | null }): boolean {
    const action = String(row?.action || '').toLowerCase();
    const resource = String(row?.resource_type || '').toLowerCase();
    return (
        action.startsWith('plan.')
        || action.startsWith('billing.')
        || action.includes('permission')
        || action.startsWith('role.')
        || action.startsWith('member.')
        || resource.includes('entitlement')
        || resource.includes('authorization')
        || resource.includes('tenant_membership')
        || action.startsWith('task.')
        || resource === 'agency_task'
        || action.startsWith('branding.')
        || resource === 'tenant_branding'
        || action.startsWith('tenant.')
        || action.startsWith('assignment.')
        || action.startsWith('admin.tenant_')
        || resource === 'tenant_link'
        || resource === 'user_seller_assignment'
        || resource === 'seller_assignment'
        || (resource === 'tenant' && action.startsWith('admin.'))
        || action.startsWith('financial.')
        || action.startsWith('finance.')
        || resource.includes('seller_financial_visibility')
        || action.startsWith('export.')
        || action.startsWith('pl.')
        // TikTok shop/ads durable sync pipeline (PRD §8 ingestion audit)
        || action.startsWith('tiktok.shop.')
        || action.startsWith('tiktok.ads.')
        || resource === 'ingestion_job'
    );
}

/**
 * PRD-aligned bucket for UI grouping (first matching rule wins).
 */
export function classifyMonitoringAuditPrdCategory(row: {
    action?: string | null;
    resource_type?: string | null;
}): MonitoringAuditPrdCategory {
    const action = String(row?.action || '').toLowerCase();
    const resource = String(row?.resource_type || '').toLowerCase();

    if (action.startsWith('task.') || resource === 'agency_task') return 'tasks';
    if (action.startsWith('branding.') || resource === 'tenant_branding') return 'branding';
    if (action.startsWith('pl.')) return 'pl';
    if (
        action.startsWith('tenant.')
        || action.startsWith('assignment.')
        || action.startsWith('admin.tenant_')
        || resource === 'tenant_link'
        || resource === 'user_seller_assignment'
        || resource === 'seller_assignment'
        || (resource === 'tenant' && action.startsWith('admin.'))
    ) {
        return 'tenancy';
    }
    if (
        action.startsWith('financial.')
        || action.startsWith('finance.visibility')
        || resource.includes('seller_financial_visibility')
    ) {
        return 'financial_visibility';
    }
    if (action.startsWith('export.')) return 'exports';
    if (
        action.startsWith('tiktok.shop.')
        || action.startsWith('tiktok.ads.')
        || resource === 'ingestion_job'
    ) {
        return 'tiktok_ingestion';
    }
    if (
        action.startsWith('role.')
        || action.startsWith('member.')
        || action.includes('permission')
        || action.startsWith('plan.')
        || action.startsWith('billing.')
        || resource.includes('entitlement')
        || resource.includes('authorization')
        || resource.includes('tenant_membership')
        || action.startsWith('finance.')
    ) {
        return 'rbac_permissions_plans';
    }
    return 'other';
}
