import { supabase } from '../config/supabase.js';

export function statusDisablesTenantAccess(status: string | null | undefined): boolean {
    return status === 'inactive' || status === 'suspended';
}

export function tenantStatusTriggersLifecycle(
    tenantType: string | null | undefined,
    status: string | null | undefined
): { deactivateAgency: boolean; deactivateSeller: boolean } {
    const disabled = statusDisablesTenantAccess(status);
    return {
        deactivateAgency: disabled && tenantType === 'agency',
        deactivateSeller: disabled && tenantType === 'seller',
    };
}

export async function unlinkSellerFromAgencyLifecycle(agencyTenantId: string, sellerTenantId: string): Promise<void> {
    const { error: unlinkErr } = await supabase.rpc('revoke_seller_agency_link', {
        p_agency_tenant_id: agencyTenantId,
        p_seller_tenant_id: sellerTenantId,
    });
    if (unlinkErr) throw unlinkErr;
}

export async function deactivateAgencyLifecycle(agencyTenantId: string): Promise<{ unlinkedSellerIds: string[] }> {
    const { data: linkedSellers, error } = await supabase
        .from('tenants')
        .select('id')
        .eq('parent_tenant_id', agencyTenantId)
        .eq('type', 'seller');

    if (error) throw error;

    const sellerIds = (linkedSellers || []).map((row: any) => row.id as string);
    for (const sellerId of sellerIds) {
        await unlinkSellerFromAgencyLifecycle(agencyTenantId, sellerId);
    }

    return { unlinkedSellerIds: sellerIds };
}

export async function deactivateSellerLifecycle(sellerTenantId: string): Promise<{ revokedAgencyTenantId: string | null }> {
    const { data: seller, error } = await supabase
        .from('tenants')
        .select('parent_tenant_id')
        .eq('id', sellerTenantId)
        .maybeSingle();

    if (error) throw error;

    const agencyTenantId = (seller?.parent_tenant_id as string | null) ?? null;
    if (agencyTenantId) {
        await unlinkSellerFromAgencyLifecycle(agencyTenantId, sellerTenantId);
    }

    return { revokedAgencyTenantId: agencyTenantId };
}
