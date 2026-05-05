import { supabase } from '../config/supabase.js';

const BRANDING_LOGO_BUCKET = 'tenant-branding-logos';
const BRANDING_LOGO_SIGNED_SECONDS = Number(process.env.BRANDING_LOGO_SIGNED_TTL_SEC || 3600);

export type ResolvedTenantBranding = {
    agencyTenantId: string | null;
    displayName: string;
    primaryColor: string;
    secondaryColor: string;
    emailSenderName: string | null;
    emailSenderAddress: string | null;
    logoSignedUrl: string | null;
};

const DEFAULT_BRANDING: ResolvedTenantBranding = {
    agencyTenantId: null,
    displayName: 'Mamba',
    primaryColor: '#ec4899',
    secondaryColor: '#6366f1',
    emailSenderName: null,
    emailSenderAddress: null,
    logoSignedUrl: null,
};

async function resolveAgencyTenantId(tenantId: string | null | undefined): Promise<string | null> {
    if (!tenantId) return null;
    const { data, error } = await supabase
        .from('tenants')
        .select('id, type, parent_tenant_id')
        .eq('id', tenantId)
        .maybeSingle();
    if (error || !data) return null;
    if (data.type === 'agency') return data.id as string;
    if (data.type === 'seller' && typeof data.parent_tenant_id === 'string') return data.parent_tenant_id;
    return null;
}

export async function resolveTenantBranding(tenantId: string | null | undefined): Promise<ResolvedTenantBranding> {
    const agencyTenantId = await resolveAgencyTenantId(tenantId);
    if (!agencyTenantId) return DEFAULT_BRANDING;

    const { data, error } = await supabase
        .from('tenant_branding')
        .select('display_name, primary_color, secondary_color, email_sender_name, email_sender_address, logo_object_path')
        .eq('tenant_id', agencyTenantId)
        .maybeSingle();

    if (error || !data) {
        return { ...DEFAULT_BRANDING, agencyTenantId };
    }

    let logoSignedUrl: string | null = null;
    if (data.logo_object_path) {
        const { data: signed, error: signErr } = await supabase.storage
            .from(BRANDING_LOGO_BUCKET)
            .createSignedUrl(data.logo_object_path, BRANDING_LOGO_SIGNED_SECONDS);
        if (!signErr && signed?.signedUrl) logoSignedUrl = signed.signedUrl;
    }

    return {
        agencyTenantId,
        displayName: data.display_name?.trim() || DEFAULT_BRANDING.displayName,
        primaryColor: data.primary_color?.trim() || DEFAULT_BRANDING.primaryColor,
        secondaryColor: data.secondary_color?.trim() || DEFAULT_BRANDING.secondaryColor,
        emailSenderName: data.email_sender_name?.trim() || null,
        emailSenderAddress: data.email_sender_address?.trim() || null,
        logoSignedUrl,
    };
}

export function buildBrandedFromAddress(branding: ResolvedTenantBranding): string | null {
    if (!branding.emailSenderAddress?.trim()) return null;
    /** Whitelabel display name first so inbox "From" matches the product (not e.g. "noreply"). */
    const senderName =
        branding.displayName?.trim() || branding.emailSenderName?.trim() || 'Mamba';
    return `${senderName} <${branding.emailSenderAddress.trim()}>`;
}
