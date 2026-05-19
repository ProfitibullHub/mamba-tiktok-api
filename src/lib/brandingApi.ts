import { apiFetch } from './apiClient';

export type CustomPreset = {
    id: string; // generate a random ID so we can overwrite/delete easily
    name: string;
    primaryColor: string;
    secondaryColor: string;
    bgColor: string;
    sidebarBgColor: string;
    sidebarBorderColor: string;
    cardBgColor: string;
    cardBorderColor: string;
    textColor: string;
    textMutedColor: string;
    btnTextColor: string;
    cardHoverColor: string;
    interactiveHoverBg: string;
    interactiveFocusRing: string;
    successBg: string;
    successText: string;
    successBorder: string;
    warningBg: string;
    warningText: string;
    warningBorder: string;
    dangerBg: string;
    dangerText: string;
    dangerBorder: string;
    infoBg: string;
    infoText: string;
    infoBorder: string;
    profitColor: string;
    lossColor: string;
    primaryCardBg: string;
    primaryCardBorder: string;
    secondaryCardBg: string;
    secondaryCardBorder: string;
    toastSuccessBg: string;
    toastSuccessBorder: string;
    toastSuccessIcon: string;
    toastErrorBg: string;
    toastErrorBorder: string;
    toastErrorIcon: string;
    toastInfoBg: string;
    toastInfoBorder: string;
    toastInfoIcon: string;
    toastWarningBg: string;
    toastWarningBorder: string;
    toastWarningIcon: string;
    chartGrid: string;
    chartAxis: string;
    chartSeries1: string;
    chartSeries2: string;
    chartSeries3: string;
    chartSeries4: string;
    chartSeries5: string;
    chartSeries6: string;
    chartPositive: string;
    chartNegative: string;
    chartNeutral: string;
};

export type BrandingResolved = {
    agencyTenantId: string | null;
    source: 'configured' | 'platform_default';
    primaryColor: string;
    secondaryColor: string;
    bgColor: string | null;
    sidebarBgColor: string | null;
    sidebarBorderColor: string | null;
    cardBgColor: string | null;
    cardBorderColor: string | null;
    textColor: string | null;
    textMutedColor: string | null;
    btnTextColor: string | null;
    cardHoverColor: string | null;
    interactiveHoverBg: string | null;
    interactiveFocusRing: string | null;
    successBg: string | null;
    successText: string | null;
    successBorder: string | null;
    warningBg: string | null;
    warningText: string | null;
    warningBorder: string | null;
    dangerBg: string | null;
    dangerText: string | null;
    dangerBorder: string | null;
    infoBg: string | null;
    infoText: string | null;
    infoBorder: string | null;
    profitColor: string | null;
    lossColor: string | null;
    primaryCardBg: string | null;
    primaryCardBorder: string | null;
    secondaryCardBg: string | null;
    secondaryCardBorder: string | null;
    toastSuccessBg: string | null;
    toastSuccessBorder: string | null;
    toastSuccessIcon: string | null;
    toastErrorBg: string | null;
    toastErrorBorder: string | null;
    toastErrorIcon: string | null;
    toastInfoBg: string | null;
    toastInfoBorder: string | null;
    toastInfoIcon: string | null;
    toastWarningBg: string | null;
    toastWarningBorder: string | null;
    toastWarningIcon: string | null;
    chartGrid: string | null;
    chartAxis: string | null;
    chartSeries1: string | null;
    chartSeries2: string | null;
    chartSeries3: string | null;
    chartSeries4: string | null;
    chartSeries5: string | null;
    chartSeries6: string | null;
    chartPositive: string | null;
    chartNegative: string | null;
    chartNeutral: string | null;
    displayName: string;
    emailSenderName: string | null;
    emailSenderAddress: string | null;
    customPresets: CustomPreset[];
    updatedAt: string | null;
    /** Short-lived signed URL for private Storage object; refresh via refetch when expired. */
    logoSignedUrl: string | null;
};

export type PatchBrandingBody = {
    agencyTenantId?: string;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    bgColor?: string | null;
    sidebarBgColor?: string | null;
    sidebarBorderColor?: string | null;
    cardBgColor?: string | null;
    cardBorderColor?: string | null;
    textColor?: string | null;
    textMutedColor?: string | null;
    btnTextColor?: string | null;
    cardHoverColor?: string | null;
    interactiveHoverBg?: string | null;
    interactiveFocusRing?: string | null;
    successBg?: string | null;
    successText?: string | null;
    successBorder?: string | null;
    warningBg?: string | null;
    warningText?: string | null;
    warningBorder?: string | null;
    dangerBg?: string | null;
    dangerText?: string | null;
    dangerBorder?: string | null;
    infoBg?: string | null;
    infoText?: string | null;
    infoBorder?: string | null;
    profitColor?: string | null;
    lossColor?: string | null;
    primaryCardBg?: string | null;
    primaryCardBorder?: string | null;
    secondaryCardBg?: string | null;
    secondaryCardBorder?: string | null;
    toastSuccessBg?: string | null;
    toastSuccessBorder?: string | null;
    toastSuccessIcon?: string | null;
    toastErrorBg?: string | null;
    toastErrorBorder?: string | null;
    toastErrorIcon?: string | null;
    toastInfoBg?: string | null;
    toastInfoBorder?: string | null;
    toastInfoIcon?: string | null;
    toastWarningBg?: string | null;
    toastWarningBorder?: string | null;
    toastWarningIcon?: string | null;
    chartGrid?: string | null;
    chartAxis?: string | null;
    chartSeries1?: string | null;
    chartSeries2?: string | null;
    chartSeries3?: string | null;
    chartSeries4?: string | null;
    chartSeries5?: string | null;
    chartSeries6?: string | null;
    chartPositive?: string | null;
    chartNegative?: string | null;
    chartNeutral?: string | null;
    displayName?: string | null;
    emailSenderName?: string | null;
    emailSenderAddress?: string | null;
    customPresets?: CustomPreset[];
};

export async function fetchBranding(agencyTenantId?: string, accountId?: string): Promise<BrandingResolved> {
    const params = new URLSearchParams();
    if (agencyTenantId) params.set('agencyTenantId', agencyTenantId);
    if (accountId) params.set('accountId', accountId);
    const q = params.size > 0 ? `?${params}` : '';
    const res = await apiFetch(`/api/branding${q}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText || 'Failed to load branding');
    }
    if (!(json as { success?: boolean }).success || !(json as { data?: BrandingResolved }).data) {
        throw new Error((json as { error?: string }).error || 'Invalid branding response');
    }
    const data = (json as { data: BrandingResolved }).data;
    return { ...data, logoSignedUrl: data.logoSignedUrl ?? null };
}

export async function uploadBrandingLogo(agencyTenantId: string | undefined, file: File): Promise<BrandingResolved> {
    const fd = new FormData();
    fd.append('file', file);
    if (agencyTenantId) {
        fd.append('agencyTenantId', agencyTenantId);
    }
    const res = await apiFetch('/api/branding/logo', {
        method: 'POST',
        body: fd,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText || 'Logo upload failed');
    }
    if (!(json as { success?: boolean }).success || !(json as { data?: BrandingResolved }).data) {
        throw new Error((json as { error?: string }).error || 'Invalid branding response');
    }
    const data = (json as { data: BrandingResolved }).data;
    return { ...data, logoSignedUrl: data.logoSignedUrl ?? null };
}

export async function deleteBrandingLogo(agencyTenantId?: string): Promise<BrandingResolved> {
    const q = agencyTenantId ? `?agencyTenantId=${encodeURIComponent(agencyTenantId)}` : '';
    const res = await apiFetch(`/api/branding/logo${q}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText || 'Failed to remove logo');
    }
    if (!(json as { success?: boolean }).success || !(json as { data?: BrandingResolved }).data) {
        throw new Error((json as { error?: string }).error || 'Invalid branding response');
    }
    const data = (json as { data: BrandingResolved }).data;
    return { ...data, logoSignedUrl: data.logoSignedUrl ?? null };
}

export async function patchBranding(body: PatchBrandingBody): Promise<BrandingResolved> {
    const res = await apiFetch('/api/branding', {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText || 'Failed to save branding');
    }
    if (!(json as { success?: boolean }).success || !(json as { data?: BrandingResolved }).data) {
        throw new Error((json as { error?: string }).error || 'Invalid branding response');
    }
    const data = (json as { data: BrandingResolved }).data;
    return { ...data, logoSignedUrl: data.logoSignedUrl ?? null };
}
