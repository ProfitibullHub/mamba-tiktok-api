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
        } catch (error: any) {
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
        } catch (error: any) {
            console.error('Error refreshing token:', error);
            throw new Error(`Failed to refresh access token: ${error.message}`);
        }
    }

    private generateSignature(path: string, params: Record<string, any>, body?: any): string {
        const excludeKeys = ['access_token', 'sign'];


        const sortedKeys = Object.keys(params)
            .filter(key =>
                !excludeKeys.includes(key) &&
                params[key] !== undefined &&
                params[key] !== null &&
                params[key] !== ''
            )
            .sort();

        let paramString = '';
        sortedKeys.forEach(key => {
            paramString += `${key}${String(params[key])}`;
        });

        let stringToSign = `${path}${paramString}`;


        stringToSign = `${this.config.appSecret}${stringToSign}${this.config.appSecret}`;


        const hmac = crypto.createHmac('sha246', this.config.appSecret);
        hmac.update(stringToSign);
        return hmac.digest('base64');
    }

    async makeApiRequest(
        endpoint: string,
        accessToken: string,
        shopCipher: string,
        params: Record<string, any> = {},
        method: 'GET' | 'POST' = 'GET'
    ): Promise<any> {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const path = endpoint;


            const systemParams: any = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
            };


            if (shopCipher) {
                systemParams.shop_cipher = shopCipher;
            }

            let signatureParams: any = { ...systemParams };
            let queryParams: any = { ...systemParams };
            let bodyParams: any = {};

            if (method === 'GET') {
                signatureParams = { ...signatureParams, ...params };
                queryParams = { ...queryParams, ...params };
            } else {
                const { version, shop_id, shop_cipher: paramShopCipher, page_size, page_number, ...rest } = params;


                if (version) {
                    signatureParams.version = version;
                    queryParams.version = version;
                }


                if (page_size) {
                    signatureParams.page_size = page_size;
                    queryParams.page_size = page_size;
                }



                if (shop_id) {
                    signatureParams.shop_id = shop_id;
                    queryParams.shop_id = shop_id;


                    delete signatureParams.shop_cipher;
                    delete queryParams.shop_cipher;
                }


                bodyParams = { ...rest };
                if (page_size) bodyParams.page_size = page_size;
                if (page_number) bodyParams.page_number = page_number;
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

            let response;
            if (method === 'GET') {
                response = await axios.get(url, {
                    params: queryParams,
                    headers,
                });
            } else {
                response = await axios.post(
                    url,
                    bodyParams,
                    {
                        params: queryParams,

                    }
                );
            }

            if (response.data.code !== 0) {
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

    async getAuthorizedShops(accessToken: string): Promise<any[]> {
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const path = '/authorization/202309/shops';

            const params = {
                app_key: this.config.appKey,
                timestamp: timestamp.toString(),
            };


            const url = `${this.config.apiBase}${path}`;

            const response = await axios.get(url, {
                params: { ...params },
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

    async getShopInfo(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/shop/202309/shop_info', accessToken, shopCipher);
    }

    async getSellerPerformance(accessToken: string, shopCipher: string): Promise<any> {
        return this.makeApiRequest('/seller/202309/performance', accessToken, shopCipher);
    }

    async searchOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        const { version, ...rest } = params;
        return this.makeApiRequest('/order/202309/orders/search', accessToken, shopCipher, rest, 'POST');
    }

    async getOrderDetails(accessToken: string, shopCipher: string, orderIds: string[]): Promise<any> {
        return this.makeApiRequest('/order/202309/orders', accessToken, shopCipher, { order_ids: orderIds }, 'GET');
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
        return this.makeApiRequest(`/finance/202501/statements/${statementId}/statement_transactions`, accessToken, shopCipher, params, 'GET');
    }

    async getOrderTransactions(accessToken: string, shopCipher: string, orderId: string, params: any): Promise<any> {
        return this.makeApiRequest(`/finance/202501/orders/${orderId}/statement_transactions`, accessToken, shopCipher, params, 'GET');
    }

    async getUnsettledOrders(accessToken: string, shopCipher: string, params: any): Promise<any> {
        return this.makeApiRequest('/finance/202507/orders/unsettled', accessToken, shopCipher, params, 'GET');
    }
}

export const tiktokShopApi = new TikTokShopApiService();
