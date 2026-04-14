import express from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { getShopWithToken } from './tiktok-shop-data.routes.js';
import { supabase } from '../config/supabase.js';
import {
    enforceRequestAccountAccess,
    verifyAccountIdParam,
} from '../middleware/account-access.middleware.js';

const router = express.Router();

router.use(enforceRequestAccountAccess);
router.param('accountId', verifyAccountIdParam);

// Helper to handle API errors
const handleApiError = (res: express.Response, error: any) => {
    console.error('API Error:', error);
    res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
    });
};

/**
 * Statement-level settlement (matches TikTok Seller Center "Total settlement amount").
 * `net_amount` on `shop_settlements` can be wrong if a legacy trigger overwrites it; the
 * sync stores the API value on `settlement_data.settlement_amount`.
 */
function pickStatementSettlementAmount(s: any): number {
    const raw = s.settlement_data?.settlement_amount;
    if (raw !== undefined && raw !== null && raw !== '') {
        const n = parseFloat(String(raw));
        if (!Number.isNaN(n)) return n;
    }
    const ts = s.transaction_summary;
    if (ts && ts.transaction_count > 0 && ts.total_settlement != null && ts.total_settlement !== '') {
        const n = parseFloat(String(ts.total_settlement));
        if (!Number.isNaN(n)) return n;
    }
    const fallback = parseFloat(String(s.net_amount ?? '0'));
    return Number.isNaN(fallback) ? 0 : fallback;
}

/**
 * GET /api/tiktok-shop/finance/statements/:accountId
 */
router.get('/statements/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, ...query } = req.query;

        console.log(`[FinanceAPI] Getting statements for account ${accountId}, shop ${shopId}`);
        const shop = await getShopWithToken(accountId, shopId as string);

        // Ensure sort params are present
        const apiParams = {
            sort_field: 'statement_time',
            sort_order: 'DESC',
            ...query
        };

        const data = await tiktokShopApi.getStatements(shop.access_token, shop.shop_cipher, apiParams);
        console.log(`[FinanceAPI] Got ${data?.statement_list?.length || 0} statements`);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/payments/:accountId
 */
router.get('/payments/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);

        // Ensure sort params are present
        const apiParams = {
            sort_field: 'create_time',
            sort_order: 'DESC',
            ...query
        };

        const data = await tiktokShopApi.getPayments(shop.access_token, shop.shop_cipher, apiParams);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/withdrawals/:accountId
 */
router.get('/withdrawals/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);

        // Ensure types param is present (1=User Withdrawal, 2=Auto Withdrawal)
        const apiParams = {
            types: '1,2',
            ...query
        };

        const data = await tiktokShopApi.getWithdrawals(shop.access_token, shop.shop_cipher, apiParams);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/transactions/:accountId/:statementId/tiktok-envelope
 *
 * Same as TikTok GET /finance/202501/statements/{statement_id}/statement_transactions:
 * returns the full envelope { code, message, data, request_id } (not only data).
 */
router.get('/transactions/:accountId/:statementId/tiktok-envelope', async (req, res) => {
    try {
        const { accountId, statementId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);
        const envelope = await tiktokShopApi.getStatementTransactionsEnvelope(
            shop.access_token,
            shop.shop_cipher,
            statementId,
            query
        );

        res.json({ success: true, tiktok: envelope });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/transactions/:accountId/:statementId
 */
router.get('/transactions/:accountId/:statementId', async (req, res) => {
    try {
        const { accountId, statementId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);
        const data = await tiktokShopApi.getStatementTransactions(shop.access_token, shop.shop_cipher, statementId, query);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * POST /api/tiktok-shop/finance/raw-call/:accountId
 *
 * Safely exposes important raw finance APIs for audit/debugging.
 * Body:
 * {
 *   shopId: string,
 *   endpoint: "statements" | "statement_transactions",
 *   statementId?: string,
 *   params?: Record<string, any>
 * }
 */
router.post('/raw-call/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, endpoint, statementId, params = {} } = req.body || {};

        if (!shopId) {
            return res.status(400).json({ success: false, error: 'shopId is required' });
        }
        if (!endpoint || !['statements', 'statement_transactions'].includes(endpoint)) {
            return res.status(400).json({ success: false, error: 'endpoint must be one of: statements, statement_transactions' });
        }

        const shop = await getShopWithToken(accountId, String(shopId));

        let raw: any = null;
        let resolvedPath = '';

        if (endpoint === 'statements') {
            resolvedPath = '/finance/202309/statements';
            raw = await tiktokShopApi.getStatements(shop.access_token, shop.shop_cipher, params);
        } else if (endpoint === 'statement_transactions') {
            if (!statementId) {
                return res.status(400).json({ success: false, error: 'statementId is required for statement_transactions' });
            }
            resolvedPath = `/finance/202501/statements/${statementId}/statement_transactions`;
            raw = await tiktokShopApi.getStatementTransactions(shop.access_token, shop.shop_cipher, String(statementId), params);
        }

        return res.json({
            success: true,
            endpoint,
            resolved_path: resolvedPath,
            request_params: params,
            raw_response: raw
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/unsettled/:accountId
 */
router.get('/unsettled/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);

        // Ensure sort params are present
        const apiParams = {
            sort_field: 'order_create_time',
            sort_order: 'DESC',
            ...query
        };

        const data = await tiktokShopApi.getUnsettledOrders(shop.access_token, shop.shop_cipher, apiParams);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/transactions/order/:accountId/:orderId
 */
router.get('/transactions/order/:accountId/:orderId', async (req, res) => {
    try {
        const { accountId, orderId } = req.params;
        const { shopId, ...query } = req.query;

        const shop = await getShopWithToken(accountId, shopId as string);
        const data = await tiktokShopApi.getOrderTransactions(shop.access_token, shop.shop_cipher, orderId, query);

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/pl-data/:accountId
 *
 * Returns aggregated P&L data from synced statement transactions.
 * Query params: shopId, startDate (unix seconds, inclusive), endDate (unix seconds, exclusive upper bound)
 */
router.get('/pl-data/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, startDate, endDate } = req.query;

        // Get shop IDs for this account
        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId as string);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: emptyPLResponse() });
        }

        const shopIds = shops.map(s => s.id);

        // Build date filters helper
        const applyDateFilters = (query: any) => {
            if (startDate) {
                const startISO = new Date(Number(startDate) * 1000).toISOString();
                query = query.gte('settlement_time', startISO);
            }
            if (endDate) {
                const endISO = new Date(Number(endDate) * 1000).toISOString();
                query = query.lt('settlement_time', endISO);
            }
            return query;
        };

        // Try to query with transaction_summary columns first, fall back to basic columns
        let settlements: any[] | null = null;
        let hasTransactionColumns = true;

        const fullQuery = applyDateFilters(
            supabase
                .from('shop_settlements')
                .select('settlement_id, settlement_time, net_amount, total_amount, fee_amount, adjustment_amount, shipping_fee, net_sales_amount, currency, transaction_summary, transactions_synced_at, settlement_data')
                .in('shop_id', shopIds)
        );

        const { data: fullData, error: fullError } = await fullQuery
            .order('settlement_time', { ascending: false });

        if (fullError && fullError.message?.includes('column')) {
            // transaction_summary columns don't exist yet - fall back to basic query
            console.warn('[P&L] transaction_summary columns not found, using basic query. Run the migration: server/scripts/add_transaction_summary_column.sql');
            hasTransactionColumns = false;

            const basicQuery = applyDateFilters(
                supabase
                    .from('shop_settlements')
                    .select('settlement_id, settlement_time, net_amount, total_amount, fee_amount, adjustment_amount, shipping_fee, net_sales_amount, currency, settlement_data')
                    .in('shop_id', shopIds)
            );

            const { data: basicData, error: basicError } = await basicQuery
                .order('settlement_time', { ascending: false });

            if (basicError) throw basicError;
            settlements = basicData;
        } else if (fullError) {
            throw fullError;
        } else {
            settlements = fullData;
        }

        if (!settlements || settlements.length === 0) {
            return res.json({ success: true, data: emptyPLResponse() });
        }

        // Aggregate transaction summaries across all settlements
        const aggregated = hasTransactionColumns ? aggregateStatementSummaries(settlements) : {};

        // Statement-level totals for validation
        const statementTotals = {
            total_revenue: settlements.reduce((sum, s) => sum + parseFloat(s.total_amount || '0'), 0),
            total_settlement: settlements.reduce((sum, s) => sum + pickStatementSettlementAmount(s), 0),
            total_fees: settlements.reduce((sum, s) => sum + parseFloat(s.fee_amount || '0'), 0),
            total_adjustments: settlements.reduce((sum, s) => sum + parseFloat(s.adjustment_amount || '0'), 0),
            total_shipping: settlements.reduce((sum, s) => sum + parseFloat(s.shipping_fee || '0'), 0),
            total_net_sales: settlements.reduce((sum, s) => sum + parseFloat(s.net_sales_amount || '0'), 0),
        };

        const statementsWithTransactions = hasTransactionColumns
            ? settlements.filter(s => s.transaction_summary && s.transaction_summary.transaction_count > 0).length
            : 0;
        const statementsWithoutTransactions = settlements.length - statementsWithTransactions;

        res.json({
            success: true,
            data: {
                ...aggregated,
                statement_totals: statementTotals,
                meta: {
                    total_statements: settlements.length,
                    statements_with_transactions: statementsWithTransactions,
                    statements_without_transactions: statementsWithoutTransactions,
                    currency: settlements[0]?.currency || 'USD',
                    has_complete_data: statementsWithoutTransactions === 0,
                },
            },
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * Helper: Returns empty P&L response structure
 */
function emptyPLResponse() {
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

/**
 * Aggregate transaction_summary JSONB from multiple settlements into one P&L summary
 */
function aggregateStatementSummaries(settlements: any[]) {
    const result: any = {
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

    for (const settlement of settlements) {
        const summary = settlement.transaction_summary;
        if (!summary || !summary.transaction_count) continue;

        result.transaction_count += summary.transaction_count || 0;
        result.total_revenue += summary.total_revenue || 0;
        result.total_settlement += summary.total_settlement || 0;
        result.total_shipping_cost += summary.total_shipping_cost || 0;
        result.total_fee_tax += summary.total_fee_tax || 0;
        result.total_adjustment += summary.total_adjustment || 0;

        // Aggregate nested objects by summing matching keys
        for (const section of ['revenue', 'fees', 'shipping', 'taxes', 'supplementary'] as const) {
            const sectionData = summary[section];
            if (!sectionData) continue;
            if (!result[section]) result[section] = {};

            for (const [key, value] of Object.entries(sectionData)) {
                if (typeof value === 'number') {
                    result[section][key] = (result[section][key] || 0) + value;
                }
            }
        }
    }

    return result;
}

/**
 * GET /api/tiktok-shop/finance/daily-ad-spend/:accountId
 *
 * Returns daily ad spend from settlement transaction_summary data.
 * Groups settlements by date, sums tap_shop_ads_commission and affiliate_ads_commission.
 * Query params: shopId, startDate (unix seconds, inclusive), endDate (unix seconds, exclusive)
 */
router.get('/daily-ad-spend/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { shopId, startDate, endDate } = req.query;

        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId as string);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { daily: [] } });
        }

        const shopIds = shops.map(s => s.id);

        let query = supabase
            .from('shop_settlements')
            .select('settlement_time, transaction_summary')
            .in('shop_id', shopIds)
            .not('transaction_summary', 'is', null);

        if (startDate) {
            query = query.gte('settlement_time', new Date(Number(startDate) * 1000).toISOString());
        }
        if (endDate) {
            query = query.lt('settlement_time', new Date(Number(endDate) * 1000).toISOString());
        }

        const { data: settlements, error } = await query.order('settlement_time', { ascending: true });

        if (error) throw error;

        // Group by date (YYYY-MM-DD) and sum ad spend fields
        const dailyMap = new Map<string, {
            date: string;
            shop_ads_spend: number;
            affiliate_ads_spend: number;
            total_ad_spend: number;
            total_revenue: number;
            transaction_count: number;
        }>();

        for (const s of (settlements || [])) {
            const summary = s.transaction_summary;
            if (!summary || !summary.transaction_count) continue;

            const date = s.settlement_time.substring(0, 10); // YYYY-MM-DD
            const existing = dailyMap.get(date) || {
                date,
                shop_ads_spend: 0,
                affiliate_ads_spend: 0,
                total_ad_spend: 0,
                total_revenue: 0,
                transaction_count: 0,
            };

            const shopAds = Math.abs(summary.fees?.tap_shop_ads_commission || 0);
            const affiliateAds = Math.abs(summary.fees?.affiliate_ads_commission || 0);

            existing.shop_ads_spend += shopAds;
            existing.affiliate_ads_spend += affiliateAds;
            existing.total_ad_spend += shopAds + affiliateAds;
            existing.total_revenue += summary.total_revenue || 0;
            existing.transaction_count += summary.transaction_count || 0;

            dailyMap.set(date, existing);
        }

        const daily = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

        res.json({
            success: true,
            data: { daily },
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

export default router;
