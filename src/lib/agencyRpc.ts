import { supabase } from './supabase';

/** Creates an agency tenant; caller becomes Agency Admin. Returns agency tenant id. */
export async function createAgencyTenant(name?: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('create_agency_tenant', {
        p_name: name?.trim() || null,
    });
    if (error) throw error;
    if (!data) throw new Error('create_agency_tenant returned no id');
    return data as string;
}

/** Agency Admin: add or update staff (Agency Admin | Account Manager | Account Coordinator). */
export async function agencyAddStaffMembership(
    agencyTenantId: string,
    userId: string,
    roleName: 'Agency Admin' | 'Account Manager' | 'Account Coordinator'
): Promise<string> {
    const { data, error } = await supabase.rpc('agency_add_staff_membership', {
        p_agency_tenant_id: agencyTenantId,
        p_user_id: userId,
        p_role_name: roleName,
    });
    if (error) throw error;
    if (!data) throw new Error('agency_add_staff_membership returned no membership id');
    return data as string;
}

/** Agency Admin: attach seller tenant under this agency. */
export async function agencyLinkSellerTenant(agencyTenantId: string, sellerTenantId: string): Promise<void> {
    const { error } = await supabase.rpc('agency_link_seller_tenant', {
        p_agency_tenant_id: agencyTenantId,
        p_seller_tenant_id: sellerTenantId,
    });
    if (error) throw error;
}

/** Agency Admin: grant AM/AC access to a linked seller (user_seller_assignments). */
export async function agencyGrantStaffSellerAccess(
    agencyTenantId: string,
    staffUserId: string,
    sellerTenantId: string
): Promise<void> {
    const { error } = await supabase.rpc('agency_grant_staff_seller_access', {
        p_agency_tenant_id: agencyTenantId,
        p_staff_user_id: staffUserId,
        p_seller_tenant_id: sellerTenantId,
    });
    if (error) throw error;
}
