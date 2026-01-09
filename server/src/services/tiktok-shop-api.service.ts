import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables FIRST
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
    seller_id?: string; // Partner ID in Partner flow
    [key: string]: any; // Allow other fields
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
            // TRIM whitespace to prevent signature errors from copy-pasting .env values
            appSecret: (process.env.TIKTOK_SHOP_APP_SECRET || '').trim(),
            apiBase: process.env.TIKTOK_SHOP_API_BASE || 'https://open-api.tiktokglobalshop.com',
            authBase: process.env.TIKTOK_AUTH_BASE || 'https://auth.tiktok-shops.com',
            serviceId: process.env.TIKTOK_SHOP_SERVICE_ID,
        };

        // Debug logging
        console.log('TikTok Shop API Service initialized with:');
        console.log('  Environment: PRODUCTION');
        console.log('  APP_KEY:', this.config.appKey ? `${this.config.appKey.substring(0, 5)}...` : 'MISSING');
        console.log('  API_BASE:', this.config.apiBase);
        console.log('  AUTH_BASE:', this.config.authBase);
    }

    /**
     * Validate that credentials are configured
     */
    private validateCredentials(): void {
        if (!this.config.appKey || !this.config.appSecret) {
            throw new Error('TikTok Shop API credentials not configured');
        }
    }

    /**
     * Generate OAuth authorization URL
     */
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

    /**
     * Generate Service (Partner) OAuth authorization URL
     */
    generateServiceAuthUrl(state: string): string {
        if (!this.config.serviceId) {
            throw new Error('TikTok Shop Service ID not configured');
        }

        // Service Auth URL is different for US vs Global
        // User provided: https://partner.us.tiktokshop.com/open/authorize
        const serviceAuthBase = 'https://partner.us.tiktokshop.com/open/authorize';

        const params = new URLSearchParams({
            service_id: this.config.serviceId,
            state: state,
        });

        return `${serviceAuthBase}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for access and refresh tokens
     */
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
        } catch (error: any) {
            console.error('Error exchanging code for tokens:', error);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            throw new Error(`Failed to exchange authorization code: ${error.message}`);
        }
    }

    /**
     * Refresh access token using refresh token
     */
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
        } catch (error: any) {
            console.error('Error refreshing token:', error);
            throw new Error(`Failed to refresh access token: ${error.message}`);
        }
    }

    /**
     * Generate signature for API requests (Fixed Logic)
     */
    /**
     * Generate signature for API requests (Fixed Logic)
     */
    private generateSignature(path: string, params: Record<string, any>, body?: any): string {
        // 1. Filter out keys that should not be signed
        const excludeKeys = ['access_token', 'sign'];

        // 2. Sort keys alphabetically and filter out undefined/null/empty values
        const sortedKeys = Object.keys(params)
            .filter(key =>
                !excludeKeys.includes(key) &&
                params[key] !== undefined &&
                params[key] !== null &&
                params[key] !== ''
            )
            .sort();

        // 3. Concatenate KeyValue pairs
        let paramString = '';
        sortedKeys.forEach(key => {
            // Ensure value is converted to string exactly as it will be sent
            paramString += `${key}${String(params[key])}`;
        });

        // 4. Prepend Path
        let stringToSign = `${path}${paramString}`;

        // 5. Append Body if present (Step 4 in documentation)
        if (body && Object.keys(body).length > 0) {
            stringToSign += JSON.stringify(body);
        }

        // 6. Wrap with App Secret
        stringToSign = `${this.config.appSecret}${stringToSign}${this.config.appSecret}`;

        // 7. HMAC-SHA256
        const hmac = crypto.createHmac('sha256', this.config.appSecret);
        hmac.update(stringToSign);
        return hmac.digest('hex');
    }

    /**
     * Make authenticated API request to TikTok Shop
     */
    async makeApiRequest(
        endpoint: string,
        accessToken: string,
        shopCipher: string,
        params: Record<string, any> = {},
        method: 'GET' | 'POST' = 'GET',
        excludeShopCipher: boolean = false,
        axiosConfig: any = {}
    ): Promise<any> {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const path = endpoint;

            // System params that go into every request
            const systemParams: any = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
            };

            // Only add shop_cipher if it's explicitly provided and not null, AND not excluded
            if (shopCipher && !excludeShopCipher) {
                systemParams.shop_cipher = shopCipher;
            }

            let signatureParams: any = { ...systemParams };
            let queryParams: any = { ...systemParams };
            let bodyParams: any = {};

            if (method === 'GET') {
                // For GET, all params are signed
                signatureParams = { ...signatureParams, ...params };
                queryParams = { ...queryParams, ...params };
            } else {
                // For POST (JSON), body is NOT signed in V2
                const { version, shop_id, shop_cipher: paramShopCipher, page_size, page_number, ...rest } = params;

                // Handle common special parameters that might be passed in params but belong in query
                if (version) {
                    signatureParams.version = version;
                    queryParams.version = version;
                }

                // If shop_id is provided, use it in both signature and query
                if (shop_id) {
                    signatureParams.shop_id = shop_id;
                    queryParams.shop_id = shop_id;

                    // If shop_id is present, we definitely don't need shop_cipher
                    delete signatureParams.shop_cipher;
                    delete queryParams.shop_cipher;
                }
                // ELSE: Keep shop_cipher in queryParams (it was added from systemParams)

                // Construct body params
                bodyParams = { ...rest };

                // For POST requests, pagination usually belongs ONLY in the body
                // BUT for some endpoints (like Orders), it seems to require them in Query or strict format
                // Let's add them to BOTH Query and Body to be safe, or prioritize Query if Body fails
                if (page_size) {
                    bodyParams.page_size = page_size;
                    queryParams.page_size = page_size; // Add to Query
                    signatureParams.page_size = page_size; // Add to Signature
                }
                if (page_number) {
                    bodyParams.page_number = page_number;
                    queryParams.page_number = page_number; // Add to Query
                    signatureParams.page_number = page_number; // Add to Signature
                }
                if (rest.page_token) {
                    queryParams.page_token = rest.page_token; // Add to Query
                    signatureParams.page_token = rest.page_token; // Add to Signature
                }
                if (rest.cursor) {
                    queryParams.cursor = rest.cursor; // Add to Query
                    signatureParams.cursor = rest.cursor; // Add to Signature
                }
            }

            // Generate signature
            const signature = this.generateSignature(path, signatureParams, bodyParams);
            queryParams.sign = signature;

            const url = `${this.config.apiBase}${path}`;

            const headers = {
                'x-tts-access-token': accessToken,
                'Content-Type': 'application/json',
            };

            // DEBUG: Log final request details
            console.log(`[TikTokApi] ${method} ${url}`);
            console.log('[TikTokApi] Query Params:', JSON.stringify(queryParams, null, 2));
            console.log('[TikTokApi] Body Params:', JSON.stringify(bodyParams, null, 2));
            console.log('[TikTokApi] Headers:', JSON.stringify(headers, null, 2));

            let response;
            if (method === 'GET') {
                response = await axios.get(url, {
                    params: queryParams,
                    headers,
                    ...axiosConfig
                });
            } else {
                response = await axios.post(
                    url,
                    bodyParams,
                    {
                        params: queryParams,
                        headers,
                        ...axiosConfig
                    }
                );
            }

            if (response.data.code !== 0) {
                // Enhanced error logging
                console.error(`TikTok API Error [${response.data.code}]: ${response.data.message}`);
                console.error(`Req ID: ${response.data.request_id}`);
                throw new TikTokShopError(
                    response.data.message,
                    response.data.code,
                    response.data.request_id,
                    response.data.detail
                );
            }

            return response.data.data;
        } catch (error: any) {
            // Detailed error reporting for debugging signatures
            if (error instanceof TikTokShopError) {
                throw error;
            }
            if (error.response?.data) {
                console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
                // Try to extract code from error response if available
                const code = error.response.data.code || 500;
                const message = error.response.data.message || 'TikTok API request failed';
                const requestId = error.response.data.request_id;
                throw new TikTokShopError(message, code, requestId);
            }
            throw error;
        }
    }

    /**
     * Get authorized shops for the access token
     */
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
        } catch (error: any) {
            console.error('Error getting authorized shops:', error);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`Failed to get authorized shops: ${error.message}`);
        }
    }

    /**
     * Get Shop Information
     * GET /shop/get
     */
    async getShopInfo(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/seller/202309/shops', accessToken, shopCipher, {}, 'GET', true);
    }

    /**
     * Get Seller Performance Metrics
     * GET /seller/performance
     */
    async getSellerPerformance(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/seller/202309/performance', accessToken, shopCipher);
    }

    /**
     * Search Orders
     * POST /order/202309/orders/search
     * 
     * Query params: page_size, sort_order, sort_field, page_token
     * Body params: order_status, create_time_ge, create_time_lt, update_time_ge, update_time_lt
     */
    async searchOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/order/202309/orders/search';

        // Map legacy param names to correct API names
        const create_time_ge = params.create_time_ge ?? params.create_time_from;
        const create_time_lt = params.create_time_lt ?? params.create_time_to;

        // === QUERY PARAMETERS ===
        // These go in the URL as query params
        const queryParams: Record<string, any> = {
            app_key: this.config.appKey,
            timestamp: timestamp.toString(),
            shop_cipher: shopCipher,
        };

        // Add optional query params per TikTok docs
        if (params.page_size) queryParams.page_size = String(params.page_size);
        if (params.sort_order) queryParams.sort_order = params.sort_order;
        if (params.sort_field) queryParams.sort_field = params.sort_field;
        if (params.page_token) queryParams.page_token = params.page_token;
        // page_number is for initial requests without page_token
        if (params.page_number && !params.page_token) queryParams.page_number = String(params.page_number);

        // === BODY PARAMETERS ===
        // These go in the POST body as JSON
        const bodyParams: Record<string, any> = {};

        if (create_time_ge) bodyParams.create_time_ge = Number(create_time_ge);
        if (create_time_lt) bodyParams.create_time_lt = Number(create_time_lt);
        if (params.update_time_ge) bodyParams.update_time_ge = Number(params.update_time_ge);
        if (params.update_time_lt) bodyParams.update_time_lt = Number(params.update_time_lt);
        if (params.order_status) bodyParams.order_status = params.order_status;

        // Generate signature using query params + body
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
                throw new TikTokShopError(
                    response.data.message,
                    response.data.code,
                    response.data.request_id,
                    response.data.detail
                );
            }

            return response.data.data;
        } catch (error: any) {
            if (error instanceof TikTokShopError) throw error;
            if (error.response?.data) {
                console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
                throw new TikTokShopError(
                    error.response.data.message || 'TikTok API request failed',
                    error.response.data.code || 500,
                    error.response.data.request_id
                );
            }
            throw error;
        }
    }

    /**
     * Get Order Detail
     * GET /orders/{order_id}
     * Note: TikTok API might use a different path for single order, usually it's a list query with IDs
     * Using /order/202309/orders to get details
     */
    async getOrderDetails(accessToken: string, shopCipher: string, orderIds: string[]): Promise<any> {
        return this.makeApiRequest('/order/202309/orders', accessToken, shopCipher, { order_ids: orderIds }, 'GET');
    }

    /**
     * Search Products
     * POST /product/202502/products/search
     */
    async searchProducts(accessToken: string, shopCipher: string, params: any): Promise<any> {
        // Remove 'version' param if it exists, as it is now in the path
        const { version, ...rest } = params;
        return this.makeApiRequest('/product/202502/products/search', accessToken, shopCipher, rest, 'POST');
    }

    /**
     * Get Settlements (Statements)
     * GET /finance/202309/statements
     */
    async getStatements(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/statements', accessToken, shopCipher, params, 'GET');
    }

    /**
     * Get Payments
     * GET /finance/202309/payments
     */
    async getPayments(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/payments', accessToken, shopCipher, params, 'GET');
    }

    /**
     * Get Payouts (Withdrawals)
     * GET /finance/202309/withdrawals
     */
    async getWithdrawals(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202309/withdrawals', accessToken, shopCipher, params, 'GET');
    }

    /**
     * Get Statement Transactions
     * GET /finance/202501/statements/{statement_id}/statement_transactions
     */
    async getStatementTransactions(accessToken: string, shopCipher: string, statementId: string, params: any): Promise<any> {
        return this.makeApiRequest(`/finance/202501/statements/${statementId}/statement_transactions`, accessToken, shopCipher, params, 'GET');
    }

    /**
     * Get Order Transactions
     * GET /finance/202501/orders/{order_id}/statement_transactions
     */
    async getOrderTransactions(accessToken: string, shopCipher: string, orderId: string, params: any): Promise<any> {
        return this.makeApiRequest(`/finance/202501/orders/${orderId}/statement_transactions`, accessToken, shopCipher, params, 'GET');
    }

    /**
     * Get Unsettled Orders
     * GET /finance/202507/orders/unsettled
     */
    async getUnsettledOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202507/orders/unsettled', accessToken, shopCipher, params, 'GET');
    }
}

export const tiktokShopApi = new TikTokShopApiService();
