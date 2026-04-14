/**
 * Rows for CSV/Excel/PDF export that mirror TikTok Seller Center settlement layout
 * (totals from statement columns; line detail from aggregated statement_transactions).
 */

export interface TiktokStatementExportInput {
  revenue?: Record<string, number>;
  fees?: Record<string, number>;
  shipping?: Record<string, number>;
  taxes?: Record<string, number>;
  supplementary?: Record<string, number>;
  total_adjustment?: number;
  statement_totals?: {
    total_settlement: number;
    total_net_sales: number;
    total_fees: number;
    total_shipping: number;
    total_adjustments: number;
  };
  meta?: { currency?: string };
}

/** TikTok Seller Center–style names for statement revenue keys (order API → UI). */
const REVENUE_TIKTOK_LABELS: Record<string, string> = {
  subtotal_before_discount: 'Gross sales',
  refund_subtotal_before_discount: 'Gross sales refund',
  seller_discount: 'Seller discount',
  seller_discount_refund: 'Seller discount refund',
  cod_service_fee: 'COD service fee',
  refund_cod_service_fee: 'Refund COD service fee',
};

/** TikTok-style shipping line names (internal rollup keys → Seller Center wording). */
const SHIPPING_TIKTOK_LABELS: Record<string, string> = {
  actual_shipping_fee: 'TikTok Shop shipping fee',
  fbt_shipping_cost: 'Fulfilled by TikTok Shop shipping fee',
  signature_confirmation_fee: 'Signature confirmation service fee',
  shipping_insurance_fee: 'Shipping insurance fee',
  customer_paid_shipping_fee: 'Customer-paid shipping fee',
  refund_customer_shipping_fee: 'Customer-paid shipping fee refund',
  promo_shipping_incentive: 'TikTok Shop shipping incentive',
  return_refund_subsidy: 'TikTok Shop shipping incentive refund',
  shipping_fee_subsidy: 'Shipping fee subsidy',
  return_shipping_fee: 'Return shipping fee',
  fbt_fulfillment_fee: 'FBT fulfillment fee',
  customer_shipping_fee_offset: 'Customer shipping fee offset',
  shipping_fee_discount: 'Shipping fee discount',
  return_shipping_label_fee: 'Return shipping label fee',
  fbt_fulfillment_fee_reimbursement: 'FBT fulfillment fee reimbursement',
  return_shipping_fee_paid_buyer: 'Return shipping fee (paid by customers)',
  shipping_fee_guarantee_reimbursement: 'Return shipping fee reimbursement',
  seller_self_shipping_service_fee: 'Shipping app service fee',
  shipping_fee_guarantee_service_fee: 'Shipping protection service fee',
  fbt_free_shipping_fee: 'FBT free shipping fee',
  platform_shipping_fee_discount: 'Platform shipping fee discount',
  free_return_subsidy: 'Free return subsidy',
  failed_delivery_subsidy: 'Failed delivery subsidy',
  replacement_shipping_fee: 'Replacement shipping fee',
  exchange_shipping_fee: 'Exchange shipping fee',
  refunded_customer_shipping_fee: 'Refunded customer shipping fee',
  customer_shipping_fee: 'Customer shipping fee',
  fbm_shipping_cost: 'FBM shipping cost',
  seller_shipping_fee_discount: 'Seller shipping fee discount',
};

/** TikTok-style fee line names (subset matches Seller Center; unknown keys → title case). */
const FEE_TIKTOK_LABELS: Record<string, string> = {
  platform_commission: 'Platform commission',
  referral_fee: 'Referral fee',
  transaction_fee: 'Transaction fee',
  refund_administration_fee: 'Refund administration fee',
  credit_card_handling_fee: 'Credit card handling fee',
  affiliate_commission: 'Affiliate Commission',
  affiliate_partner_commission: 'Affiliate partner commission',
  affiliate_ads_commission: 'Affiliate Shop Ads commission',
  affiliate_commission_amount_before_pit: 'Affiliate commission (before PIT)',
  tap_shop_ads_commission: 'Affiliate Partner shop ads commission',
  cofunded_promotion_service_fee: 'Co-funded promotion (seller-funded)',
  cofunded_creator_bonus: 'Co-funded creator bonus',
  campaign_resource_fee: 'Campaign resource fee',
  external_affiliate_marketing_fee: 'External affiliate marketing fee',
};

const TAX_TIKTOK_LABELS: Record<string, string> = {
  vat: 'VAT',
  pit: 'PIT',
  gst: 'GST',
  sst: 'SST',
  iva: 'IVA',
  isr: 'ISR',
  local_vat: 'Local VAT',
  import_vat: 'Import VAT',
  sales_tax: 'Sales tax',
};

const SUPP_TIKTOK_LABELS: Record<string, string> = {
  customer_payment: 'Customer payment',
  customer_refund: 'Customer refund',
  platform_discount: 'Platform discount',
  platform_discount_refund: 'Platform discount refund',
  sales_tax_payment: 'Sales tax payment',
  sales_tax_refund: 'Sales tax refund',
  retail_delivery_fee: 'Retail delivery fee',
  retail_delivery_fee_payment: 'Retail delivery fee payment',
  retail_delivery_fee_refund: 'Retail delivery fee refund',
  seller_cofunded_discount: 'Seller co-funded discount',
  seller_cofunded_discount_refund: 'Seller co-funded discount refund',
  platform_cofunded_discount: 'Platform co-funded discount',
  platform_cofunded_discount_refund: 'Platform co-funded discount refund',
  sales_tax: 'Sales tax',
};

const SUPP_ORDER = [
  'customer_payment',
  'customer_refund',
  'platform_discount',
  'platform_discount_refund',
  'sales_tax_payment',
  'sales_tax_refund',
  'retail_delivery_fee',
  'retail_delivery_fee_payment',
  'retail_delivery_fee_refund',
  'seller_cofunded_discount',
  'seller_cofunded_discount_refund',
  'platform_cofunded_discount',
  'platform_cofunded_discount_refund',
  'sales_tax',
] as const;

const TAX_ORDER = [
  'vat',
  'pit',
  'gst',
  'sst',
  'iva',
  'isr',
  'local_vat',
  'import_vat',
  'customs_duty',
  'customs_clearance',
  'anti_dumping_duty',
  'sales_tax',
] as const;

function labelForKey(
  key: string,
  map: Record<string, string>
): string {
  if (map[key]) return map[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtSigned(
  n: number,
  formatCurrency: (n: number) => string
): string {
  if (Number.isNaN(n)) return formatCurrency(0);
  const sign = n < -0.005 ? '-' : '';
  return sign + formatCurrency(n);
}

function sortedEntries(
  rec: Record<string, number> | undefined,
  preferredOrder: readonly string[]
): [string, number][] {
  if (!rec) return [];
  const keys = new Set(Object.keys(rec));
  const out: [string, number][] = [];
  for (const k of preferredOrder) {
    if (keys.has(k) && Math.abs(rec[k] ?? 0) >= 0.005) {
      out.push([k, rec[k] ?? 0]);
      keys.delete(k);
    }
  }
  const rest = [...keys]
    .filter(k => Math.abs(rec[k] ?? 0) >= 0.005)
    .sort((a, b) => a.localeCompare(b));
  for (const k of rest) {
    out.push([k, rec[k] ?? 0]);
  }
  return out;
}

const REVENUE_ORDER = [
  'subtotal_before_discount',
  'refund_subtotal_before_discount',
  'seller_discount',
  'seller_discount_refund',
  'cod_service_fee',
  'refund_cod_service_fee',
] as const;

const SHIPPING_ORDER = [
  'actual_shipping_fee',
  'fbt_shipping_cost',
  'signature_confirmation_fee',
  'shipping_insurance_fee',
  'customer_paid_shipping_fee',
  'refund_customer_shipping_fee',
  'promo_shipping_incentive',
  'return_refund_subsidy',
  'shipping_fee_subsidy',
  'return_shipping_fee',
  'fbt_fulfillment_fee',
  'customer_shipping_fee_offset',
  'shipping_fee_discount',
  'return_shipping_label_fee',
  'fbt_fulfillment_fee_reimbursement',
  'return_shipping_fee_paid_buyer',
  'shipping_fee_guarantee_reimbursement',
  'seller_self_shipping_service_fee',
  'shipping_fee_guarantee_service_fee',
  'fbt_free_shipping_fee',
  'platform_shipping_fee_discount',
  'free_return_subsidy',
  'failed_delivery_subsidy',
  'replacement_shipping_fee',
  'exchange_shipping_fee',
  'refunded_customer_shipping_fee',
  'customer_shipping_fee',
  'fbm_shipping_cost',
  'seller_shipping_fee_discount',
] as const;

const FEE_ORDER = [
  'transaction_fee',
  'referral_fee',
  'refund_administration_fee',
  'platform_commission',
  'credit_card_handling_fee',
  'affiliate_commission',
  'affiliate_partner_commission',
  'affiliate_ads_commission',
  'tap_shop_ads_commission',
  'cofunded_promotion_service_fee',
  'cofunded_creator_bonus',
  'campaign_resource_fee',
  'external_affiliate_marketing_fee',
  'sfp_service_fee',
  'live_specials_fee',
  'mall_service_fee',
  'voucher_xtra_service_fee',
  'flash_sales_service_fee',
  'pre_order_service_fee',
  'tsp_commission',
  'dt_handling_fee',
  'epr_pob_service_fee',
  'seller_paylater_handling_fee',
  'fee_per_item_sold',
  'dynamic_commission',
  'installation_service_fee',
  'shipping_fee_guarantee_service_fee',
  'bonus_cashback_service_fee',
  'affiliate_commission_amount_before_pit',
] as const;

export function buildTiktokStatementExportRows(
  plData: TiktokStatementExportInput | null | undefined,
  options: {
    formatCurrency: (n: number) => string;
    dateRangeLabel: string;
    timezoneLabel: string;
  }
): (string | number)[][] {
  const { formatCurrency, dateRangeLabel, timezoneLabel } = options;
  const st = plData?.statement_totals;
  const currency = plData?.meta?.currency ?? 'USD';

  if (!plData || !st) {
    return [
      ['═══ TIKTOK SETTLEMENT (statement sync) ═══', ''],
      [
        'Note',
        'No synced settlement data for this period. Sync finance / settlements in Mamba, then export again to match TikTok Seller Center totals.',
      ],
      ['', ''],
    ];
  }

  const rows: (string | number)[][] = [
    ['═══ TIKTOK SETTLEMENT (statement sync) ═══', ''],
    ['Time period', dateRangeLabel],
    ['Timezone', timezoneLabel],
    ['Currency', currency],
    [
      'Note',
      'Totals use TikTok statement fields (settlement_time in range). Line detail is summed from synced statement_transactions (same source as Finance API rollups).',
    ],
    ['', ''],
    ['Total settlement amount', fmtSigned(st.total_settlement, formatCurrency)],
    ['', ''],
    ['Net sales', fmtSigned(st.total_net_sales, formatCurrency)],
  ];

  const revenue = plData.revenue || {};
  for (const [k, v] of sortedEntries(revenue, REVENUE_ORDER)) {
    rows.push([`  ${labelForKey(k, REVENUE_TIKTOK_LABELS)}`, fmtSigned(v, formatCurrency)]);
  }

  rows.push(['', '']);
  rows.push(['Shipping', fmtSigned(st.total_shipping, formatCurrency)]);
  const shipping = plData.shipping || {};
  for (const [k, v] of sortedEntries(shipping, SHIPPING_ORDER)) {
    rows.push([`  ${labelForKey(k, SHIPPING_TIKTOK_LABELS)}`, fmtSigned(v, formatCurrency)]);
  }

  rows.push(['', '']);
  rows.push(['Fees', fmtSigned(st.total_fees, formatCurrency)]);
  const fees = plData.fees || {};
  for (const [k, v] of sortedEntries(fees, FEE_ORDER)) {
    rows.push([`  ${labelForKey(k, FEE_TIKTOK_LABELS)}`, fmtSigned(v, formatCurrency)]);
  }

  const taxes = plData.taxes || {};
  const taxEntries = sortedEntries(taxes, TAX_ORDER);
  if (taxEntries.length > 0) {
    rows.push(['', '']);
    rows.push(['Taxes (from fee/tax breakdown)', '']);
    for (const [k, v] of taxEntries) {
      rows.push([`  ${labelForKey(k, TAX_TIKTOK_LABELS)}`, fmtSigned(v, formatCurrency)]);
    }
  }

  rows.push(['', '']);
  rows.push(['Adjustments', fmtSigned(st.total_adjustments, formatCurrency)]);

  const ta = plData.total_adjustment;
  if (ta != null && Math.abs(ta) >= 0.005) {
    rows.push(['  Transaction adjustments (rolled up)', fmtSigned(ta, formatCurrency)]);
  }

  const supp = plData.supplementary || {};
  for (const [k, v] of sortedEntries(supp, SUPP_ORDER)) {
    rows.push([`  ${labelForKey(k, SUPP_TIKTOK_LABELS)}`, fmtSigned(v, formatCurrency)]);
  }

  rows.push(['', '']);
  rows.push([
    'Total reserved amount',
    '— (not included in Mamba finance sync; see TikTok Seller Center if needed)',
  ]);
  rows.push(['', '']);

  return rows;
}
