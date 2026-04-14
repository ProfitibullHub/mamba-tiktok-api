import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
interface TikTokShopConfig {
    appKey: string;
    appSecret: string;
    apiBase: string;
    authBase: string;
    serviceId?: string;
}
interface TokenResponse {
    access_token: string;
    access_token_expire_in: number;
    refresh_token: string;
    refresh_token_expire_in: number;
    open_id: string;
    seller_name: string;
    seller_base_region: string;
    seller_id?: string;
    [key: string]: any;
}
export class TikTokShopError extends Error {
    code: number;
    requestId?: string;
    detail?: string;
    constructor(message: string, code: number, requestId?: string, detail?: string) {
        super(message);
        this.name = 'TikTokShopError';
        this.code = code;
        this.requestId = requestId;
        this.detail = detail;
    }
}
export class TikTokShopApiService {
    private config: TikTokShopConfig;
    constructor() {
        this.config = {
            appKey: process.env.TIKTOK_SHOP_APP_KEY || '',
            appSecret: (process.env.TIKTOK_SHOP_APP_SECRET || '').trim(),
            apiBase: process.env.TIKTOK_SHOP_API_BASE || 'https://open-api.tiktokglobalshop.com',
            authBase: process.env.TIKTOK_AUTH_BASE || 'https://auth.tiktok-shops.com',
            serviceId: process.env.TIKTOK_SHOP_SERVICE_ID,
        };
        console.log('TikTok Shop API Service initialized with:');
        console.log('  Environment: PRODUCTION');
        console.log('  APP_KEY:', this.config.appKey ? `${this.config.appKey.substring(0, 5)}...` : 'MISSING');
        console.log('  API_BASE:', this.config.apiBase);
        console.log('  AUTH_BASE:', this.config.authBase);
    }
    private validateCredentials(): void {
        if (!this.config.appKey || !this.config.appSecret) {
            throw new Error('TikTok Shop API credentials not configured');
        }
    }
    generateAuthUrl(state: string): string {
        this.validateCredentials();
        const redirectUri = process.env.TIKTOK_SHOP_REDIRECT_URI || '';
        const params = new URLSearchParams({
            app_key: this.config.appKey,
            state: state,
            redirect_uri: redirectUri,
        });
        return `${this.config.authBase}/api/v2/authorize?${params.toString()}`;
    }
    generateServiceAuthUrl(state: string): string {
        if (!this.config.serviceId) {
            throw new Error('TikTok Shop Service ID not configured');
        }
        const serviceAuthBase = 'https://partner.us.tiktokshop.com/open/authorize';
        const params = new URLSearchParams({
            service_id: this.config.serviceId,
            state: state,
        });
        return `${serviceAuthBase}?${params.toString()}`;
    }
    async exchangeCodeForTokens(authCode: string): Promise<TokenResponse> {
        try {
            const url = `${this.config.authBase}/api/v2/token/get`;
            const params = {
                app_key: this.config.appKey,
                app_secret: this.config.appSecret,
                auth_code: authCode,
                grant_type: 'authorized_code',
            };
            const response = await axios.get(url, { params });
            if (response.data.code !== 0) {
                throw new Error(`Token exchange failed: ${response.data.message}`);
            }
            const tokenData = response.data.data;
            console.log('Token exchange successful. Granted scopes:', tokenData.granted_scopes || 'No scopes returned');
            console.log('Access Token (first 10 chars):', tokenData.access_token ? `${tokenData.access_token.substring(0, 10)}...` : 'MISSING');
            return tokenData;
        }
        catch (error: any) {
            console.error('Error exchanging code for tokens:', error);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            throw new Error(`Failed to exchange authorization code: ${error.message}`);
        }
    }
    async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
        try {
            const url = `${this.config.authBase}/api/v2/token/refresh`;
            const params = {
                app_key: this.config.appKey,
                app_secret: this.config.appSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            };
            const response = await axios.get(url, { params });
            if (response.data.code !== 0) {
                throw new Error(`Token refresh failed: ${response.data.message}`);
            }
            return response.data.data;
        }
        catch (error: any) {
            console.error('Error refreshing token:', error);
            throw new Error(`Failed to refresh access token: ${error.message}`);
        }
    }
    private generateSignature(path: string, params: Record<string, any>, body?: any): string {
        const excludeKeys = ['access_token', 'sign'];
        const sortedKeys = Object.keys(params)
            .filter(key => !excludeKeys.includes(key) &&
            params[key] !== undefined &&
            params[key] !== null &&
            params[key] !== '')
            .sort();
        let paramString = '';
        sortedKeys.forEach(key => {
            paramString += `${key}${String(params[key])}`;
        });
        let stringToSign = `${path}${paramString}`;
        if (body && Object.keys(body).length > 0) {
            stringToSign += JSON.stringify(body);
        }
        stringToSign = `${this.config.appSecret}${stringToSign}${this.config.appSecret}`;
        const hmac = crypto.createHmac('sha256', this.config.appSecret);
        hmac.update(stringToSign);
        return hmac.digest('hex');
    }
    async makeApiRequest(endpoint: string, accessToken: string, shopCipher: string, params: Record<string, any> = {}, method: 'GET' | 'POST' = 'GET', excludeShopCipher: boolean = false, axiosConfig: any = {}, returnFullEnvelope: boolean = false): Promise<any> {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const path = endpoint;
            const systemParams: any = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
            };
            if (shopCipher && !excludeShopCipher) {
                systemParams.shop_cipher = shopCipher;
            }
            let signatureParams: any = { ...systemParams };
            let queryParams: any = { ...systemParams };
            let bodyParams: any = {};
            if (method === 'GET') {
                signatureParams = { ...signatureParams, ...params };
                queryParams = { ...queryParams, ...params };
            }
            else {
                const { version, shop_id, shop_cipher: paramShopCipher, page_size, page_number, ...rest } = params;
                if (version) {
                    signatureParams.version = version;
                    queryParams.version = version;
                }
                if (shop_id) {
                    signatureParams.shop_id = shop_id;
                    queryParams.shop_id = shop_id;
                    delete signatureParams.shop_cipher;
                    delete queryParams.shop_cipher;
                }
                bodyParams = { ...rest };
                if (page_size) {
                    bodyParams.page_size = page_size;
                    queryParams.page_size = page_size;
                    signatureParams.page_size = page_size;
                }
                if (page_number) {
                    bodyParams.page_number = page_number;
                    queryParams.page_number = page_number;
                    signatureParams.page_number = page_number;
                }
                if (rest.page_token) {
                    queryParams.page_token = rest.page_token;
                    signatureParams.page_token = rest.page_token;
                }
                if (rest.cursor) {
                    queryParams.cursor = rest.cursor;
                    signatureParams.cursor = rest.cursor;
                }
            }
            const signature = this.generateSignature(path, signatureParams, bodyParams);
            queryParams.sign = signature;
            const url = `${this.config.apiBase}${path}`;
            const headers = {
                'x-tts-access-token': accessToken,
                'Content-Type': 'application/json',
            };
            console.log(`[TikTokApi] ${method} ${url}`);
            console.log('[TikTokApi] Query Params:', JSON.stringify(queryParams, null, 2));
            console.log('[TikTokApi] Body Params:', JSON.stringify(bodyParams, null, 2));
            console.log('[TikTokApi] Headers:', JSON.stringify({ ...headers, 'x-tts-access-token': '[REDACTED]' }, null, 2));
            let attempt = 0;
            const maxRetries = 3;
            const baseDelay = 1000;
            while (attempt < maxRetries) {
                try {
                    let response;
                    if (method === 'GET') {
                        response = await axios.get(url, {
                            params: queryParams,
                            headers,
                            ...axiosConfig
                        });
                    }
                    else {
                        response = await axios.post(url, bodyParams, {
                            params: queryParams,
                            headers,
                            ...axiosConfig
                        });
                    }
                    if (response.data.code !== 0) {
                        console.error(`TikTok API Error [${response.data.code}]: ${response.data.message}`);
                        console.error(`Req ID: ${response.data.request_id}`);
                        throw new TikTokShopError(response.data.message, response.data.code, response.data.request_id, response.data.detail);
                    }
                    if (returnFullEnvelope) {
                        return response.data;
                    }
                    return response.data.data;
                }
                catch (error: any) {
                    const isRetryable = (error.response && [429, 500, 502, 503, 504].includes(error.response.status)) ||
                        (error.code === 'ECONNABORTED') ||
                        (error.code === 'ETIMEDOUT');
                    if (isRetryable && attempt < maxRetries - 1) {
                        attempt++;
                        const delay = baseDelay * Math.pow(2, attempt - 1);
                        console.warn(`[TikTokApi] Request failed with ${error.response?.status || error.code}. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    if (error instanceof TikTokShopError) {
                        throw error;
                    }
                    if (error.response?.data) {
                        console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
                        const code = error.response.data.code || 500;
                        const message = error.response.data.message || 'TikTok API request failed';
                        const requestId = error.response.data.request_id;
                        throw new TikTokShopError(message, code, requestId);
                    }
                    throw error;
                }
            }
        }
        catch (error) {
            throw error;
        }
    }
    async getAuthorizedShops(accessToken: string): Promise<any[]> {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const path = '/authorization/202309/shops';
            const params = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
            };
            const signature = this.generateSignature(path, params);
            const url = `${this.config.apiBase}${path}`;
            const response = await axios.get(url, {
                params: { ...params, sign: signature },
                headers: {
                    'x-tts-access-token': accessToken,
                    'Content-Type': 'application/json',
                },
            });
            if (response.data.code !== 0) {
                throw new Error(`Failed to get shops: ${response.data.message}`);
            }
            return response.data.data.shops || [];
        }
        catch (error: any) {
            console.error('Error getting authorized shops:', error);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`Failed to get authorized shops: ${error.message}`);
        }
    }
    async getShopInfo(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/seller/202309/shops', accessToken, shopCipher, {}, 'GET', true);
    }
    async getSellerPerformance(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/seller/202309/performance', accessToken, shopCipher);
    }
    async searchOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/order/202309/orders/search';
        const create_time_ge = params.create_time_ge ?? params.create_time_from;
        const create_time_lt = params.create_time_lt ?? params.create_time_to;
        const queryParams: Record<string, any> = {
            app_key: this.config.appKey,
            timestamp: timestamp.toString(),
            shop_cipher: shopCipher,
        };
        if (params.page_size)
            queryParams.page_size = String(params.page_size);
        if (params.sort_order)
            queryParams.sort_order = params.sort_order;
        if (params.sort_field)
            queryParams.sort_field = params.sort_field;
        if (params.page_token)
            queryParams.page_token = params.page_token;
        if (params.page_number && !params.page_token)
            queryParams.page_number = String(params.page_number);
        const bodyParams: Record<string, any> = {};
        if (create_time_ge)
            bodyParams.create_time_ge = Number(create_time_ge);
        if (create_time_lt)
            bodyParams.create_time_lt = Number(create_time_lt);
        if (params.update_time_ge)
            bodyParams.update_time_ge = Number(params.update_time_ge);
        if (params.update_time_lt)
            bodyParams.update_time_lt = Number(params.update_time_lt);
        if (params.order_status)
            bodyParams.order_status = params.order_status;
        const signature = this.generateSignature(path, queryParams, bodyParams);
        queryParams.sign = signature;
        const url = `${this.config.apiBase}${path}`;
        const headers = {
            'x-tts-access-token': accessToken,
            'Content-Type': 'application/json',
        };
        console.log(`[TikTokApi] POST ${url}`);
        console.log('[TikTokApi] Query Params:', JSON.stringify(queryParams, null, 2));
        console.log('[TikTokApi] Body Params:', JSON.stringify(bodyParams, null, 2));
        try {
            const response = await axios.post(url, bodyParams, {
                params: queryParams,
                headers,
            });
            if (response.data.code !== 0) {
                console.error(`TikTok API Error [${response.data.code}]: ${response.data.message}`);
                throw new TikTokShopError(response.data.message, response.data.code, response.data.request_id, response.data.detail);
            }
            return response.data.data;
        }
        catch (error: any) {
            if (error instanceof TikTokShopError)
                throw error;
            if (error.response?.data) {
                console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
                throw new TikTokShopError(error.response.data.message || 'TikTok API request failed', error.response.data.code || 500, error.response.data.request_id);
            }
            throw error;
        }
    }
    async getOrderDetails(accessToken: string, shopCipher: string, orderIds: string[]): Promise<any> {
        return this.makeApiRequest('/order/202309/orders', accessToken, shopCipher, { ids: orderIds.join(',') }, 'GET');
    }
    async getOrderPriceDetail(accessToken: string, shopCipher: string, orderId: string, shopId?: string): Promise<any> {
        if (!shopId) {
            throw new Error('shop_id is required for getOrderPriceDetail endpoint');
        }
        console.log('[getOrderPriceDetail] Called with:', {
            orderId,
            shopId,
            shopCipher: shopCipher ? 'provided' : 'missing',
            endpoint: `/order/202407/orders/${orderId}/price_detail`
        });
        return this.makeApiRequest(`/order/202407/orders/${orderId}/price_detail`, accessToken, shopCipher, { shop_id: shopId }, 'GET', false);
    }
    async searchProducts(accessToken: string, shopCipher: string, params: any): Promise<any> {
        const { version, ...rest } = params;
        return this.makeApiRequest('/product/202502/products/search', accessToken, shopCipher, rest, 'POST');
    }
    async getStatements(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/statements', accessToken, shopCipher, params, 'GET');
    }
    async getPayments(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/payments', accessToken, shopCipher, params, 'GET');
    }
    async getWithdrawals(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/withdrawals', accessToken, shopCipher, params, 'GET');
    }
    async getStatementTransactions(accessToken: string, shopCipher: string, statementId: string, params: any): Promise<any> {
        // TikTok requires sort_field / sort_order (error 36009004 if omitted); sync/debug already pass them.
        const merged = {
            sort_field: 'order_create_time',
            sort_order: 'DESC',
            ...(params || {}),
        };
        return this.makeApiRequest(`/finance/202501/statements/${statementId}/statement_transactions`, accessToken, shopCipher, merged, 'GET');
    }
    /** Full TikTok response: { code, message, data, request_id } for Finance Debug. */
    async getStatementTransactionsEnvelope(accessToken: string, shopCipher: string, statementId: string, params: any): Promise<any> {
        const merged = {
            sort_field: 'order_create_time',
            sort_order: 'DESC',
            ...(params || {}),
        };
        return this.makeApiRequest(`/finance/202501/statements/${statementId}/statement_transactions`, accessToken, shopCipher, merged, 'GET', false, {}, true);
    }
    async getOrderTransactions(accessToken: string, shopCipher: string, orderId: string, params: any): Promise<any> {
        const merged = {
            sort_field: 'order_create_time',
            sort_order: 'DESC',
            ...(params || {}),
        };
        return this.makeApiRequest(`/finance/202501/orders/${orderId}/statement_transactions`, accessToken, shopCipher, merged, 'GET');
    }
    async getUnsettledOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202507/orders/unsettled', accessToken, shopCipher, params, 'GET');
    }
    async getProductDetails(accessToken: string, shopCipher: string, productId: string): Promise<any> {
        return this.makeApiRequest(`/product/202309/products/${productId}`, accessToken, shopCipher, {}, 'GET');
    }
    async editProduct(accessToken: string, shopCipher: string, productId: string, updates: any): Promise<any> {
        return this.makeApiRequest(`/product/202509/products/${productId}`, accessToken, shopCipher, updates, 'POST');
    }
    async deleteProducts(accessToken: string, shopCipher: string, productIds: string[]): Promise<any> {
        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/product/202309/products';
        const queryParams: any = {
            app_key: this.config.appKey,
            timestamp: timestamp.toString(),
            shop_cipher: shopCipher
        };
        const bodyParams = { product_ids: productIds };
        const signature = this.generateSignature(path, queryParams, bodyParams);
        queryParams.sign = signature;
        const url = `${this.config.apiBase}${path}`;
        const response = await axios.delete(url, {
            params: queryParams,
            headers: {
                'x-tts-access-token': accessToken,
                'Content-Type': 'application/json'
            },
            data: bodyParams
        });
        if (response.data.code !== 0) {
            throw new TikTokShopError(response.data.message, response.data.code, response.data.request_id);
        }
        return response.data.data;
    }
    async activateProducts(accessToken: string, shopCipher: string, productIds: string[]): Promise<any> {
        return this.makeApiRequest('/product/202309/products/activate', accessToken, shopCipher, {
            product_ids: productIds
        }, 'POST');
    }
    async deactivateProducts(accessToken: string, shopCipher: string, productIds: string[]): Promise<any> {
        return this.makeApiRequest('/product/202309/products/deactivate', accessToken, shopCipher, {
            product_ids: productIds
        }, 'POST');
    }
    async updateSkuPrice(accessToken: string, shopCipher: string, productId: string, skuId: string, price: {
        currency: string;
        sale_price: string;
    }): Promise<any> {
        return this.makeApiRequest(`/product/202309/products/${productId}/skus/${skuId}/price`, accessToken, shopCipher, price, 'POST');
    }
    async updateProductInventory(accessToken: string, shopCipher: string, productId: string, skus: Array<{
        id: string;
        inventory: Array<{
            warehouse_id: string;
            quantity: number;
        }>;
    }>): Promise<any> {
        return this.makeApiRequest(`/product/202309/products/${productId}/inventory/update`, accessToken, shopCipher, { skus }, 'POST');
    }
    async updateProductPrices(accessToken: string, shopCipher: string, productId: string, skus: Array<{
        id: string;
        original_price?: string;
        sale_price?: string;
    }>): Promise<any> {
        return this.makeApiRequest(`/product/202309/products/${productId}/prices/update`, accessToken, shopCipher, { skus }, 'POST');
    }
    async partialEditProduct(accessToken: string, shopCipher: string, productId: string, updates: {
        title?: string;
        description?: string;
        main_images?: Array<{
            uri: string;
        }>;
        skus?: Array<{
            id: string;
            seller_sku?: string;
            original_price?: string;
            sales_attributes?: Array<{
                id: string;
                value_id?: string;
                value_name?: string;
            }>;
        }>;
    }): Promise<any> {
        return this.makeApiRequest(`/product/202309/products/${productId}/partial_edit`, accessToken, shopCipher, updates, 'POST');
    }
    async uploadProductImage(accessToken: string, shopCipher: string, imageData: Buffer, fileName: string, useCase: 'MAIN_IMAGE' | 'SKU_IMAGE' | 'DESCRIPTION_IMAGE' | 'SIZE_CHART' = 'MAIN_IMAGE'): Promise<any> {
        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/product/202309/images/upload';
        const queryParams: Record<string, any> = {
            app_key: this.config.appKey,
            timestamp: timestamp.toString(),
            shop_cipher: shopCipher,
            use_case: useCase
        };
        const signature = this.generateSignature(path, queryParams);
        queryParams.sign = signature;
        const url = `${this.config.apiBase}${path}`;
        const FormData = require('form-data');
        const form = new FormData();
        form.append('data', imageData, {
            filename: fileName,
            contentType: 'image/jpeg'
        });
        const response = await axios.post(url, form, {
            params: queryParams,
            headers: {
                'x-tts-access-token': accessToken,
                ...form.getHeaders()
            }
        });
        if (response.data.code !== 0) {
            throw new TikTokShopError(response.data.message, response.data.code, response.data.request_id);
        }
        return response.data.data;
    }
    async getWarehouses(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/logistics/202309/warehouses', accessToken, shopCipher, {}, 'GET');
    }
    async getCategories(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/product/202309/categories', accessToken, shopCipher, {}, 'GET');
    }
    async getCategoryAttributes(accessToken: string, shopCipher: string, categoryId: string): Promise<any> {
        return this.makeApiRequest(`/product/202309/categories/${categoryId}/attributes`, accessToken, shopCipher, {}, 'GET');
    }
    async cancelShopAuthorization(accessToken: string, shopCipher: string): Promise<{
        success: boolean;
        message: string;
        rawResponse?: any;
    }> {
        try {
            this.validateCredentials();
            const timestamp = Math.floor(Date.now() / 1000);
            const path = '/authorization/202309/shops/cancel';
            const queryParams: Record<string, any> = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
                shop_cipher: shopCipher,
            };
            const signature = this.generateSignature(path, queryParams);
            queryParams.sign = signature;
            const url = `${this.config.apiBase}${path}`;
            console.log(`[TikTok Cancel Auth] Sending POST to: ${url}`);
            console.log('[TikTok Cancel Auth] Query Params:', JSON.stringify({ ...queryParams, sign: '***' }, null, 2));
            const response = await axios.post(url, {}, {
                params: queryParams,
                headers: {
                    'x-tts-access-token': accessToken,
                    'Content-Type': 'application/json',
                },
            });
            console.log('[TikTok Cancel Auth] Raw response:', JSON.stringify(response.data, null, 2));
            if (response.data.code !== 0) {
                const msg = response.data.message || 'Authorization cancellation failed';
                console.warn(`[TikTok Cancel Auth] ❌ Failed — code ${response.data.code}: ${msg}`);
                return { success: false, message: msg, rawResponse: response.data };
            }
            console.log('[TikTok Cancel Auth] ✅ Authorization successfully cancelled on TikTok');
            return { success: true, message: 'Authorization cancelled on TikTok', rawResponse: response.data };
        }
        catch (error: any) {
            const rawResponse = error.response?.data;
            const msg = rawResponse?.message || error.message || 'Unknown error';
            console.warn('[TikTok Cancel Auth] ❌ Request error:', msg);
            if (rawResponse)
                console.warn('[TikTok Cancel Auth] Raw error response:', JSON.stringify(rawResponse, null, 2));
            return { success: false, message: msg, rawResponse };
        }
    }
}
export const tiktokShopApi = new TikTokShopApiService();
