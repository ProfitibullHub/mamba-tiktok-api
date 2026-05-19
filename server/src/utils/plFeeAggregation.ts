/**
 * P&L fee keys and aggregation helpers (server copy — keep aligned with `src/utils/plFeeAggregation.ts`).
 */

export const platformFeeKeys = [
    'platform_commission',
    'referral_fee',
    'transaction_fee',
    'refund_administration_fee',
    'credit_card_handling_fee',
] as const;

export const tiktokEstCommissionFeeKeys = [
    'affiliate_commission',
    'affiliate_partner_commission',
    'cofunded_creator_bonus',
] as const;

export const affiliateCogsFeeKeys = [
    ...tiktokEstCommissionFeeKeys,
    'affiliate_ads_commission',
    'external_affiliate_marketing_fee',
] as const;

/** @deprecated alias — use affiliateCogsFeeKeys */
export const affiliateFeeKeys = affiliateCogsFeeKeys;

export const adSpendFeeKeys = ['tap_shop_ads_commission'] as const;

export const shippingKeysExcludedFromOperatingExpenses = [
    'fbt_fulfillment_fee',
    'fbt_fulfillment_fee_reimbursement',
    'fbt_shipping_cost',
    'fbt_free_shipping_fee',
] as const;

const excludedShippingSet = new Set<string>(shippingKeysExcludedFromOperatingExpenses);

export function netByKeys(record: Record<string, number> | undefined, keys: readonly string[]): number {
    return keys.reduce((sum, k) => sum + Number(record?.[k] || 0), 0);
}

export function expenseFromNet(net: number): number {
    return Math.abs(net);
}

export function shippingTotalForOperatingExpenses(shipping: Record<string, number> | undefined): number {
    if (!shipping) return 0;
    let sum = 0;
    for (const [k, v] of Object.entries(shipping)) {
        if (excludedShippingSet.has(k)) continue;
        sum += Number(v || 0);
    }
    return Math.abs(sum);
}

export function isAdSpendFeeKey(key: string): boolean {
    return (adSpendFeeKeys as readonly string[]).includes(key);
}

export function isAffiliateCogsFeeKey(key: string): boolean {
    return (affiliateCogsFeeKeys as readonly string[]).includes(key);
}

export function isPlatformFeeKey(key: string): boolean {
    return (platformFeeKeys as readonly string[]).includes(key);
}
