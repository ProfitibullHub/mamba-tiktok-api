import { Router, Request, Response } from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { getShopWithToken } from './tiktok-shop-data.routes.js';
import { getHistoricalStartTime } from '../config/dataRetention.js';

const router = Router();

function getShopTimestamp(dateStr: string): number {
    // Start with assumed Standard Time (UTC-8) -> 08:00 UTC
    let d = new Date(`${dateStr}T08:00:00Z`);

    // Check what time this is in Shop Timezone (America/Los_Angeles)
    const timeString = d.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false
    });

    let hour = parseInt(timeString);
    if (isNaN(hour)) hour = 0;

    if (hour === 1) {
        // We are in PDT (UTC-7), so 08:00 UTC is 01:00 PDT.
        // We want 00:00 PDT, so subtract 1 hour.
        d = new Date(d.getTime() - 3600000);
    }

    return Math.floor(d.getTime() / 1000);
}

/**
 * DATA AUTHENTICITY DEBUG ENDPOINT
 *
 * This endpoint calls TikTok Shop APIs DIRECTLY and returns the raw,
 * unmodified JSON responses. No Supabase data is used for the results.
 * The only Supabase interaction is to retrieve the OAuth access token
 * needed to authenticate with TikTok's API.
 *
 * Purpose: Prove that the data displayed on the Mamba dashboard
 * matches what TikTok's API actually returns.
 */

interface ApiCallResult {
    api_name: string;
    endpoint: string;
    method: string;
    description: string;
    how_we_use_it: string;
    request_params: Record<string, any>;
    raw_response: any;
    record_count: number;
    status: 'success' | 'error';
    error_message?: string;
    called_at: string;
    response_time_ms: number;
}

/**
 * GET /api/tiktok-shop/debug/raw-data/:accountId
 *
 * Fetches raw data from ALL TikTok Shop APIs directly.
 * Limited to first 10 pages per API to avoid rate limits.
 * Returns raw JSON exactly as TikTok returns it.
 */
router.get('/raw-data/:accountId', async (req: Request, res: Response) => {
    const { accountId } = req.params;
    const shopId = req.query.shopId as string | undefined;
    const maxPages = Number(req.query.maxPages) || 10;
    const startDate = req.query.startDate as string | undefined; // 'YYYY-MM-DD'
    const endDate = req.query.endDate as string | undefined; // 'YYYY-MM-DD'
    const testOrderId = req.query.testOrderId as string | undefined; // Optional order_id for testing price_detail API

    console.log(`[Debug] Raw data audit requested for account ${accountId}, shop ${shopId || 'default'}, maxPages: ${maxPages}, testOrderId: ${testOrderId || 'auto'}`);

    try {
        // Step 1: Get valid access token from Supabase (this is the ONLY Supabase call)
        const shop = await getShopWithToken(accountId, shopId);
        const accessToken = shop.access_token;
        const shopCipher = shop.shop_cipher;

        const results: ApiCallResult[] = [];
        const auditStartTime = new Date().toISOString();

        // Use Shop Timezone so users get consistent results matching the dashboard
        const orderStartTime = startDate
            ? getShopTimestamp(startDate)
            : getHistoricalStartTime();
        const orderEndTime = endDate
            ? getShopTimestamp(endDate) + 86400
            : Math.floor(Date.now() / 1000);

        // ============================================================
        // API 1: GET AUTHORIZED SHOPS
        // ============================================================
        try {
            const start = Date.now();
            const rawResponse = await tiktokShopApi.getAuthorizedShops(accessToken);
            results.push({
                api_name: 'Get Authorized Shops',
                endpoint: 'GET /authorization/202309/shops',
                method: 'GET',
                description: 'Returns the list of TikTok shops that have authorized this application. This is the first API called after OAuth to discover which shops the user granted access to.',
                how_we_use_it: 'We store the shop_id, shop_name, shop_cipher, and region from this response in our database. The shop_cipher is required for all subsequent API calls. The shop_name is displayed in the shop list.',
                request_params: { access_token: '[REDACTED]' },
                raw_response: rawResponse,
                record_count: Array.isArray(rawResponse) ? rawResponse.length : ((rawResponse as any)?.shops?.length || 0),
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Authorized Shops',
                endpoint: 'GET /authorization/202309/shops',
                method: 'GET',
                description: 'Returns the list of TikTok shops that have authorized this application.',
                how_we_use_it: 'We store shop details for subsequent API calls.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 2: GET SHOP INFO
        // ============================================================
        try {
            const start = Date.now();
            const rawResponse = await tiktokShopApi.getShopInfo(accessToken, shopCipher);
            results.push({
                api_name: 'Get Shop Info',
                endpoint: 'GET /seller/202309/shops',
                method: 'GET',
                description: 'Returns detailed information about the shop including shop name, region, and status. This is TikTok\'s official shop profile data.',
                how_we_use_it: 'We display the shop name, region, and status on the dashboard. This data is shown in the shop list and header.',
                request_params: { shop_cipher: shopCipher ? '[PROVIDED]' : '[MISSING]' },
                raw_response: rawResponse,
                record_count: rawResponse ? 1 : 0,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Shop Info',
                endpoint: 'GET /seller/202309/shops',
                method: 'GET',
                description: 'Returns detailed shop information.',
                how_we_use_it: 'We display the shop name, region, and status.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 3: SEARCH ORDERS (paginated, up to maxPages)
        // ============================================================
        let allOrders: any[] = []; // Hoisted to be accessible for API 9

        try {
            const start = Date.now();
            // Use date range from query params if provided, otherwise use historical default
            // Use UTC so all users get consistent results regardless of timezone
            // Use Shop Timezone so users get consistent results matching the dashboard
            const allRawResponses: any[] = [];
            let pageToken: string | undefined;
            let pageCount = 0;

            while (pageCount < maxPages) {
                const params: any = {
                    page_size: 100,
                    sort_order: 'DESC',
                    sort_field: 'create_time',
                    create_time_ge: orderStartTime,
                    create_time_lt: orderEndTime,
                };
                if (pageToken) params.page_token = pageToken;

                const rawPage = await tiktokShopApi.searchOrders(accessToken, shopCipher, params);
                allRawResponses.push({
                    page: pageCount + 1,
                    response: rawPage
                });

                if (rawPage?.orders) {
                    allOrders.push(...rawPage.orders);
                }

                pageCount++;
                pageToken = rawPage?.next_page_token;
                if (!pageToken) break;
            }

            // Build status breakdown for transparency
            const statusBreakdown: Record<string, number> = {};
            for (const order of allOrders) {
                const s = order.status || 'UNKNOWN';
                statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
            }
            const nonCancelledCount = allOrders.filter(o => o.status !== 'CANCELLED').length;

            results.push({
                api_name: 'Search Orders',
                endpoint: 'POST /order/202309/orders/search',
                method: 'POST',
                description: `Searches for orders within the date range. Fetched ${pageCount} page(s) of up to ${maxPages} max. Total: ${allOrders.length} (${nonCancelledCount} excluding cancelled).`,
                how_we_use_it: 'We store each order\'s ID, status, total amount, payment method, SKU details, buyer info, and timestamps. These are displayed in the Orders tab, Overview stats (total orders, revenue), and used in P&L calculations. CANCELLED orders are excluded from counts to match TikTok Seller Center.',
                request_params: {
                    page_size: 100,
                    sort_order: 'DESC',
                    sort_field: 'create_time',
                    create_time_ge: orderStartTime,
                    create_time_lt: orderEndTime,
                    date_range: startDate && endDate ? `${startDate} to ${endDate}` : 'full historical',
                    pages_fetched: pageCount,
                    max_pages: maxPages,
                    status_breakdown: statusBreakdown,
                    total_all_statuses: allOrders.length,
                    total_excluding_cancelled: nonCancelledCount,
                },
                raw_response: allRawResponses,
                record_count: allOrders.length,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Search Orders',
                endpoint: 'POST /order/202309/orders/search',
                method: 'POST',
                description: 'Searches for orders within the historical data window.',
                how_we_use_it: 'Orders are displayed in the Orders tab and used for revenue calculations.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 9: GET PRICE DETAIL (New 202407 API)
        // ============================================================
        try {
            const start = Date.now();

            // Get sample order from search results (for debugging)
            const sampleOrder = allOrders.length > 0 ? allOrders[0] : null;

            // Use manually provided order_id if available, otherwise pick from search results
            let orderIdToTest: string | undefined;
            let orderIdSource: string;

            if (testOrderId) {
                orderIdToTest = testOrderId;
                orderIdSource = 'manual query parameter';
            } else {
                console.log('[Debug] Sample order for price_detail:', {
                    found: !!sampleOrder,
                    keys: sampleOrder ? Object.keys(sampleOrder) : [],
                    id_field: sampleOrder?.id,
                    order_id_field: sampleOrder?.order_id,
                });
                orderIdToTest = sampleOrder?.order_id;
                orderIdSource = 'auto from search results';
            }

            if (orderIdToTest) {
                console.log(`[Debug] Testing price_detail API with order: ${orderIdToTest} (source: ${orderIdSource})`);
                const rawResponse = await tiktokShopApi.getOrderPriceDetail(accessToken, shopCipher, orderIdToTest, shop.shop_id);
                results.push({
                    api_name: 'Get Order Price Detail',
                    endpoint: `GET /order/202407/orders/${orderIdToTest}/price_detail`,
                    method: 'GET',
                    description: 'Returns granular price details for a specific order, including original price, sale price, taxes, and platform discounts. This is the new 2024 API provided by TikTok.',
                    how_we_use_it: 'This data helps audit calculating exact GMV and revenue figures by providing the official breakdown of who paid what (customer vs platform subsidy).',
                    request_params: { order_id: orderIdToTest, shop_id: shop.shop_id, source: orderIdSource },
                    raw_response: rawResponse,
                    record_count: rawResponse ? 1 : 0,
                    status: 'success',
                    called_at: new Date().toISOString(),
                    response_time_ms: Date.now() - start,
                });
            } else {
                const reason = testOrderId
                    ? 'testOrderId parameter was empty'
                    : allOrders.length === 0
                    ? 'No orders found in date range'
                    : 'Order found but order_id is missing';
                console.log(`[Debug] Skipping price_detail API: ${reason}`);
                results.push({
                    api_name: 'Get Order Price Detail',
                    endpoint: 'GET /order/202407/orders/{order_id}/price_detail',
                    method: 'GET',
                    description: 'Returns granular price details for a specific order.',
                    how_we_use_it: 'Used for GMV auditing. You can test this API by adding ?testOrderId=YOUR_ORDER_ID to the URL.',
                    request_params: {
                        note: reason,
                        total_orders_found: allOrders.length,
                        testOrderId_param: testOrderId || 'not provided',
                        hint: 'Add ?testOrderId=YOUR_ORDER_ID to test this API with a specific order'
                    },
                    raw_response: null,
                    record_count: 0,
                    status: 'success', // Marked success but with note
                    called_at: new Date().toISOString(),
                    response_time_ms: 0,
                });
            }
        } catch (error: any) {
            results.push({
                api_name: 'Get Order Price Detail',
                endpoint: 'GET /order/202407/orders/{order_id}/price_detail',
                method: 'GET',
                description: 'Returns granular price details.',
                how_we_use_it: 'Used for GMV auditing.',
                request_params: {
                    attempted_order_id: allOrders.length > 0 ? allOrders[0]?.order_id : 'none',
                    error_message: error.message,
                    error_code: (error as any).code
                },
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }
        // ============================================================
        // API 4: SEARCH PRODUCTS (paginated, up to maxPages)
        // ============================================================
        try {
            const start = Date.now();
            const allProducts: any[] = [];
            const allRawResponses: any[] = [];
            let pageToken: string | undefined;
            let pageCount = 0;

            while (pageCount < maxPages) {
                const params: any = {
                    page_size: 20,
                };
                if (pageToken) params.page_token = pageToken;

                const rawPage = await tiktokShopApi.searchProducts(accessToken, shopCipher, params);
                allRawResponses.push({
                    page: pageCount + 1,
                    response: rawPage
                });

                if (rawPage?.products) {
                    allProducts.push(...rawPage.products);
                }

                pageCount++;
                pageToken = rawPage?.next_page_token;
                if (!pageToken) break;
            }

            results.push({
                api_name: 'Search Products',
                endpoint: 'POST /product/202502/products/search',
                method: 'POST',
                description: `Returns the product catalog from TikTok Shop. Includes product titles, images, prices, SKUs, inventory, and status. Fetched ${pageCount} page(s) of up to ${maxPages} max.`,
                how_we_use_it: 'We store product details including title, images, price, SKU info, and inventory counts. These are displayed in the Products tab. Product data is cross-referenced with order line items to show which products sold.',
                request_params: {
                    page_size: 20,
                    pages_fetched: pageCount,
                    max_pages: maxPages,
                },
                raw_response: allRawResponses,
                record_count: allProducts.length,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Search Products',
                endpoint: 'POST /product/202502/products/search',
                method: 'POST',
                description: 'Returns the product catalog.',
                how_we_use_it: 'Products displayed in the Products tab.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 5: GET FINANCE STATEMENTS
        // ============================================================
        try {
            const start = Date.now();
            const rawResponse = await tiktokShopApi.getStatements(accessToken, shopCipher, {
                page_size: 20,
                sort_field: 'statement_time',
                sort_order: 'DESC',
                start_time: orderStartTime,
                end_time: orderEndTime,
            });
            results.push({
                api_name: 'Get Finance Statements',
                endpoint: 'GET /finance/202309/statements',
                method: 'GET',
                description: 'Returns settlement statements from TikTok Shop Finance. Each statement represents a payout period with total revenue, fees, and net amount.',
                how_we_use_it: 'Settlement statements are used in the P&L (Profit & Loss) view and Finance Debug view. We display statement_id, settlement period, revenue, fees (commission, transaction fee, shipping), and net payout amount. These are the official TikTok settlement records.',
                request_params: { page_size: 20, sort_field: 'statement_time', sort_order: 'DESC', start_time: orderStartTime, end_time: orderEndTime },
                raw_response: rawResponse,
                record_count: rawResponse?.statement_transactions?.length || rawResponse?.statements?.length || 0,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Finance Statements',
                endpoint: 'GET /finance/202309/statements',
                method: 'GET',
                description: 'Returns settlement statements.',
                how_we_use_it: 'Used in P&L and Finance views.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 6: GET FINANCE PAYMENTS
        // ============================================================
        try {
            const start = Date.now();
            const rawResponse = await tiktokShopApi.getPayments(accessToken, shopCipher, {
                page_size: 20,
                sort_field: 'create_time',
                sort_order: 'DESC',
                create_time_ge: orderStartTime,
                create_time_lt: orderEndTime,
            });
            results.push({
                api_name: 'Get Finance Payments',
                endpoint: 'GET /finance/202309/payments',
                method: 'GET',
                description: 'Returns payment records from TikTok Shop. Payments represent individual order-level financial transactions.',
                how_we_use_it: 'Payment data is used for detailed financial breakdowns in the P&L view. Each payment shows the order-level revenue, platform fees, and shipping deductions.',
                request_params: { page_size: 20, sort_field: 'create_time', sort_order: 'DESC', create_time_ge: orderStartTime, create_time_lt: orderEndTime },
                raw_response: rawResponse,
                record_count: rawResponse?.payments?.length || 0,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Finance Payments',
                endpoint: 'GET /finance/202309/payments',
                method: 'GET',
                description: 'Returns payment records.',
                how_we_use_it: 'Used in financial breakdowns.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 7: GET FINANCE WITHDRAWALS
        // ============================================================
        try {
            const start = Date.now();
            const rawResponse = await tiktokShopApi.getWithdrawals(accessToken, shopCipher, {
                page_size: 20,
                types: '1,2',
            });
            results.push({
                api_name: 'Get Finance Withdrawals',
                endpoint: 'GET /finance/202309/withdrawals',
                method: 'GET',
                description: 'Returns payout/withdrawal records. These are actual money transfers from TikTok to the seller\'s bank account. Types: 1=User Withdrawal, 2=Auto Withdrawal.',
                how_we_use_it: 'Withdrawal data shows actual payouts received. Displayed in the Finance section to show when and how much money was transferred to the seller\'s bank account.',
                request_params: { page_size: 20, types: '1,2' },
                raw_response: rawResponse,
                record_count: rawResponse?.withdrawals?.length || 0,
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Finance Withdrawals',
                endpoint: 'GET /finance/202309/withdrawals',
                method: 'GET',
                description: 'Returns payout/withdrawal records.',
                how_we_use_it: 'Shows actual bank payouts.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // ============================================================
        // API 8: GET SHOP PERFORMANCE (Analytics API)
        // ============================================================
        try {
            const start = Date.now();
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            const perfParams = {
                start_date_ge: yesterday,
                end_date_lt: today,
            };
            const rawResponse = await tiktokShopApi.makeApiRequest(
                '/analytics/202405/shop/performance',
                accessToken,
                shopCipher,
                perfParams,
                'GET'
            );
            results.push({
                api_name: 'Get Shop Performance (Analytics)',
                endpoint: 'GET /analytics/202405/shop/performance',
                method: 'GET',
                description: 'Returns shop performance analytics including GMV, orders, conversion rates, and shop rating from TikTok\'s analytics API.',
                how_we_use_it: 'Performance metrics are displayed in the Overview dashboard to show shop health, GMV trends, order volume, and operational quality scores.',
                request_params: { start_date_ge: yesterday, end_date_lt: today, shop_cipher: '[PROVIDED]' },
                raw_response: rawResponse,
                record_count: rawResponse?.performance?.intervals?.length || (rawResponse ? 1 : 0),
                status: 'success',
                called_at: new Date().toISOString(),
                response_time_ms: Date.now() - start,
            });
        } catch (error: any) {
            results.push({
                api_name: 'Get Shop Performance (Analytics)',
                endpoint: 'GET /analytics/202405/shop/performance',
                method: 'GET',
                description: 'Returns shop performance analytics.',
                how_we_use_it: 'Displayed in Overview dashboard for shop health metrics.',
                request_params: {},
                raw_response: null,
                record_count: 0,
                status: 'error',
                error_message: error.message,
                called_at: new Date().toISOString(),
                response_time_ms: 0,
            });
        }

        // Build final response
        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.filter(r => r.status === 'error').length;

        res.json({
            success: true,
            audit: {
                title: 'TikTok API Raw Data Audit',
                description: 'This page shows raw, unmodified responses from TikTok\'s official APIs. No data from our database (Supabase) is shown here — only direct API responses. This proves that the data displayed on the Mamba dashboard comes directly from TikTok.',
                disclaimer: `Data is limited to the first ${maxPages} pages per API to avoid rate limits. For full data, the dashboard syncs all pages in the background.`,
                audit_started_at: auditStartTime,
                audit_completed_at: new Date().toISOString(),
                shop_name: shop.shop_name,
                shop_id: shop.shop_id,
                account_id: accountId,
                total_apis_called: results.length,
                successful: successCount,
                failed: errorCount,
                tiktok_api_base: 'https://open-api.tiktokglobalshop.com',
                authentication_method: 'OAuth 2.0 with HMAC-SHA256 signed requests',
                note: 'Access tokens are obtained via TikTok\'s official OAuth flow. The only database interaction is retrieving the stored OAuth token to authenticate API calls.',
                date_filter: startDate && endDate ? { startDate, endDate } : null,
            },
            api_results: results,
            smart_sync_explanation: {
                title: 'How Mamba\'s Smart Auto-Stop Sync Works',
                overview: 'When syncing data from TikTok, Mamba does NOT blindly re-download everything every time. It uses a "Smart Auto-Stop" system to only fetch what\'s new, saving time and avoiding TikTok API rate limits.',
                steps: [
                    {
                        name: 'First Sync (Full Download)',
                        description: 'The very first time a shop is synced, Mamba downloads ALL available data from TikTok — all orders, products, settlements, etc. It pages through every result until TikTok says there are no more pages (next_page_token is empty). This can take several minutes for shops with thousands of orders.',
                    },
                    {
                        name: 'Incremental Sync (Smart Auto-Stop) — Orders & Settlements',
                        description: 'On every sync after the first, Mamba uses Smart Auto-Stop for orders and settlements. Here is exactly what happens: (1) Before calling TikTok, Mamba loads the IDs of all orders (or settlements) it already has in its database into memory as a Set. (2) It then calls TikTok\'s API to get the latest data, sorted newest-first. (3) For each record TikTok returns, Mamba checks: "Is this order/settlement ID already in my Set?" (4) As long as the records are NEW (not in the Set), Mamba keeps them and fetches the next page. (5) The MOMENT it finds even one record that already exists in the database, it STOPS immediately — because that means everything after that point was already downloaded in a previous sync. This is why it\'s called "auto-stop": it automatically knows when it has caught up. A typical incremental sync only downloads 1-2 pages of brand new data instead of re-downloading hundreds of pages.',
                    },
                    {
                        name: 'Products — Always Full Refresh (No Smart Stop)',
                        description: 'Products do NOT use Smart Auto-Stop. Unlike orders (which never change once placed), products can be updated at any time — their price, stock, title, or status can change. So every time a product sync runs, Mamba re-downloads ALL products from TikTok to make sure every detail is up to date. There is no shortcut here: every product is re-fetched and upserted (inserted or updated) in the database every single sync. This ensures the Products tab always shows the latest prices, stock levels, and statuses exactly as they are on TikTok.',
                    },
                    {
                        name: 'Token-Based Pagination',
                        description: 'TikTok\'s API uses cursor-based pagination. Each response includes a next_page_token — a pointer to the next set of results. Mamba passes this token in the next request to get the following page. If TikTok returns no next_page_token, or returns the same token as the previous request, it means there are no more pages. Sync stops naturally at that point.',
                    },
                    {
                        name: 'Safety Limits',
                        description: 'Even if something goes wrong (e.g. TikTok keeps returning the same token in a loop), Mamba has hard safety limits that force-stop the sync: max 500 pages for orders (covers 50,000+ orders), max 50 pages for products and settlements, max 20 pages per individual statement\'s transactions. These are emergency brakes that prevent infinite loops. Under normal operation, they are never hit.',
                    },
                    {
                        name: 'Finance: Processing Only Unfinished Records',
                        description: 'Some financial data requires extra processing. For example: (a) FBT Fulfillment Fees — some orders are fulfilled by TikTok\'s warehouse (called "Fulfilled by TikTok" or FBT). The fulfillment fee for each FBT order must be fetched separately. Instead of re-checking every single order, Mamba looks in its database for FBT orders where the fulfillment fee field is still empty (NULL). It only calls TikTok\'s API for those specific orders that haven\'t been processed yet. Once an order\'s fee is fetched, it\'s saved and never re-fetched. (b) Statement Transaction Summaries — each settlement statement can contain dozens of individual transactions (fees, adjustments, etc.). Mamba checks which statements don\'t yet have a transaction summary saved (the field is NULL), and only fetches transaction details for those. Statements that already have summaries are skipped entirely. In both cases, the logic is: "Only call TikTok for records we haven\'t finished processing." This avoids unnecessary API calls and speeds up syncing.',
                    },
                    {
                        name: 'Deduplication',
                        description: 'Even within a single sync, orders are deduplicated by their order_id using a Map. If TikTok returns the same order twice across pages, only one copy is stored.',
                    },
                ],
                key_point: 'The data on the dashboard is identical to what TikTok returns. Mamba does not modify, fabricate, or inflate any numbers. The Smart Auto-Stop simply avoids re-downloading data we already have — the data itself is always TikTok\'s raw response, stored as-is.',
            },
            token_refresh_explanation: {
                title: 'How Mamba Handles TikTok Authentication & Token Refresh',
                overview: 'To access your shop\'s data, TikTok requires an OAuth 2.0 access token. These tokens expire. Mamba handles the entire token lifecycle automatically — including proactive renewal of tokens BEFORE they expire — so you never have to re-connect your shop unless TikTok itself revokes your authorization.',
                steps: [
                    {
                        name: 'Step 1: Initial Connection (OAuth Flow)',
                        description: 'When you first connect your TikTok Shop, you are redirected to TikTok\'s official authorization page. You log in with your TikTok account and grant Mamba permission to access your shop data. TikTok then sends back an "authorization code." Mamba exchanges this code with TikTok\'s servers (POST to https://auth.tiktok-shops.com/api/v2/token/get) and receives two tokens: (a) Access Token — used in every API call to prove Mamba is authorized. It expires in a few hours. (b) Refresh Token — used to get a new access token when the old one expires. It lasts much longer (weeks/months). Both tokens are stored securely in the database along with their exact expiration timestamps.',
                    },
                    {
                        name: 'Step 2: Every API Call — Automatic Token Check with 7-Day Proactive Buffer',
                        description: 'Every time Mamba needs to call a TikTok API (to fetch orders, products, etc.), it first runs a function called getShopWithToken(). This function does TWO checks: (1) REFRESH TOKEN CHECK — It checks the refresh_token_expires_at timestamp. If the refresh token has already expired, it throws an error immediately (the user must reconnect). If the refresh token expires within 7 DAYS, it proactively forces a token refresh right away — even if the access token is still valid. This is critical because refreshing the access token also gives us a brand new refresh token from TikTok, effectively resetting the clock. This 7-day buffer prevents the refresh token from silently dying. (2) ACCESS TOKEN CHECK — It checks the access_token (token_expires_at) timestamp with a 5-minute buffer. If the access token is still valid and won\'t expire for more than 5 minutes, it returns the existing token. If the access token expires within 5 minutes or is already expired, it automatically calls TikTok\'s refresh endpoint. The user never sees any of this — it happens silently before every API call.',
                    },
                    {
                        name: 'Step 3: Auto-Retry on Error 105002',
                        description: 'Sometimes, even though the access token hasn\'t technically expired by our clock, TikTok rejects it with error code 105002 ("token expired"). This can happen due to clock drift or if TikTok revokes the token early. Mamba handles this with a wrapper called executeWithRefresh(). Here is the exact logic: (1) Try the API call with the current access token. (2) If it succeeds — done. (3) If it fails with error 105002 — force-refresh the token (skips the time check and refreshes regardless). (4) Retry the API call with the new token. (5) If the retry ALSO fails with 105002, it means the refresh token itself is expired or revoked by TikTok. The shop is marked as "expired" in the database, and the user is informed they need to reconnect. This double-try approach means a single failed token never causes data loss.',
                    },
                    {
                        name: 'Step 4: Proactive Refresh on Every Dashboard Visit',
                        description: 'Every time you open the Mamba dashboard (or switch shops), the shop list loads. During this load, Mamba checks EVERY shop\'s tokens — not just the one you\'re viewing. For each shop, it checks three conditions: (a) Is the access token expired or expiring within 1 hour? (b) Is the refresh token expiring within 7 days? (c) Is the refresh token already dead? If (a) or (b) is true and the refresh token is still alive, Mamba immediately refreshes the tokens for that shop. This means simply opening the dashboard keeps ALL your shops\' tokens alive. If (c) is true, the shop is marked as expired and you\'ll see a "reconnect" message. This proactive approach means you should almost never see an expired shop as long as you use the dashboard at least once every few days.',
                    },
                    {
                        name: 'Step 5: Dedicated Token Health Cron Job',
                        description: 'In addition to the checks that happen when you visit the dashboard, Mamba runs a dedicated token health cron job (GET /sync/refresh-tokens) that can be scheduled to run every 1-2 hours. This lightweight job does NOT sync any data — it ONLY checks and refreshes tokens. It loops through ALL shops in the database and applies the same proactive logic: refresh any tokens where the access token is expired/near-expiry OR the refresh token expires within 7 days. This ensures tokens stay alive even if nobody visits the dashboard for days. The cron job logs exactly what it did for each shop: refreshed, skipped (healthy), or marked as expired.',
                    },
                    {
                        name: 'Step 6: Data Sync Cron Also Refreshes Proactively',
                        description: 'The main data sync cron job (which syncs orders, products, and settlements) also performs proactive token checks before syncing each shop. Before any API calls are made for a shop, it checks the same conditions: access token near expiry or refresh token within 7 days. If a shop\'s refresh token has completely expired, it skips that shop entirely (no wasted API calls) and marks it as expired. If the tokens just need refreshing, it refreshes them first, then proceeds with the data sync.',
                    },
                    {
                        name: 'Step 7: What Happens When a Token Is Refreshed',
                        description: 'When Mamba successfully refreshes a token, TikTok returns an entirely new pair: a new access token AND a new refresh token. Both replace the old ones in the database. The old tokens become invalid immediately. The new access token\'s expiry is calculated as: current time + access_token_expire_in seconds. The new refresh token\'s expiry is calculated as: current time + refresh_token_expire_in seconds. This means every successful refresh extends the life of the refresh token too — so as long as ANY of the proactive mechanisms fire (dashboard visit, cron job, or data sync), the refresh token keeps renewing itself and the user never has to reconnect.',
                    },
                    {
                        name: 'Step 8: When Reconnection Is Required',
                        description: 'The only situations where you need to manually reconnect your shop are: (a) TikTok revokes your authorization (e.g., you change your TikTok password, TikTok app review, or TikTok policy changes). (b) The refresh token fully expires without any of the proactive mechanisms catching it — this would require BOTH the cron jobs to be down AND nobody visiting the dashboard for the entire lifespan of the refresh token (typically months). (c) TikTok returns error 105002 on both the initial call and the retry, meaning TikTok has completely invalidated the session. In all these cases, the shop is clearly marked as "expired" with a message to reconnect.',
                    },
                ],
                key_point: 'Mamba proactively refreshes tokens BEFORE they expire — using a 7-day buffer for refresh tokens and a 1-hour buffer for access tokens. This happens at 3 independent layers: every API call (getShopWithToken), every dashboard visit (shop list load), and scheduled cron jobs (token health + data sync). As long as any one of these fires regularly, your shop will never expire unexpectedly.',
            },
        });
    } catch (error: any) {
        console.error('[Debug] Raw data audit error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            detail: 'Failed to perform raw data audit. This may be due to an expired access token or API rate limiting.',
        });
    }
});

export default router;
