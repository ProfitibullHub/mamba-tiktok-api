import { supabase } from '../config/supabase.js';
import { calculateOrderGMV, type OrderForGmv } from '../utils/gmvCalculations.js';
import { isCancelledOrRefunded } from '../utils/orderFinancials.js';
import {
    adSpendFeeKeys,
    affiliateCogsFeeKeys,
    netByKeys,
    expenseFromNet,
    shippingTotalForOperatingExpenses,
} from '../utils/plFeeAggregation.js';
import { computeAgencyFeesRollup, type AgencyFeeRow } from '../utils/agencyFeeProration.js';
import { buildPlDataResponse } from './pl-data.builder.js';

/** Matches dashboard email / PDF `PlSummary` in `reports.routes.ts`. */
export type EmailDashboardPlSummary = {
    gmv: number;
    totalOrders: number;
    totalRevenue: number;
    netSales: number;
    grossProfit: number;
    netProfit: number;
    adSpend?: number;
};

type DashboardOrderRow = OrderForGmv & {
    paid_time?: string | null;
    create_time?: string | null;
    line_items?: Array<{
        seller_sku?: string;
        product_name?: string;
        quantity?: number;
        cogs?: number | null;
    }>;
    return_status?: string | null;
};

type NormalizedProduct = {
    product_id: string;
    name: string;
    cogs: number;
    shipping_cost: number;
    skus: Array<{ seller_sku?: string; cogs?: number | null; shipping_cost?: number | null }>;
};

function orderPaidTs(o: { paid_time?: string | null; create_time?: string | null }): number {
    if (o.paid_time) {
        const t = new Date(o.paid_time).getTime();
        if (!Number.isNaN(t)) return Math.floor(t / 1000);
    }
    if (o.create_time) {
        const t = new Date(o.create_time).getTime();
        if (!Number.isNaN(t)) return Math.floor(t / 1000);
    }
    return 0;
}

async function loadDashboardOrdersDetailed(
    internalShopId: string,
    startIso: string,
    endIso: string
): Promise<DashboardOrderRow[]> {
    const pageSize = 1000;
    const all: DashboardOrderRow[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('shop_orders')
            .select(
                'order_id, order_status, paid_time, create_time, payment_info, total_amount, is_sample_order, cancel_reason, cancellation_initiator, line_items, return_status'
            )
            .eq('shop_id', internalShopId)
            .not('paid_time', 'is', null)
            .gte('paid_time', startIso)
            .lt('paid_time', endIso)
            .order('paid_time', { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) throw error;
        const batch = (data || []) as DashboardOrderRow[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from > 20000) break;
    }
    return all;
}

async function loadShopProducts(internalShopId: string): Promise<NormalizedProduct[]> {
    const { data, error } = await supabase
        .from('shop_products')
        .select('product_id, product_name, cogs, shipping_cost, details')
        .eq('shop_id', internalShopId);
    if (error) throw error;
    const rows = (data || []) as Array<{
        product_id: string;
        product_name: string | null;
        cogs: number | null;
        shipping_cost: number | null;
        details?: { skus?: NormalizedProduct['skus'] } | null;
    }>;
    return rows.map((r) => ({
        product_id: r.product_id,
        name: r.product_name || '',
        cogs: Number(r.cogs ?? 0),
        shipping_cost: Number(r.shipping_cost ?? 0),
        skus: Array.isArray(r.details?.skus) ? r.details!.skus! : [],
    }));
}

async function loadAffiliateRetainers(
    accountId: string,
    shopCipher: string,
    startYmd: string,
    endYmd: string
): Promise<Array<{ amount: number | string }>> {
    const { data, error } = await supabase
        .from('affiliate_settlements')
        .select('amount')
        .eq('account_id', accountId)
        .eq('shop_id', shopCipher)
        .gte('date', startYmd)
        .lte('date', endYmd);
    if (error) throw error;
    return (data || []) as Array<{ amount: number | string }>;
}

async function loadAgencyFees(accountId: string, shopCipher: string, endYmd: string): Promise<AgencyFeeRow[]> {
    const { data, error } = await supabase
        .from('agency_fees')
        .select('id, agency_name, date, fee_type, recurrence, retainer_amount, amount, commission_rate, commission_base')
        .eq('account_id', accountId)
        .eq('shop_id', shopCipher)
        .lte('date', endYmd)
        .order('date', { ascending: false });
    if (error) throw error;
    return (data || []) as AgencyFeeRow[];
}

async function loadMarketingSpendTotal(accountId: string, startYmd: string, endYmd: string): Promise<number> {
    const { data, error } = await supabase
        .from('tiktok_ad_spend_daily')
        .select('total_spend, spend_date')
        .eq('account_id', accountId)
        .gte('spend_date', startYmd)
        .lte('spend_date', endYmd);
    if (error) {
        console.warn('[email-dashboard-pl-summary] marketing spend', error.message);
        return 0;
    }
    let sum = 0;
    for (const row of data || []) {
        sum += parseFloat(String((row as { total_spend?: unknown }).total_spend ?? 0)) || 0;
    }
    return sum;
}

function computeCogsAndProductShipping(
    ordersForFinancials: DashboardOrderRow[],
    products: NormalizedProduct[]
): { totalCogs: number; totalProductShippingCost: number } {
    let totalCogs = 0;
    let totalProductShippingCost = 0;

    for (const order of ordersForFinancials) {
        for (const item of order.line_items || []) {
            const product = products.find(
                (p) =>
                    (item.seller_sku && p.skus?.some((s) => s.seller_sku === item.seller_sku)) || p.name === item.product_name
            );

            let itemCogs = item.cogs;
            let itemShippingCost = 0;

            if (itemCogs === undefined || itemCogs === null) {
                if (product) {
                    itemCogs = product.cogs || 0;
                    itemShippingCost = product.shipping_cost || 0;
                    if (item.seller_sku && product.skus) {
                        const skuData = product.skus.find((s) => s.seller_sku === item.seller_sku);
                        if (skuData) {
                            if (skuData.cogs) itemCogs = skuData.cogs;
                            if (skuData.shipping_cost) itemShippingCost = Number(skuData.shipping_cost);
                        }
                    }
                } else {
                    itemCogs = 0;
                }
            }

            const qty = Number(item.quantity) || 0;
            totalCogs += Number(itemCogs) * qty;
            totalProductShippingCost += Number(itemShippingCost) * qty;
        }
    }

    return { totalCogs, totalProductShippingCost };
}

const PL_EXPORT_EPS = 0.05;

function statementGrossSalesFromPayload(payload: Record<string, unknown>): number {
    const st = payload.statement_totals as { total_gross_sales?: number } | undefined;
    if (st && typeof st.total_gross_sales === 'number' && Number.isFinite(st.total_gross_sales)) {
        return st.total_gross_sales;
    }
    const tc = Number(payload.transaction_count ?? 0);
    if (tc > 0 && payload.revenue && typeof payload.revenue === 'object') {
        const rev = payload.revenue as Record<string, number>;
        const sb = Number(rev.subtotal_before_discount ?? 0);
        if (Math.abs(sb) >= PL_EXPORT_EPS) return sb;
        const br = sb + Number(rev.refund_subtotal_before_discount ?? 0);
        if (Math.abs(br) >= PL_EXPORT_EPS) return br;
    }
    const tr = Number(payload.total_revenue ?? 0);
    if (Math.abs(tr) >= PL_EXPORT_EPS) return tr;
    return Number((payload.statement_totals as { total_revenue?: number } | undefined)?.total_revenue ?? 0);
}

/**
 * PRD / export parity: values derivable **only** from the filtered `GET /pl-data` payload (`buildPlDataResponse`).
 * Order-based GMV, COGS-backed gross profit, and marketing ad spend are layered in by `computeEmailDashboardPlSummary`.
 */
export function extractPlSummaryForExport(payload: Record<string, unknown>): EmailDashboardPlSummary | null {
    const st = payload.statement_totals as Record<string, unknown> | undefined;
    if (!st) return null;
    const netSales = Number(st.total_net_sales ?? 0);
    const statementGross = statementGrossSalesFromPayload(payload);
    const feesRecord = payload.fees as Record<string, number> | undefined;
    const shopAdsNet = netByKeys(feesRecord, adSpendFeeKeys);
    const adFromStatementFees = expenseFromNet(shopAdsNet);
    return {
        gmv: statementGross,
        totalOrders: 0,
        totalRevenue: statementGross,
        netSales,
        grossProfit: 0,
        netProfit: 0,
        adSpend: adFromStatementFees,
    };
}

/**
 * Builds the same headline P&amp;L numbers as Overview (orders + settlements + marketing + manual fees),
 * using the filtered `GET /pl-data` pipeline for settlement and custom-line portions.
 */
export async function computeEmailDashboardPlSummary(input: {
    accountId: string;
    shopCipher: string;
    internalShopId: string;
    startDateYmd: string;
    endDateYmd: string;
    timezone: string;
    userId: string | null;
    startUnix: number;
    endUnixExclusive: number;
    includeCancelledFinancials: boolean;
}): Promise<EmailDashboardPlSummary | null> {
    const {
        accountId,
        shopCipher,
        internalShopId,
        startDateYmd,
        endDateYmd,
        timezone,
        userId,
        startUnix,
        endUnixExclusive,
        includeCancelledFinancials,
    } = input;

    const { data: plPayload } = await buildPlDataResponse({
        accountId,
        shopIdQuery: shopCipher,
        startDateUnix: startUnix,
        endDateUnixExclusive: endUnixExclusive,
        userId,
    });

    const payloadBaseline = extractPlSummaryForExport(plPayload);
    if (!payloadBaseline) return null;

    const startIso = new Date(startUnix * 1000).toISOString();
    const endIso = new Date(endUnixExclusive * 1000).toISOString();

    const [orders, products, affiliateRows, agencyFees, marketingSpend] = await Promise.all([
        loadDashboardOrdersDetailed(internalShopId, startIso, endIso),
        loadShopProducts(internalShopId),
        loadAffiliateRetainers(accountId, shopCipher, startDateYmd, endDateYmd),
        loadAgencyFees(accountId, shopCipher, endDateYmd),
        loadMarketingSpendTotal(accountId, startDateYmd, endDateYmd),
    ]);

    const allPaidTimeOrders = orders.filter((o) => {
        const ts = orderPaidTs(o);
        return ts >= startUnix && ts < endUnixExclusive && o.is_sample_order !== true;
    });
    const activeOrders = allPaidTimeOrders.filter((o) => !isCancelledOrRefunded(o));
    const ordersForCount = allPaidTimeOrders;
    const ordersForFinancials = includeCancelledFinancials ? allPaidTimeOrders : activeOrders;

    const orderCount = ordersForCount.length;
    const grossSalesGMV = ordersForFinancials.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const refundsInFinancialPool = ordersForFinancials.filter((o) => isCancelledOrRefunded(o)).reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    const netRevenue = grossSalesGMV - refundsInFinancialPool;

    const totalGMV = grossSalesGMV;
    const totalRevenue = totalGMV;
    const netSales = payloadBaseline.netSales;

    const { totalCogs, totalProductShippingCost } = computeCogsAndProductShipping(ordersForFinancials, products);

    const feesRecord = plPayload.fees as Record<string, number> | undefined;
    const shopAdsNet = netByKeys(feesRecord, adSpendFeeKeys);
    const shopAdsFees = expenseFromNet(shopAdsNet);
    const autoAffiliateNet = netByKeys(feesRecord, affiliateCogsFeeKeys);
    const autoAffiliateCommission = expenseFromNet(autoAffiliateNet);

    const manualAffiliateRetainers = affiliateRows.reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
    const totalAffiliateCost = autoAffiliateCommission + manualAffiliateRetainers;

    const plCustomBc = (plPayload.custom_line_items as { by_category?: Record<string, number> } | undefined)?.by_category;
    const customPlRevenue = Number(plCustomBc?.revenue ?? 0);
    const customPlCogs = Number(plCustomBc?.cogs ?? 0);
    const customPlOpEx = Number(plCustomBc?.expenses ?? 0) + Number(plCustomBc?.supplementary ?? 0);

    const grossProfit = netRevenue + customPlRevenue - totalCogs - customPlCogs - totalProductShippingCost - totalAffiliateCost;

    const { total: totalAgencyFees } = computeAgencyFeesRollup(agencyFees, startDateYmd, endDateYmd, timezone, {
        grossSalesGMV: totalGMV,
        netRevenue,
        grossProfit,
    });

    let feesBase = 0;
    let shippingBaseForOpEx = 0;
    if (plPayload.statement_totals) {
        feesBase =
            plPayload.total_fee_tax != null
                ? Math.abs(Number(plPayload.total_fee_tax))
                : Math.abs(Number((plPayload.statement_totals as { total_fees?: number }).total_fees ?? 0));
        shippingBaseForOpEx = plPayload.shipping
            ? shippingTotalForOperatingExpenses(plPayload.shipping as Record<string, number>)
            : Math.abs(Number((plPayload.statement_totals as { total_shipping?: number }).total_shipping ?? 0));
    }

    const realOperatingExpenses =
        feesBase + shippingBaseForOpEx - shopAdsFees - autoAffiliateCommission + totalAgencyFees + customPlOpEx;
    const adSpendTotal = marketingSpend;
    const netProfitFinal = grossProfit - (realOperatingExpenses + adSpendTotal);

    return {
        gmv: totalGMV,
        totalOrders: orderCount,
        totalRevenue,
        netSales,
        grossProfit,
        netProfit: netProfitFinal,
        adSpend: adSpendTotal,
    };
}
