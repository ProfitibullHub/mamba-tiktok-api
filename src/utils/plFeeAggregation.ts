/**
 * Shared P&L fee keys and aggregation helpers.
 * Keep in sync with TikTok Finance statement transaction_summary rollups.
 */

export const platformFeeKeys = [
  'platform_commission',
  'referral_fee',
  'transaction_fee',
  'refund_administration_fee',
  'credit_card_handling_fee',
] as const;

/**
 * TikTok Seller Center "Est. commission" — statement_transactions only
 * `transactions[].fee_tax_breakdown.fee.{affiliate_commission_amount, affiliate_partner_commission_amount, cofunded_creator_bonus_amount}`.
 * Rollups store keys without `_amount` suffix.
 * Excludes affiliate_commission_amount_before_pit (duplicates affiliate_commission for total purposes).
 */
export const tiktokEstCommissionFeeKeys = [
  'affiliate_commission',
  'affiliate_partner_commission',
  'cofunded_creator_bonus',
] as const;

/**
 * Full affiliate-related COGS (Est. commission + affiliate ads commission from settlements + external marketing).
 * Use `tiktokEstCommissionFeeKeys` when comparing to TikTok Seller Center Est. commission only.
 */
export const affiliateCogsFeeKeys = [
  ...tiktokEstCommissionFeeKeys,
  'affiliate_ads_commission', // statement fee_tax_breakdown.fee.affiliate_ads_commission_amount
  'external_affiliate_marketing_fee',
] as const;

/** @deprecated alias — use affiliateCogsFeeKeys */
export const affiliateFeeKeys = affiliateCogsFeeKeys;

/** Display labels for TikTok Est. commission lines (API fee_tax_breakdown paths). */
export const tiktokEstCommissionLineLabels: Record<(typeof tiktokEstCommissionFeeKeys)[number], string> = {
  affiliate_commission: 'Affiliate commission',
  affiliate_partner_commission: 'Affiliate partner commission',
  cofunded_creator_bonus: 'Co-funded creator bonus',
};

/** All affiliate COGS lines (includes marketing line not in TikTok Est. commission). */
export const affiliateCogsLineLabels: Record<(typeof affiliateCogsFeeKeys)[number], string> = {
  ...tiktokEstCommissionLineLabels,
  affiliate_ads_commission: 'Affiliate ads commission',
  external_affiliate_marketing_fee: 'External affiliate marketing fee',
};

/** @deprecated use affiliateCogsLineLabels */
export const autoAffiliateLineLabels = affiliateCogsLineLabels;

/** Shop settlement lines counted toward marketing / TAP shop ads (not affiliate COGS). */
export const adSpendFeeKeys = ['tap_shop_ads_commission'] as const;

/** FBT-related shipping breakdown lines are reference-only; excluded from OpEx shipping subtotal. */
export const shippingKeysExcludedFromOperatingExpenses = [
  'fbt_fulfillment_fee',
  'fbt_fulfillment_fee_reimbursement',
  'fbt_shipping_cost',
  'fbt_free_shipping_fee',
] as const;

const excludedShippingSet = new Set<string>(shippingKeysExcludedFromOperatingExpenses);

export function netByKeys(
  record: Record<string, number> | undefined,
  keys: readonly string[]
): number {
  return keys.reduce((sum, k) => sum + Number(record?.[k] || 0), 0);
}

export function expenseFromNet(net: number): number {
  return Math.abs(net);
}

/**
 * Sum of shipping components for operating expenses (excludes FBT reference lines).
 */
export function shippingTotalForOperatingExpenses(
  shipping: Record<string, number> | undefined
): number {
  if (!shipping) return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(shipping)) {
    if (excludedShippingSet.has(k)) continue;
    sum += Number(v || 0);
  }
  return Math.abs(sum);
}

type SummaryRow = {
  transaction_summary?: {
    fees?: Record<string, number>;
    shipping?: Record<string, number>;
    total_fee_tax?: number;
  } | null;
};

export function mergeStatementFees(statements: SummaryRow[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const s of statements) {
    const fees = s.transaction_summary?.fees;
    if (!fees) continue;
    for (const [k, v] of Object.entries(fees)) {
      if (typeof v === 'number') acc[k] = (acc[k] || 0) + v;
    }
  }
  return acc;
}

export function mergeStatementShipping(statements: SummaryRow[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const s of statements) {
    const sh = s.transaction_summary?.shipping;
    if (!sh) continue;
    for (const [k, v] of Object.entries(sh)) {
      if (typeof v === 'number') acc[k] = (acc[k] || 0) + v;
    }
  }
  return acc;
}

export function feesBaseFromStatements(statements: SummaryRow[]): number {
  let sum = 0;
  for (const s of statements) {
    const ts = s.transaction_summary?.total_fee_tax;
    if (ts != null && ts !== undefined && !Number.isNaN(Number(ts))) {
      sum += Math.abs(Number(ts));
      continue;
    }
    const fees = s.transaction_summary?.fees;
    if (fees) {
      sum += Object.values(fees).reduce((a, v) => a + Math.abs(Number(v)), 0);
    }
  }
  return sum;
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
