import { supabase } from '../config/supabase.js';
import { userIsPlatformSuperAdmin } from '../middleware/account-access.middleware.js';
import {
    buildCustomLineItemsPayload,
    resolveTiktokShopUuidForCustomPl,
    utcInclusiveReportRangeFromSettlementQuery,
    type PLCustomEmptyValueDisplay,
    type PLCustomLineItemsPayload,
} from './pl-custom-lines.service.js';
import { applyFinancialFieldFiltering, getFinancialFieldAccess, type FinancialFieldAccess } from './financial-visibility.service.js';

/**
 * Statement-level settlement (matches TikTok Seller Center "Total settlement amount").
 */
function pickStatementSettlementAmount(s: {
    settlement_data?: { settlement_amount?: unknown } | null;
    transaction_summary?: { transaction_count?: number; total_settlement?: unknown } | null;
    net_amount?: unknown;
}): number {
    const raw = s.settlement_data?.settlement_amount;
    if (raw !== undefined && raw !== null && raw !== '') {
        const n = parseFloat(String(raw));
        if (!Number.isNaN(n)) return n;
    }
    const ts = s.transaction_summary;
    if (ts && ts.transaction_count && ts.transaction_count > 0 && ts.total_settlement != null && ts.total_settlement !== '') {
        const n = parseFloat(String(ts.total_settlement));
        if (!Number.isNaN(n)) return n;
    }
    const fallback = parseFloat(String(s.net_amount ?? '0'));
    return Number.isNaN(fallback) ? 0 : fallback;
}

/**
 * Seller Center "Gross sales" comes from the revenue breakdown (`subtotal_before_discount`),
 * not from summing each transaction's `revenue_amount`.
 */
function grossSalesStatementTotalFromRollup(aggregated: Record<string, unknown>, settlements: unknown[]): number {
    const rev = aggregated?.revenue as Record<string, number> | undefined;
    if (rev && typeof rev === 'object') {
        const sb = Number(rev.subtotal_before_discount ?? 0);
        if (Number.isFinite(sb) && Math.abs(sb) >= 0.005) {
            return sb;
        }
        const rg = Number(rev.refund_subtotal_before_discount ?? 0);
        const combo = sb + rg;
        if (Number.isFinite(combo) && Math.abs(combo) >= 0.005) {
            return combo;
        }
    }
    const tr = aggregated?.total_revenue;
    if (typeof tr === 'number' && Number.isFinite(tr) && Math.abs(tr) >= 0.005) {
        return tr;
    }
    return (settlements as { total_amount?: string }[]).reduce((sum, s) => sum + parseFloat(String(s.total_amount || '0')), 0);
}

function emptyPLResponse(): Record<string, unknown> {
    return {
        transaction_count: 0,
        total_revenue: 0,
        total_settlement: 0,
        total_shipping_cost: 0,
        total_fee_tax: 0,
        total_adjustment: 0,
        revenue: {},
        fees: {},
        shipping: {},
        taxes: {},
        supplementary: {},
        statement_totals: {
            total_revenue: 0,
            total_gross_sales: 0,
            total_settlement: 0,
            total_fees: 0,
            total_adjustments: 0,
            total_shipping: 0,
            total_net_sales: 0,
        },
        meta: {
            total_statements: 0,
            statements_with_transactions: 0,
            statements_without_transactions: 0,
            currency: 'USD',
            has_complete_data: true,
        },
    };
}

function aggregateStatementSummaries(settlements: unknown[]): Record<string, unknown> {
    const result: Record<string, unknown> = {
        transaction_count: 0,
        total_revenue: 0,
        total_settlement: 0,
        total_shipping_cost: 0,
        total_fee_tax: 0,
        total_adjustment: 0,
        revenue: {},
        fees: {},
        shipping: {},
        taxes: {},
        supplementary: {},
    };

    for (const settlement of settlements as Array<{ transaction_summary?: Record<string, unknown> }>) {
        const summary = settlement.transaction_summary;
        if (!summary || !summary.transaction_count) continue;

        result.transaction_count = (result.transaction_count as number) + Number(summary.transaction_count || 0);
        result.total_revenue = (result.total_revenue as number) + Number(summary.total_revenue || 0);
        result.total_settlement = (result.total_settlement as number) + Number(summary.total_settlement || 0);
        result.total_shipping_cost = (result.total_shipping_cost as number) + Number(summary.total_shipping_cost || 0);
        result.total_fee_tax = (result.total_fee_tax as number) + Number(summary.total_fee_tax || 0);
        result.total_adjustment = (result.total_adjustment as number) + Number(summary.total_adjustment || 0);

        for (const section of ['revenue', 'fees', 'shipping', 'taxes', 'supplementary'] as const) {
            const sectionData = summary[section] as Record<string, number> | undefined;
            if (!sectionData) continue;
            if (!result[section]) result[section] = {};
            const bucket = result[section] as Record<string, number>;

            for (const [key, value] of Object.entries(sectionData)) {
                if (typeof value === 'number') {
                    bucket[key] = (bucket[key] || 0) + value;
                }
            }
        }
    }

    return result;
}

/**
 * Custom P&L lines + value segments for the report window (same logic as full `pl-data` merge).
 * Used by GET …/custom-pl/…/amounts-in-range for fast client refresh after edits.
 */
export async function buildCustomLineItemsBlockForShopDateRange(opts: {
    accountId: string;
    shopIdCipher: string | undefined;
    startDateUnix: unknown;
    endDateUnixExclusive: unknown;
    fieldAccess: FinancialFieldAccess | null;
}): Promise<PLCustomLineItemsPayload | null> {
    const { accountId, shopIdCipher, startDateUnix, endDateUnixExclusive, fieldAccess } = opts;
    try {
        const shopUuid = await resolveTiktokShopUuidForCustomPl(
            supabase,
            accountId,
            typeof shopIdCipher === 'string' && shopIdCipher.trim() ? shopIdCipher.trim() : undefined,
        );
        if (!shopUuid) return null;

        const su = Number(startDateUnix);
        const eu = Number(endDateUnixExclusive);
        const range = utcInclusiveReportRangeFromSettlementQuery(su, eu);
        if (!range) return null;

        const excludedLineItemIds = new Set<string>();
        if (fieldAccess?.restrictedCustomPlLineItemIds?.length) {
            for (const id of fieldAccess.restrictedCustomPlLineItemIds) {
                if (typeof id === 'string' && id.length > 0) excludedLineItemIds.add(id);
            }
        }

        let emptyDisplay: PLCustomEmptyValueDisplay = 'zero';
        const { data: shopPrefs } = await supabase
            .from('tiktok_shops')
            .select('pl_custom_empty_value_display')
            .eq('id', shopUuid)
            .maybeSingle();
        if (shopPrefs?.pl_custom_empty_value_display === 'null') {
            emptyDisplay = 'null';
        }

        return await buildCustomLineItemsPayload(supabase, {
            tiktokShopUuid: shopUuid,
            reportStartYmd: range.startYmd,
            reportEndYmd: range.endYmd,
            excludedLineItemIds,
            emptyAmountInRangeDisplay: emptyDisplay,
        });
    } catch (err) {
        console.warn('[P&L] custom line items block failed:', (err as Error)?.message || err);
        return null;
    }
}

async function attachCustomPLToPayload(
    payload: Record<string, unknown>,
    accountId: string,
    shopIdQuery: unknown,
    startDateQuery: unknown,
    endDateQuery: unknown,
    fieldAccess: FinancialFieldAccess | null
): Promise<void> {
    const block = await buildCustomLineItemsBlockForShopDateRange({
        accountId,
        shopIdCipher: typeof shopIdQuery === 'string' ? shopIdQuery : undefined,
        startDateUnix: startDateQuery,
        endDateUnixExclusive: endDateQuery,
        fieldAccess,
    });
    if (block) {
        payload.custom_line_items = block;
    }
}

export type BuildPlDataResponseParams = {
    accountId: string;
    /** TikTok shop cipher / id string from query (optional). */
    shopIdQuery?: string | null;
    /** Unix seconds (inclusive lower bound), same as GET /pl-data `startDate`. */
    startDateUnix?: number | string | null;
    /** Unix seconds (exclusive upper bound), same as GET /pl-data `endDate`. */
    endDateUnixExclusive?: number | string | null;
    /** Authenticated user id, or null if unauthenticated. */
    userId: string | null;
};

export type BuildPlDataResponseResult = {
    data: Record<string, unknown>;
    fieldAccess: FinancialFieldAccess | null;
};

/**
 * Builds filtered P&L payload identical to `GET /api/tiktok-shop/finance/pl-data/:accountId`.
 */
export async function buildPlDataResponse(params: BuildPlDataResponseParams): Promise<BuildPlDataResponseResult> {
    const { accountId, shopIdQuery, startDateUnix, endDateUnixExclusive, userId } = params;

    let shopsQuery = supabase.from('tiktok_shops').select('id').eq('account_id', accountId);

    if (shopIdQuery) {
        shopsQuery = shopsQuery.eq('shop_id', shopIdQuery as string);
    }

    const { data: shops } = await shopsQuery;

    if (!shops || shops.length === 0) {
        const empty = emptyPLResponse();
        return { data: empty, fieldAccess: null };
    }

    const shopIds = shops.map((s) => s.id);

    const applyDateFilters = (query: any) => {
        let q = query;
        if (startDateUnix != null && startDateUnix !== '') {
            const startISO = new Date(Number(startDateUnix) * 1000).toISOString();
            q = q.gte('settlement_time', startISO);
        }
        if (endDateUnixExclusive != null && endDateUnixExclusive !== '') {
            const endISO = new Date(Number(endDateUnixExclusive) * 1000).toISOString();
            q = q.lt('settlement_time', endISO);
        }
        return q;
    };

    let settlements: unknown[] | null = null;
    let hasTransactionColumns = true;

    const fullQuery = applyDateFilters(
        supabase
            .from('shop_settlements')
            .select(
                'settlement_id, settlement_time, net_amount, total_amount, fee_amount, adjustment_amount, shipping_fee, net_sales_amount, currency, transaction_summary, transactions_synced_at, settlement_data'
            )
            .in('shop_id', shopIds)
    );

    const { data: fullData, error: fullError } = await fullQuery.order('settlement_time', { ascending: false });

    if (fullError && fullError.message?.includes('column')) {
        console.warn(
            '[P&L] transaction_summary columns not found, using basic query. Run the migration: server/scripts/add_transaction_summary_column.sql'
        );
        hasTransactionColumns = false;

        const basicQuery = applyDateFilters(
            supabase
                .from('shop_settlements')
                .select(
                    'settlement_id, settlement_time, net_amount, total_amount, fee_amount, adjustment_amount, shipping_fee, net_sales_amount, currency, settlement_data'
                )
                .in('shop_id', shopIds)
        );

        const { data: basicData, error: basicError } = await basicQuery.order('settlement_time', { ascending: false });

        if (basicError) throw basicError;
        settlements = basicData;
    } else if (fullError) {
        throw fullError;
    } else {
        settlements = fullData;
    }

    let payload: Record<string, unknown>;

    if (!settlements || settlements.length === 0) {
        payload = emptyPLResponse();
    } else {
        const aggregated = hasTransactionColumns ? aggregateStatementSummaries(settlements) : {};

        const totalGrossSalesFromTransactions = grossSalesStatementTotalFromRollup(aggregated, settlements);

        const statementTotals = {
            total_revenue: (settlements as { total_amount?: string }[]).reduce(
                (sum, s) => sum + parseFloat(String(s.total_amount || '0')),
                0
            ),
            total_gross_sales: totalGrossSalesFromTransactions,
            total_settlement: (settlements as Parameters<typeof pickStatementSettlementAmount>[0][]).reduce(
                (sum, s) => sum + pickStatementSettlementAmount(s),
                0
            ),
            total_fees: (settlements as { fee_amount?: string }[]).reduce(
                (sum, s) => sum + parseFloat(String(s.fee_amount || '0')),
                0
            ),
            total_adjustments: (settlements as { adjustment_amount?: string }[]).reduce(
                (sum, s) => sum + parseFloat(String(s.adjustment_amount || '0')),
                0
            ),
            total_shipping: (settlements as { shipping_fee?: string }[]).reduce(
                (sum, s) => sum + parseFloat(String(s.shipping_fee || '0')),
                0
            ),
            total_net_sales: (settlements as { net_sales_amount?: string }[]).reduce(
                (sum, s) => sum + parseFloat(String(s.net_sales_amount || '0')),
                0
            ),
        };

        const statementsWithTransactions = hasTransactionColumns
            ? (settlements as { transaction_summary?: { transaction_count?: number } }[]).filter(
                  (s) => s.transaction_summary && s.transaction_summary.transaction_count && s.transaction_summary.transaction_count > 0
              ).length
            : 0;
        const statementsWithoutTransactions = settlements.length - statementsWithTransactions;

        payload = {
            ...aggregated,
            statement_totals: statementTotals,
            meta: {
                total_statements: settlements.length,
                statements_with_transactions: statementsWithTransactions,
                statements_without_transactions: statementsWithoutTransactions,
                currency: (settlements[0] as { currency?: string })?.currency || 'USD',
                has_complete_data: statementsWithoutTransactions === 0,
            },
        };
    }

    const { data: account } = await supabase.from('accounts').select('tenant_id').eq('id', accountId).maybeSingle();
    const isSuperAdmin = userId ? await userIsPlatformSuperAdmin(userId) : false;
    let fieldAccess: FinancialFieldAccess | null = null;
    if (userId && account?.tenant_id && !isSuperAdmin) {
        fieldAccess = await getFinancialFieldAccess(userId, account.tenant_id);
    }

    await attachCustomPLToPayload(payload, accountId, shopIdQuery, startDateUnix, endDateUnixExclusive, fieldAccess);

    let filteredPayload = payload;
    if (userId) {
        if (fieldAccess) {
            filteredPayload = applyFinancialFieldFiltering(payload as Record<string, unknown>, fieldAccess);
            filteredPayload = {
                ...(filteredPayload as Record<string, unknown>),
                financial_visibility: {
                    can_view_cogs: fieldAccess.canViewCogs,
                    can_view_margin: fieldAccess.canViewMargin,
                    can_view_custom_line_items: fieldAccess.canViewCustomLineItems,
                    restricted_fields: fieldAccess.restrictedFields,
                    restricted_custom_pl_line_item_ids: fieldAccess.restrictedCustomPlLineItemIds,
                },
            };
        } else if (isSuperAdmin) {
            filteredPayload = {
                ...(filteredPayload as Record<string, unknown>),
                financial_visibility: {
                    can_view_cogs: true,
                    can_view_margin: true,
                    can_view_custom_line_items: true,
                    restricted_fields: [],
                    restricted_custom_pl_line_item_ids: [],
                },
            };
        }
    }

    return { data: filteredPayload as Record<string, unknown>, fieldAccess };
}
