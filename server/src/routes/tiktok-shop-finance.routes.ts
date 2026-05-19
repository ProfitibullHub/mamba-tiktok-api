import express from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { getShopWithToken } from './tiktok-shop-data.routes.js';
import { supabase } from '../config/supabase.js';
import { ACTION_TIKTOK_AUTH, FEATURE_TIKTOK_SHOP } from '../constants/tiktok-entitlements.js';
import {
    enforceRequestAccountAccess,
    resolveRequestUserId,
    userIsPlatformSuperAdmin,
    verifyAccountIdParam,
} from '../middleware/account-access.middleware.js';
import { requireAuthorization } from '../middleware/authorize.middleware.js';
import { auditLog } from '../services/audit-logger.js';
import {
    isPlCustomCategory,
    resolveTiktokShopUuidForCustomPl,
} from '../services/pl-custom-lines.service.js';
import { buildPlDataResponse, buildCustomLineItemsBlockForShopDateRange } from '../services/pl-data.builder.js';
import { getFinancialFieldAccess } from '../services/financial-visibility.service.js';

const router = express.Router();

router.use(enforceRequestAccountAccess);
router.param('accountId', verifyAccountIdParam);

router.use(
    ['/pl-data/:accountId', '/daily-ad-spend/:accountId'],
    requireAuthorization((req) => ({
        action: 'view_pnl',
        accountId: req.params.accountId,
        denyAction: 'finance.permission_denied',
    }))
);

const ALLOWED_RESTRICTED_FIELDS = new Set([
    'cogs',
    'margin',
    'custom_line_items',
    'gross_profit',
    'net_profit',
    'platform_fees',
    'affiliate_commissions',
    'shipping_costs',
    'agency_fees',
    'ad_spend',
]);

function parseRestrictedFields(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const filtered = input
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => ALLOWED_RESTRICTED_FIELDS.has(v));
    return Array.from(new Set(filtered));
}

function parseRestrictedPrincipals(input: unknown): string[] {
    if (!Array.isArray(input)) return ['all_agency'];
    const allowed = new Set([
        'all_agency',
        'all_seller',
        'agency_admin',
        'account_manager',
        'account_coordinator',
        'seller_admin',
        'seller_user',
    ]);
    const out = input
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => allowed.has(v));
    return out.length > 0 ? out : ['all_agency'];
}

async function canManageFinancialRestrictions(userId: string, sellerTenantId: string): Promise<boolean> {
    const { data: strictSellerAdmin, error: strictErr } = await supabase.rpc('user_is_strict_seller_admin', {
        p_seller_tenant_id: sellerTenantId,
        p_user_id: userId,
    });
    if (strictErr) {
        console.warn('[finance] user_is_strict_seller_admin', strictErr.message);
    }
    if (strictSellerAdmin === true) return true;

    const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: userId });
    if (isSa === true) return true;

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
    return profile?.role === 'admin';
}

// Helper to handle API errors
const handleApiError = (res: express.Response, error: any) => {
    console.error('API Error:', error);
    res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
    });
};

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
        const userId = await resolveRequestUserId(req);
        const { data } = await buildPlDataResponse({
            accountId,
            shopIdQuery: typeof shopId === 'string' ? shopId : undefined,
            startDateUnix: startDate as string | undefined,
            endDateUnixExclusive: endDate as string | undefined,
            userId,
        });
        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-shop/finance/restrictions/:accountId
 * Returns seller-level financial visibility restrictions for this seller account.
 */
router.get('/restrictions/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { data: account, error: accErr } = await supabase
            .from('accounts')
            .select('tenant_id')
            .eq('id', accountId)
            .maybeSingle();
        if (accErr || !account?.tenant_id) {
            res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
            return;
        }
        const sellerTenantId = account.tenant_id as string;

        const allowed = await canManageFinancialRestrictions(userId, sellerTenantId);
        if (!allowed) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: rule, error: ruleErr } = await supabase
            .from('seller_financial_visibility_rules')
            .select(
                'id, seller_tenant_id, agency_tenant_id, restrict_cogs, restrict_margin, restrict_custom_line_items, restricted_principals, restricted_fields, restricted_custom_pl_line_item_ids, updated_at, updated_by',
            )
            .eq('seller_tenant_id', sellerTenantId)
            .is('agency_tenant_id', null)
            .maybeSingle();
        if (ruleErr) throw ruleErr;

        res.json({
            success: true,
            data: rule || {
                seller_tenant_id: sellerTenantId,
                agency_tenant_id: null,
                restrict_cogs: false,
                restrict_margin: false,
                restrict_custom_line_items: false,
                restricted_principals: ['all_agency'],
                restricted_fields: [],
                restricted_custom_pl_line_item_ids: [],
            },
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * PUT /api/tiktok-shop/finance/restrictions/:accountId
 * Upserts seller-level financial visibility restrictions (agency_tenant_id = null).
 */
router.put('/restrictions/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { data: account, error: accErr } = await supabase
            .from('accounts')
            .select('tenant_id')
            .eq('id', accountId)
            .maybeSingle();
        if (accErr || !account?.tenant_id) {
            res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
            return;
        }
        const sellerTenantId = account.tenant_id as string;

        const allowed = await canManageFinancialRestrictions(userId, sellerTenantId);
        if (!allowed) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const b = req.body ?? {};
        const restrictCogs = b.restrict_cogs === true;
        const restrictMargin = b.restrict_margin === true;
        const restrictCustomLineItems = b.restrict_custom_line_items === true;
        const restrictedFields = parseRestrictedFields(b.restricted_fields);
        const restrictedPrincipals = parseRestrictedPrincipals(b.restricted_principals);

        const idsParse = parseUuidArrayStrict(b.restricted_custom_pl_line_item_ids);
        if (!idsParse.ok) {
            res.status(400).json({ success: false, error: idsParse.error });
            return;
        }
        const restrictedCustomPlLineItemIds = idsParse.ids;
        if (
            restrictedCustomPlLineItemIds.length > 0 &&
            !(await assertCustomPlLineIdsBelongToSellerTenant(restrictedCustomPlLineItemIds, sellerTenantId))
        ) {
            res.status(400).json({ success: false, error: 'restricted_custom_pl_line_item_ids must reference lines on this seller tenant' });
            return;
        }

        const nowIso = new Date().toISOString();
        const { data: existing, error: existingErr } = await supabase
            .from('seller_financial_visibility_rules')
            .select(
                'id, seller_tenant_id, agency_tenant_id, restrict_cogs, restrict_margin, restrict_custom_line_items, restricted_principals, restricted_fields, restricted_custom_pl_line_item_ids, updated_at, updated_by',
            )
            .eq('seller_tenant_id', sellerTenantId)
            .is('agency_tenant_id', null)
            .maybeSingle();
        if (existingErr) throw existingErr;

        let saved: any = null;
        if (existing?.id) {
            const { data: updated, error: updateErr } = await supabase
                .from('seller_financial_visibility_rules')
                .update({
                    restrict_cogs: restrictCogs,
                    restrict_margin: restrictMargin,
                    restrict_custom_line_items: restrictCustomLineItems,
                    restricted_principals: restrictedPrincipals,
                    restricted_fields: restrictedFields,
                    restricted_custom_pl_line_item_ids: restrictedCustomPlLineItemIds,
                    updated_by: userId,
                    updated_at: nowIso,
                })
                .eq('id', existing.id)
                .select(
                    'id, seller_tenant_id, agency_tenant_id, restrict_cogs, restrict_margin, restrict_custom_line_items, restricted_principals, restricted_fields, restricted_custom_pl_line_item_ids, updated_at, updated_by',
                )
                .single();
            if (updateErr) throw updateErr;
            saved = updated;
        } else {
            const { data: inserted, error: insertErr } = await supabase
                .from('seller_financial_visibility_rules')
                .insert({
                    seller_tenant_id: sellerTenantId,
                    agency_tenant_id: null,
                    restrict_cogs: restrictCogs,
                    restrict_margin: restrictMargin,
                    restrict_custom_line_items: restrictCustomLineItems,
                    restricted_principals: restrictedPrincipals,
                    restricted_fields: restrictedFields,
                    restricted_custom_pl_line_item_ids: restrictedCustomPlLineItemIds,
                    updated_by: userId,
                    updated_at: nowIso,
                })
                .select(
                    'id, seller_tenant_id, agency_tenant_id, restrict_cogs, restrict_margin, restrict_custom_line_items, restricted_principals, restricted_fields, restricted_custom_pl_line_item_ids, updated_at, updated_by',
                )
                .single();
            if (insertErr) throw insertErr;
            saved = inserted;
        }

        // Keep this settings page as the single source of truth for seller-wide policy.
        // Remove legacy agency-specific rows to avoid conflicting/stacked behavior.
        await supabase
            .from('seller_financial_visibility_rules')
            .delete()
            .eq('seller_tenant_id', sellerTenantId)
            .not('agency_tenant_id', 'is', null);

        await auditLog(req, {
            action: 'finance.visibility.update',
            resourceType: 'seller_financial_visibility_rules',
            resourceId: (saved as { id?: string })?.id ?? existing?.id ?? null,
            accountId,
            tenantId: sellerTenantId,
            beforeState: existing ? (existing as unknown as Record<string, unknown>) : null,
            afterState: saved as unknown as Record<string, unknown>,
        });

        res.json({ success: true, data: saved });
    } catch (error) {
        handleApiError(res, error);
    }
});

async function assertCustomPlLineIdsBelongToSellerTenant(ids: string[], sellerTenantId: string): Promise<boolean> {
    if (ids.length === 0) return true;
    const { data, error } = await supabase
        .from('pl_custom_line_items')
        .select('id')
        .eq('seller_tenant_id', sellerTenantId)
        .in('id', ids);
    if (error) throw error;
    return (data || []).length === ids.length;
}

async function assertCustomPlWriteAccess(
    res: express.Response,
    userId: string | null,
    sellerTenantId: string,
): Promise<boolean> {
    if (!userId) {
        res.status(401).json({ success: false, error: 'Authorization required' });
        return false;
    }
    const allowed = await canManageFinancialRestrictions(userId, sellerTenantId);
    if (!allowed) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return false;
    }
    return true;
}

async function fetchLineItemForAccount(lineItemId: string, accountId: string) {
    const { data: li, error: liErr } = await supabase
        .from('pl_custom_line_items')
        .select('id, seller_tenant_id, tiktok_shop_id, category, name, sort_order, is_active, created_at')
        .eq('id', lineItemId)
        .maybeSingle();
    if (liErr) throw liErr;
    if (!li) return null;
    const { data: ts, error: tsErr } = await supabase
        .from('tiktok_shops')
        .select('account_id')
        .eq('id', li.tiktok_shop_id)
        .maybeSingle();
    if (tsErr) throw tsErr;
    if (ts?.account_id !== accountId) return null;
    return li;
}

function mapPlCustomPgError(err: { message?: string; code?: string }): { status: number; message: string } | null {
    const msg = err.message || '';
    if (msg.includes('pl_custom_line_item_not_found_or_inactive') || msg.includes('LINE_ITEM_NOT_FOUND')) {
        return { status: 404, message: 'Line item not found or inactive' };
    }
    if (msg.includes('pl_custom_value_not_found')) {
        return { status: 404, message: 'Value segment not found' };
    }
    if (msg.includes('pl_custom_value_superseded')) {
        return { status: 409, message: 'This value was already superseded and cannot be changed' };
    }
    if (msg.includes('pl_custom_split_effective_from')) {
        return { status: 400, message: 'effective_from must be strictly after the segment start date' };
    }
    if (msg.includes('pl_custom_line_item_values_overlap') || msg.includes('overlap')) {
        return { status: 409, message: 'Date range overlaps an existing value for this line item' };
    }
    if (msg.includes('pl_custom_line_item_values_invalid_range') || msg.includes('invalid_range')) {
        return { status: 400, message: 'Invalid date range' };
    }
    return null;
}

/** PRD §7.3: reject invalid UUID entries (no silent drop). */
function parseUuidArrayStrict(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
    if (raw === undefined || raw === null) return { ok: true, ids: [] };
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'restricted_custom_pl_line_item_ids must be an array of UUID strings' };
    }
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids: string[] = [];
    for (const x of raw) {
        if (typeof x !== 'string') {
            return { ok: false, error: 'Each restricted_custom_pl_line_item_ids entry must be a UUID string' };
        }
        const t = x.trim();
        if (!re.test(t)) {
            return { ok: false, error: `Invalid UUID in restricted_custom_pl_line_item_ids: ${x}` };
        }
        ids.push(t);
    }
    return { ok: true, ids };
}

async function fetchValueForAccount(valueId: string, accountId: string) {
    const { data: val, error: valErr } = await supabase
        .from('pl_custom_line_item_values')
        .select('id, line_item_id, amount, start_date, end_date, created_at, created_by, replaced_by')
        .eq('id', valueId)
        .maybeSingle();
    if (valErr) throw valErr;
    if (!val || val.replaced_by) return null;
    const li = await fetchLineItemForAccount(val.line_item_id as string, accountId);
    if (!li) return null;
    return { ...val, line_item_id: val.line_item_id as string };
}

/**
 * POST /api/tiktok-shop/finance/custom-pl/:accountId/line-items
 * Body: { shop_id: string (TikTok cipher), category, name, sort_order? }
 */
router.post(
    '/custom-pl/:accountId/line-items',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId } = req.params;
            const userId = await resolveRequestUserId(req);
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            if (!(await assertCustomPlWriteAccess(res, userId, sellerTenantId))) return;

            const b = req.body ?? {};
            const shopCipher = typeof b.shop_id === 'string' ? b.shop_id.trim() : '';
            const name = typeof b.name === 'string' ? b.name.trim() : '';
            const category = typeof b.category === 'string' ? b.category.trim() : '';
            const sortOrder = typeof b.sort_order === 'number' && Number.isFinite(b.sort_order) ? b.sort_order : 0;

            if (!shopCipher || !name || !isPlCustomCategory(category)) {
                res.status(400).json({ success: false, error: 'shop_id, name, and valid category are required' });
                return;
            }

            const { data: shopRow, error: shopErr } = await supabase
                .from('tiktok_shops')
                .select('id')
                .eq('account_id', accountId)
                .eq('shop_id', shopCipher)
                .maybeSingle();
            if (shopErr) throw shopErr;
            if (!shopRow?.id) {
                res.status(404).json({ success: false, error: 'Shop not found for this account' });
                return;
            }

            const { data: inserted, error: insErr } = await supabase
                .from('pl_custom_line_items')
                .insert({
                    seller_tenant_id: sellerTenantId,
                    tiktok_shop_id: shopRow.id,
                    category,
                    name,
                    sort_order: sortOrder,
                    is_active: true,
                    created_by: userId,
                })
                .select('id, seller_tenant_id, tiktok_shop_id, category, name, sort_order, is_active, created_at, created_by')
                .single();
            if (insErr) throw insErr;

            await auditLog(req, {
                action: 'pl.line_item.create',
                resourceType: 'pl_custom_line_item',
                resourceId: inserted.id,
                accountId,
                tenantId: sellerTenantId,
                afterState: inserted as unknown as Record<string, unknown>,
            });

            res.json({ success: true, data: inserted });
        } catch (error) {
            handleApiError(res, error);
        }
    },
);

/**
 * PATCH /api/tiktok-shop/finance/custom-pl/:accountId/line-items/:lineItemId
 */
router.patch(
    '/custom-pl/:accountId/line-items/:lineItemId',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId, lineItemId } = req.params;
            const userId = await resolveRequestUserId(req);
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            if (!(await assertCustomPlWriteAccess(res, userId, sellerTenantId))) return;

            const existing = await fetchLineItemForAccount(lineItemId, accountId);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Line item not found' });
                return;
            }

            const b = req.body ?? {};
            const patch: Record<string, unknown> = {};
            if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
            if (typeof b.sort_order === 'number' && Number.isFinite(b.sort_order)) patch.sort_order = b.sort_order;
            if (typeof b.is_active === 'boolean') patch.is_active = b.is_active;

            if (Object.keys(patch).length === 0) {
                res.status(400).json({ success: false, error: 'No valid fields to update' });
                return;
            }

            const { data: updated, error: updErr } = await supabase
                .from('pl_custom_line_items')
                .update(patch)
                .eq('id', lineItemId)
                .select('id, seller_tenant_id, tiktok_shop_id, category, name, sort_order, is_active, created_at, created_by')
                .single();
            if (updErr) throw updErr;

            await auditLog(req, {
                action: 'pl.line_item.update',
                resourceType: 'pl_custom_line_item',
                resourceId: lineItemId,
                accountId,
                tenantId: sellerTenantId,
                beforeState: existing as unknown as Record<string, unknown>,
                afterState: updated as unknown as Record<string, unknown>,
            });

            res.json({ success: true, data: updated });
        } catch (error) {
            handleApiError(res, error);
        }
    },
);

/**
 * DELETE is not supported: line items are soft-deleted (PATCH is_active: false) only; dated values are retained (PRD).
 */
router.delete(
    '/custom-pl/:accountId/line-items/:lineItemId',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (_req, res) => {
        res.setHeader('Allow', 'GET, POST, PATCH, OPTIONS');
        res.status(405).json({
            success: false,
            error:
                'Removing a custom P&L line uses PATCH with is_active: false. Values are retained for historical reporting; hard delete is not supported.',
        });
    },
);

/**
 * POST /api/tiktok-shop/finance/custom-pl/:accountId/line-items/:lineItemId/values
 * Body: { start_date: "YYYY-MM-DD", end_date?: "YYYY-MM-DD" | null, amount: number }
 */
router.post(
    '/custom-pl/:accountId/line-items/:lineItemId/values',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId, lineItemId } = req.params;
            const userId = await resolveRequestUserId(req);
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            if (!(await assertCustomPlWriteAccess(res, userId, sellerTenantId))) return;

            const existing = await fetchLineItemForAccount(lineItemId, accountId);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Line item not found' });
                return;
            }

            const b = req.body ?? {};
            const startDate = typeof b.start_date === 'string' ? b.start_date.trim() : '';
            const endDate =
                b.end_date === null || b.end_date === undefined
                    ? null
                    : typeof b.end_date === 'string'
                      ? b.end_date.trim() || null
                      : null;
            const amount = typeof b.amount === 'number' ? b.amount : parseFloat(String(b.amount ?? ''));

            if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
                res.status(400).json({ success: false, error: 'start_date (YYYY-MM-DD) is required' });
                return;
            }
            if (endDate !== null && endDate !== undefined && endDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                res.status(400).json({ success: false, error: 'end_date must be YYYY-MM-DD or null' });
                return;
            }
            if (!Number.isFinite(amount)) {
                res.status(400).json({ success: false, error: 'amount must be a finite number' });
                return;
            }

            const { data: newId, error: rpcErr } = await supabase.rpc('append_pl_custom_line_item_value', {
                p_line_item_id: lineItemId,
                p_amount: amount,
                p_start_date: startDate,
                p_end_date: endDate && endDate.length >= 10 ? endDate.slice(0, 10) : null,
                p_actor: userId,
            });

            if (rpcErr) {
                const mapped = mapPlCustomPgError(rpcErr);
                if (mapped) {
                    res.status(mapped.status).json({ success: false, error: mapped.message });
                    return;
                }
                throw rpcErr;
            }

            const { data: row, error: fetchErr } = await supabase
                .from('pl_custom_line_item_values')
                .select('id, line_item_id, amount, start_date, end_date, created_at, created_by')
                .eq('id', newId as string)
                .maybeSingle();
            if (fetchErr) throw fetchErr;

            await auditLog(req, {
                action: 'pl.value.create',
                resourceType: 'pl_custom_line_item_value',
                resourceId: (newId as string) || null,
                accountId,
                tenantId: sellerTenantId,
                metadata: { line_item_id: lineItemId },
                afterState: (row || { id: newId }) as unknown as Record<string, unknown>,
            });

            res.json({ success: true, data: row || { id: newId } });
        } catch (error: any) {
            const mapped = mapPlCustomPgError(error);
            if (mapped) {
                res.status(mapped.status).json({ success: false, error: mapped.message });
                return;
            }
            handleApiError(res, error);
        }
    },
);

/**
 * GET /api/tiktok-shop/finance/custom-pl/:accountId/line-item-catalog?shop_id=<cipher>
 * Line ids for financial-restriction pickers (structure only).
 */
router.get(
    '/custom-pl/:accountId/line-item-catalog',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId } = req.params;
            const shopCipher = typeof req.query.shop_id === 'string' ? req.query.shop_id.trim() : '';
            if (!shopCipher) {
                res.status(400).json({ success: false, error: 'shop_id query parameter is required' });
                return;
            }
            const shopUuid = await resolveTiktokShopUuidForCustomPl(supabase, accountId, shopCipher);
            if (!shopUuid) {
                res.status(404).json({ success: false, error: 'Shop not found for this account' });
                return;
            }
            const { data: rows, error } = await supabase
                .from('pl_custom_line_items')
                .select('id, name, category, is_active, sort_order')
                .eq('tiktok_shop_id', shopUuid)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });
            if (error) throw error;
            res.json({ success: true, data: { lines: rows || [] } });
        } catch (error) {
            handleApiError(res, error);
        }
    },
);

/**
 * GET /api/tiktok-shop/finance/custom-pl/:accountId/amounts-in-range?shopId=&startDate=&endDate=
 * Returns the same `custom_line_items` object as full pl-data (no settlement aggregation).
 */
router.get(
    '/custom-pl/:accountId/amounts-in-range',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId } = req.params;
            const shopCipher = typeof req.query.shopId === 'string' ? req.query.shopId.trim() : '';
            const { startDate, endDate } = req.query;
            if (!shopCipher) {
                res.status(400).json({ success: false, error: 'shopId query parameter is required' });
                return;
            }
            const userId = await resolveRequestUserId(req);
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            const fieldAccess =
                typeof userId === 'string' && userId.length > 0
                    ? await getFinancialFieldAccess(userId, sellerTenantId)
                    : null;

            if (fieldAccess && fieldAccess.canViewCustomLineItems !== true) {
                res.status(403).json({ success: false, error: 'Custom line items are restricted for this user' });
                return;
            }

            const block = await buildCustomLineItemsBlockForShopDateRange({
                accountId,
                shopIdCipher: shopCipher,
                startDateUnix: startDate,
                endDateUnixExclusive: endDate,
                fieldAccess,
            });
            if (!block) {
                res.status(400).json({ success: false, error: 'Invalid shop or date range' });
                return;
            }
            res.json({ success: true, data: block });
        } catch (error) {
            handleApiError(res, error);
        }
    },
);

/**
 * PATCH /api/tiktok-shop/finance/custom-pl/:accountId/line-items/:lineItemId/values/:valueId
 * PRD-safe revisions only (no in-place amount overwrite):
 * - Truncate: { end_date: "YYYY-MM-DD" } — shortens the segment (end_date only).
 * - Split: { effective_from, amount, end_date?: null|string } — prior row end_date adjusted; new row inserted.
 * - Supersede: { supersede: true, amount, start_date, end_date?: null } — new row + prior marked replaced_by.
 */
router.patch(
    '/custom-pl/:accountId/line-items/:lineItemId/values/:valueId',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId, lineItemId, valueId } = req.params;
            const userId = await resolveRequestUserId(req);
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            if (!(await assertCustomPlWriteAccess(res, userId, sellerTenantId))) return;

            const existingVal = await fetchValueForAccount(valueId, accountId);
            if (!existingVal || existingVal.line_item_id !== lineItemId) {
                res.status(404).json({ success: false, error: 'Value segment not found' });
                return;
            }

            const b = req.body ?? {};
            const supersede = b.supersede === true || b.revision === 'supersede';

            if (supersede) {
                const amount = typeof b.amount === 'number' ? b.amount : parseFloat(String(b.amount ?? ''));
                const startDate = typeof b.start_date === 'string' ? b.start_date.trim() : '';
                const endDate =
                    b.end_date === null || b.end_date === undefined
                        ? null
                        : typeof b.end_date === 'string'
                          ? b.end_date.trim().slice(0, 10) || null
                          : null;
                if (!Number.isFinite(amount) || !startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
                    res.status(400).json({ success: false, error: 'supersede requires amount and start_date (YYYY-MM-DD)' });
                    return;
                }
                if (endDate !== null && endDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                    res.status(400).json({ success: false, error: 'end_date must be YYYY-MM-DD or null' });
                    return;
                }

                const { data: newId, error: rpcErr } = await supabase.rpc('replace_pl_custom_line_item_value', {
                    p_old_value_id: valueId,
                    p_amount: amount,
                    p_start_date: startDate,
                    p_end_date: endDate,
                    p_actor: userId,
                });
                if (rpcErr) {
                    const mapped = mapPlCustomPgError(rpcErr);
                    if (mapped) {
                        res.status(mapped.status).json({ success: false, error: mapped.message });
                        return;
                    }
                    throw rpcErr;
                }
                const { data: row, error: fetchErr } = await supabase
                    .from('pl_custom_line_item_values')
                    .select('id, line_item_id, amount, start_date, end_date, created_at, created_by, replaced_by')
                    .eq('id', newId as string)
                    .maybeSingle();
                if (fetchErr) throw fetchErr;
                await auditLog(req, {
                    action: 'pl.value.update',
                    resourceType: 'pl_custom_line_item_value',
                    resourceId: (newId as string) || null,
                    accountId,
                    tenantId: sellerTenantId,
                    metadata: { mode: 'supersede', prior_value_id: valueId, line_item_id: lineItemId },
                    beforeState: existingVal as unknown as Record<string, unknown>,
                    afterState: (row || { id: newId }) as unknown as Record<string, unknown>,
                });
                res.json({ success: true, data: row || { id: newId } });
                return;
            }

            const effectiveFrom = typeof b.effective_from === 'string' ? b.effective_from.trim() : '';
            if (effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
                const amount = typeof b.amount === 'number' ? b.amount : parseFloat(String(b.amount ?? ''));
                if (!Number.isFinite(amount)) {
                    res.status(400).json({ success: false, error: 'amount is required when effective_from is set' });
                    return;
                }
                const endDate =
                    b.end_date === null || b.end_date === undefined
                        ? null
                        : typeof b.end_date === 'string'
                          ? b.end_date.trim().slice(0, 10) || null
                          : null;
                if (endDate !== null && endDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                    res.status(400).json({ success: false, error: 'end_date must be YYYY-MM-DD or null' });
                    return;
                }

                const { data: newId, error: rpcErr } = await supabase.rpc('split_pl_custom_line_item_value', {
                    p_old_value_id: valueId,
                    p_effective_from: effectiveFrom,
                    p_new_amount: amount,
                    p_new_end: endDate,
                    p_actor: userId,
                });
                if (rpcErr) {
                    const mapped = mapPlCustomPgError(rpcErr);
                    if (mapped) {
                        res.status(mapped.status).json({ success: false, error: mapped.message });
                        return;
                    }
                    throw rpcErr;
                }
                const { data: row, error: fetchErr } = await supabase
                    .from('pl_custom_line_item_values')
                    .select('id, line_item_id, amount, start_date, end_date, created_at, created_by, replaced_by')
                    .eq('id', newId as string)
                    .maybeSingle();
                if (fetchErr) throw fetchErr;
                await auditLog(req, {
                    action: 'pl.value.update',
                    resourceType: 'pl_custom_line_item_value',
                    resourceId: (newId as string) || null,
                    accountId,
                    tenantId: sellerTenantId,
                    metadata: { mode: 'split', prior_value_id: valueId, line_item_id: lineItemId },
                    beforeState: existingVal as unknown as Record<string, unknown>,
                    afterState: (row || { id: newId }) as unknown as Record<string, unknown>,
                });
                res.json({ success: true, data: row || { id: newId } });
                return;
            }

            if (typeof b.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.end_date)) {
                const newEnd = b.end_date.slice(0, 10);
                if (newEnd < existingVal.start_date) {
                    res.status(400).json({ success: false, error: 'end_date must be on or after start_date' });
                    return;
                }
                if (existingVal.end_date != null && newEnd > existingVal.end_date) {
                    res.status(400).json({ success: false, error: 'end_date cannot extend beyond the current segment end' });
                    return;
                }

                const { data: newId, error: rpcErr } = await supabase.rpc('truncate_pl_custom_line_item_value', {
                    p_old_value_id: valueId,
                    p_new_end: newEnd,
                    p_actor: userId,
                });
                if (rpcErr) {
                    const mapped = mapPlCustomPgError(rpcErr);
                    if (mapped) {
                        res.status(mapped.status).json({ success: false, error: mapped.message });
                        return;
                    }
                    throw rpcErr;
                }
                const outId = newId as string;
                const { data: row, error: fetchErr } = await supabase
                    .from('pl_custom_line_item_values')
                    .select('id, line_item_id, amount, start_date, end_date, created_at, created_by, replaced_by')
                    .eq('id', outId)
                    .maybeSingle();
                if (fetchErr) throw fetchErr;
                await auditLog(req, {
                    action: 'pl.value.update',
                    resourceType: 'pl_custom_line_item_value',
                    resourceId: outId,
                    accountId,
                    tenantId: sellerTenantId,
                    metadata: {
                        mode: outId === valueId ? 'truncate_end_noop' : 'truncate_end_versioned',
                        prior_value_id: valueId,
                        line_item_id: lineItemId,
                    },
                    beforeState: existingVal as unknown as Record<string, unknown>,
                    afterState: (row || { id: outId }) as unknown as Record<string, unknown>,
                });
                res.json({ success: true, data: row || { id: outId } });
                return;
            }

            res.status(400).json({
                success: false,
                error:
                    'Send supersede (supersede:true + amount + start_date + optional end_date), split (effective_from + amount + optional end_date), or truncate (end_date only).',
            });
        } catch (error: any) {
            const mapped = mapPlCustomPgError(error);
            if (mapped) {
                res.status(mapped.status).json({ success: false, error: mapped.message });
                return;
            }
            handleApiError(res, error);
        }
    },
);

/**
 * PATCH /api/tiktok-shop/finance/custom-pl/:accountId/empty-value-display?shop_id=<cipher>
 * PRD §5.3: `empty_value_in_range` = zero | null (per TikTok shop).
 */
router.patch(
    '/custom-pl/:accountId/empty-value-display',
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        accountId: req.params.accountId,
        featureKey: FEATURE_TIKTOK_SHOP,
        denyAction: 'finance.permission_denied',
    })),
    async (req, res) => {
        try {
            const { accountId } = req.params;
            const userId = await resolveRequestUserId(req);
            const shopCipher = typeof req.query.shop_id === 'string' ? req.query.shop_id.trim() : '';
            if (!shopCipher) {
                res.status(400).json({ success: false, error: 'shop_id query parameter is required' });
                return;
            }
            const { data: account, error: accErr } = await supabase
                .from('accounts')
                .select('tenant_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accErr || !account?.tenant_id) {
                res.status(404).json({ success: false, error: 'Seller tenant not found for account' });
                return;
            }
            const sellerTenantId = account.tenant_id as string;
            if (!(await assertCustomPlWriteAccess(res, userId, sellerTenantId))) return;

            const shopUuid = await resolveTiktokShopUuidForCustomPl(supabase, accountId, shopCipher);
            if (!shopUuid) {
                res.status(404).json({ success: false, error: 'Shop not found for this account' });
                return;
            }

            const raw = (req.body ?? {}) as { empty_value_in_range?: unknown };
            const v = raw.empty_value_in_range;
            if (v !== 'zero' && v !== 'null') {
                res.status(400).json({ success: false, error: 'empty_value_in_range must be "zero" or "null"' });
                return;
            }

            const { data: updated, error: updErr } = await supabase
                .from('tiktok_shops')
                .update({ pl_custom_empty_value_display: v })
                .eq('id', shopUuid)
                .eq('account_id', accountId)
                .select('id, shop_id, pl_custom_empty_value_display')
                .single();
            if (updErr) throw updErr;

            res.json({ success: true, data: updated });
        } catch (error) {
            handleApiError(res, error);
        }
    },
);

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
