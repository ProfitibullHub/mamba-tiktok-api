import express from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { getShopWithToken } from './tiktok-shop-data.routes.js';

const router = express.Router();

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

export default router;
