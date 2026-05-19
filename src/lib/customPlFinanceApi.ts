import { apiFetch } from './apiClient';

/** Must match server `pl_custom_line_items.category` CHECK constraint. */
export const CUSTOM_PL_CATEGORIES = ['revenue', 'cogs', 'expenses', 'supplementary'] as const;
export type CustomPlCategory = (typeof CUSTOM_PL_CATEGORIES)[number];

export const CUSTOM_PL_CATEGORY_OPTIONS: ReadonlyArray<{
    value: CustomPlCategory;
    label: string;
    description: string;
}> = [
    {
        value: 'revenue',
        label: 'Revenue',
        description: 'Other income or adjustments that increase revenue for the period.',
    },
    {
        value: 'cogs',
        label: 'COGS',
        description: 'Extra product or fulfillment costs not already in TikTok COGS.',
    },
    {
        value: 'expenses',
        label: 'Operating expenses',
        description: 'Costs that roll into operating expenses (e.g. software, rent).',
    },
    {
        value: 'supplementary',
        label: 'Supplementary',
        description: 'Other manual adjustments mapped to the supplementary bucket.',
    },
];

export type CustomPlLineItemDto = {
    id: string;
    seller_tenant_id: string;
    tiktok_shop_id: string;
    category: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
};

export type CustomPlValueDto = {
    id: string;
    line_item_id: string;
    amount: number;
    start_date: string;
    end_date: string | null;
    created_at: string;
    created_by: string | null;
};

export type CustomPlLineCatalogRow = {
    id: string;
    name: string;
    category: string;
    is_active: boolean;
    sort_order: number;
};

function path(accountId: string, suffix: string): string {
    return `/api/tiktok-shop/finance/custom-pl/${accountId}${suffix}`;
}

async function parseJson<T>(res: Response): Promise<{ ok: boolean; status: number; body: T & { success?: boolean; error?: string; data?: unknown } }> {
    const text = await res.text();
    let body: any = {};
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { success: false, error: 'Invalid JSON response' };
    }
    return { ok: res.ok, status: res.status, body };
}

export async function createCustomPlLineItem(
    accountId: string,
    payload: { shop_id: string; category: CustomPlCategory; name: string; sort_order?: number },
): Promise<CustomPlLineItemDto> {
    const res = await apiFetch(path(accountId, '/line-items'), {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    const { ok, body } = await parseJson(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    return body.data as CustomPlLineItemDto;
}

export async function updateCustomPlLineItem(
    accountId: string,
    lineItemId: string,
    payload: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<CustomPlLineItemDto> {
    const res = await apiFetch(path(accountId, `/line-items/${lineItemId}`), {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
    const { ok, body } = await parseJson(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    return body.data as CustomPlLineItemDto;
}

/** PRD: line removal is soft-delete only; historical values remain in the database. */
export async function deactivateCustomPlLineItem(accountId: string, lineItemId: string): Promise<CustomPlLineItemDto> {
    return updateCustomPlLineItem(accountId, lineItemId, { is_active: false });
}

export async function fetchCustomPlLineItemCatalog(
    accountId: string,
    shopCipher: string,
): Promise<CustomPlLineCatalogRow[]> {
    const res = await apiFetch(`${path(accountId, '/line-item-catalog')}?shop_id=${encodeURIComponent(shopCipher)}`);
    const { ok, body } = await parseJson<{ data?: { lines?: CustomPlLineCatalogRow[] } }>(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    const data = body.data as { lines?: CustomPlLineCatalogRow[] } | undefined;
    return Array.isArray(data?.lines) ? data!.lines! : [];
}

export async function appendCustomPlLineItemValue(
    accountId: string,
    lineItemId: string,
    payload: { start_date: string; end_date: string | null; amount: number },
): Promise<CustomPlValueDto> {
    const res = await apiFetch(path(accountId, `/line-items/${lineItemId}/values`), {
        method: 'POST',
        body: JSON.stringify({
            start_date: payload.start_date,
            end_date: payload.end_date,
            amount: payload.amount,
        }),
    });
    const { ok, body } = await parseJson(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    return body.data as CustomPlValueDto;
}

export type PatchCustomPlValuePayload =
    | { end_date: string }
    | { supersede: true; amount: number; start_date: string; end_date?: string | null }
    | { effective_from: string; amount: number; end_date?: string | null };

/** PRD-safe value changes: truncate end_date, split from effective_from, or supersede (new row + prior marked replaced). */
export async function patchCustomPlLineItemValue(
    accountId: string,
    lineItemId: string,
    valueId: string,
    payload: PatchCustomPlValuePayload,
): Promise<CustomPlValueDto> {
    const res = await apiFetch(path(accountId, `/line-items/${lineItemId}/values/${valueId}`), {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
    const { ok, body } = await parseJson(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    return body.data as CustomPlValueDto;
}

/** PRD §5.3: per-shop preference for custom lines with no value overlapping the report range. */
export async function patchCustomPlEmptyValueDisplay(
    accountId: string,
    shopCipher: string,
    emptyValueInRange: 'zero' | 'null',
): Promise<{ id: string; shop_id: string; pl_custom_empty_value_display: string }> {
    const q = new URLSearchParams({ shop_id: shopCipher });
    const res = await apiFetch(`${path(accountId, '/empty-value-display')}?${q.toString()}`, {
        method: 'PATCH',
        body: JSON.stringify({ empty_value_in_range: emptyValueInRange }),
    });
    const { ok, body } = await parseJson(res);
    if (!ok || !body.success) {
        throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    }
    return body.data as { id: string; shop_id: string; pl_custom_empty_value_display: string };
}
