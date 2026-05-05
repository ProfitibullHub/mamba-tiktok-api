import { apiFetch } from './apiClient';

export const FINANCIAL_RESTRICTION_FIELD_OPTIONS = [
    { id: 'cogs', label: 'COGS (Cost of Goods Sold)' },
    { id: 'margin', label: 'Margin values' },
    { id: 'custom_line_items', label: 'Custom line items' },
    { id: 'gross_profit', label: 'Gross profit line' },
    { id: 'net_profit', label: 'Net profit line' },
    { id: 'platform_fees', label: 'Platform fees line' },
    { id: 'affiliate_commissions', label: 'Affiliate commissions line' },
    { id: 'shipping_costs', label: 'Shipping costs line' },
    { id: 'agency_fees', label: 'Agency fees line' },
    { id: 'ad_spend', label: 'Ad spend line' },
] as const;

export type FinancialRestrictionFieldId = (typeof FINANCIAL_RESTRICTION_FIELD_OPTIONS)[number]['id'];
export const FINANCIAL_RESTRICTION_FIELD_ID_SET = new Set<FinancialRestrictionFieldId>(
    FINANCIAL_RESTRICTION_FIELD_OPTIONS.map((o) => o.id)
);

export type SellerFinancialRestrictionRule = {
    id?: string;
    seller_tenant_id: string;
    agency_tenant_id: string | null;
    restrict_cogs: boolean;
    restrict_margin: boolean;
    restrict_custom_line_items: boolean;
    restricted_principals: string[];
    restricted_fields: FinancialRestrictionFieldId[];
    updated_at?: string;
    updated_by?: string | null;
};

export async function getSellerFinancialRestrictions(accountId: string): Promise<SellerFinancialRestrictionRule> {
    const res = await apiFetch(`/api/tiktok-shop/finance/restrictions/${accountId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Load restrictions failed (${res.status})`);
    }
    return json.data as SellerFinancialRestrictionRule;
}

export async function saveSellerFinancialRestrictions(
    accountId: string,
    payload: Pick<
        SellerFinancialRestrictionRule,
        'restrict_cogs' | 'restrict_margin' | 'restrict_custom_line_items' | 'restricted_fields'
        | 'restricted_principals'
    >
): Promise<SellerFinancialRestrictionRule> {
    const res = await apiFetch(`/api/tiktok-shop/finance/restrictions/${accountId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Save restrictions failed (${res.status})`);
    }
    return json.data as SellerFinancialRestrictionRule;
}
