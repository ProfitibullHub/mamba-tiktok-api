import { supabase } from './supabase';

export type PlatformProfileSearchRow = {
    id: string;
    email: string | null;
    full_name: string | null;
};

export type PlatformTenantSearchRow = {
    id: string;
    name: string;
    type: string;
    parent_tenant_id: string | null;
    status: string;
};

/** Legacy admin or platform Super Admin only. */
export async function platformCreateAgencyWithOwner(ownerUserId: string, agencyName: string) {
    const { data, error } = await supabase.rpc('platform_create_agency_with_owner', {
        p_owner_user_id: ownerUserId,
        p_agency_name: agencyName.trim() || 'Agency',
    });
    return { data: data as string | null, error };
}

export async function platformLinkSellerToAgency(agencyTenantId: string, sellerTenantId: string) {
    const { error } = await supabase.rpc('platform_link_seller_to_agency', {
        p_agency_tenant_id: agencyTenantId,
        p_seller_tenant_id: sellerTenantId,
    });
    return { error };
}

export async function platformSearchProfiles(query: string, limit = 20) {
    const { data, error } = await supabase.rpc('platform_search_profiles', {
        p_query: query,
        p_limit: limit,
    });
    return { data: (data || []) as PlatformProfileSearchRow[], error };
}

export async function platformSearchTenantsForOperator(
    query: string,
    kind: 'all' | 'agency' | 'seller' = 'all',
    limit = 30
) {
    const { data, error } = await supabase.rpc('platform_search_tenants_for_operator', {
        p_query: query,
        p_kind: kind,
        p_limit: limit,
    });
    return { data: (data || []) as PlatformTenantSearchRow[], error };
}
