import { apiFetch } from './apiClient';

export type SellerMessagingRecipientsResponse = {
    recipientUserIds: string[];
    canManage: boolean;
    usesDefault: boolean;
};

export async function getSellerMessagingRecipients(
    sellerTenantId: string,
): Promise<SellerMessagingRecipientsResponse> {
    const params = new URLSearchParams({ sellerTenantId });
    const res = await apiFetch(`/api/messaging/seller-recipients?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : `Load failed (${res.status})`);
    }
    return json.data as SellerMessagingRecipientsResponse;
}

export async function putSellerMessagingRecipients(
    sellerTenantId: string,
    recipientUserIds: string[],
): Promise<{ recipientUserIds: string[]; usesDefault: boolean }> {
    const res = await apiFetch('/api/messaging/seller-recipients', {
        method: 'PUT',
        body: JSON.stringify({ sellerTenantId, recipientUserIds }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : `Save failed (${res.status})`);
    }
    return json.data as { recipientUserIds: string[]; usesDefault: boolean };
}
