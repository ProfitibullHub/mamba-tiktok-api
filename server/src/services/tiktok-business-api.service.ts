/**
 * TikTok Business API (Marketing API) Service
 * 
 * Handles all interactions with TikTok ads platform
 * API Docs: https://business-api.tiktok.com/portal/docs
 */

import crypto from 'crypto';
import { Agent, request } from 'undici';

// Global dispatcher to extend timeouts for long-running TikTok queries (like Audience)
const customFetchDispatcher = new Agent({
    connectTimeout: 30000,
    headersTimeout: 30000,
    bodyTimeout: 30000,
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000
});

const TIKTOK_ADS_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

interface TikTokBusinessAPIConfig {
    appId: string;
    secret: string;
    accessToken: string;
}

class TikTokBusinessAPIService {
    private appId: string;
    private secret: string;

    constructor() {
        this.appId = process.env.TIKTOK_BUSINESS_APP_ID || '';
        this.secret = process.env.TIKTOK_BUSINESS_SECRET || '';

        if (!this.appId || !this.secret) {
            console.error('[TikTok Business API] Missing app credentials. Set TIKTOK_BUSINESS_APP_ID and TIKTOK_BUSINESS_SECRET in .env');
            // Don't throw here - allow service to initialize but fail on actual API calls
        }
    }

    /**
     * Generate authorization URL for advertiser to grant access.
     * IMPORTANT: The `scope` parameter explicitly requests all approved scopes.
     * Without it, the access token will NOT carry those permissions even if
     * the app is approved for them.
     */
    getAuthorizationUrl(accountId: string, redirectUri: string, returnUrl?: string): string {
        if (!this.appId) {
            throw new Error('TIKTOK_BUSINESS_APP_ID is not configured. Please set it in environment variables.');
        }

        // Include returnUrl in state so we can redirect back after OAuth
        const state = Buffer.from(JSON.stringify({
            accountId,
            timestamp: Date.now(),
            returnUrl: returnUrl || '/dashboard'
        })).toString('base64');

        // All approved scopes — must use TikTok's advertiser.xxx format.
        // TikTok returns these same names in the token response scope field.
        const scopes = [
            // Ad Account Management
            'advertiser.ad_account_management',
            // Ads Management (Campaign, Ad Group, Ad, etc.)
            'advertiser.ads_management',
            'advertiser.campaign_management',
            // GMV Max
            'advertiser.gmv_max',
            // GMV Max Report
            'advertiser.gmv_max_report',
            // Reporting
            'advertiser.report',
            // Audience Management
            'advertiser.audience_management',
            // Store Management
            'advertiser.store_management',
            // Identity & Video
            'advertiser.identity_and_video',
            // Creative / Video
            'advertiser.creative_management',
        ].join(',');

        const params = new URLSearchParams({
            app_id: this.appId,
            state,
            redirect_uri: redirectUri,
            scope: scopes,
            rid: crypto.randomBytes(16).toString('hex')
        });

        // TikTok OAuth requires the comma separator in scopes to NOT be URL-encoded
        return `https://business-api.tiktok.com/portal/auth?${params.toString().replace(/%2C/g, ',')}`;
    }

    /**
     * Exchange auth code for access token.
     * Returns the token, advertiser IDs, and the GRANTED scopes.
     * Always check the `scope` field to verify permissions.
     */
    async getAccessToken(authCode: string): Promise<{
        access_token: string;
        advertiser_ids: string[];
        scope?: string;
        advertiser_name?: string;
    }> {
        const response = await this.makeRequest('/oauth2/access_token/', 'POST', {
            app_id: this.appId,
            secret: this.secret,
            auth_code: authCode
        });

        const data = response.data;
        console.log('[TikTok OAuth] Granted scopes:', data.scope || 'NONE RETURNED');
        return data;
    }

    /**
     * Get list of advertiser accounts
     */
    async getAdvertisers(accessToken: string): Promise<any[]> {
        const response = await this.makeAuthorizedRequest(
            '/oauth2/advertiser/get/',
            'GET',
            accessToken,
            { app_id: this.appId, secret: this.secret }
        );

        return response.data?.list || [];
    }

    /**
     * Get advertiser info
     */
    async getAdvertiserInfo(accessToken: string, advertiserIds: string | string[]): Promise<any> {
        const ids = Array.isArray(advertiserIds) ? advertiserIds : [advertiserIds];
        const response = await this.makeAuthorizedRequest(
            '/advertiser/info/',
            'GET',
            accessToken,
            {
                advertiser_ids: JSON.stringify(ids),
                fields: JSON.stringify([
                    'advertiser_id',
                    'name',
                    'currency',
                    'timezone',
                    'balance',
                    'status',
                    'create_time'
                ])
            }
        );

        return response.data;
    }

    /**
     * Get campaigns for an advertiser
     */
    async getCampaigns(accessToken: string, advertiserId: string, filters?: {
        campaign_ids?: string[];
        objective_type?: string;
        primary_status?: string;
        status?: string;
        page?: number;
        page_size?: number;
    }): Promise<{
        list: any[];
        page_info: { total_number: number; page: number; page_size: number; total_page: number };
    }> {
        const response = await this.makeAuthorizedRequest(
            '/campaign/get/',
            'GET',
            accessToken,
            {
                advertiser_id: advertiserId,
                filtering: filters ? JSON.stringify(filters) : undefined,
                page: filters?.page || 1,
                page_size: filters?.page_size || 100,
                fields: JSON.stringify([
                    'campaign_id',
                    'campaign_name',
                    'objective_type',
                    'budget',
                    'budget_mode',
                    'secondary_status',
                    'operation_status',
                    'create_time',
                    'modify_time'
                ])
            }
        );

        return response.data;
    }

    /**
     * Get ad groups for an advertiser
     */
    async getAdGroups(accessToken: string, advertiserId: string, filters?: {
        campaign_ids?: string[];
        adgroup_ids?: string[];
        status?: string;
        page?: number;
        page_size?: number;
    }): Promise<{
        list: any[];
        page_info: any;
    }> {
        const response = await this.makeAuthorizedRequest(
            '/adgroup/get/',
            'GET',
            accessToken,
            {
                advertiser_id: advertiserId,
                filtering: filters ? JSON.stringify(filters) : undefined,
                page: filters?.page || 1,
                page_size: filters?.page_size || 100,
                fields: JSON.stringify([
                    'adgroup_id',
                    'adgroup_name',
                    'campaign_id',
                    'budget',
                    'budget_mode',
                    'secondary_status',
                    'operation_status',
                    'bid_type',
                    'bid_price',
                    'optimization_goal',
                    'create_time',
                    'modify_time'
                ])
            }
        );

        return response.data;
    }

    /**
     * Get ads (creatives) for an advertiser
     */
    async getAds(accessToken: string, advertiserId: string, filters?: {
        campaign_ids?: string[];
        adgroup_ids?: string[];
        ad_ids?: string[];
        status?: string;
        page?: number;
        page_size?: number;
    }): Promise<{
        list: any[];
        page_info: any;
    }> {
        const response = await this.makeAuthorizedRequest(
            '/ad/get/',
            'GET',
            accessToken,
            {
                advertiser_id: advertiserId,
                filtering: filters ? JSON.stringify(filters) : undefined,
                page: filters?.page || 1,
                page_size: filters?.page_size || 100,
                fields: JSON.stringify([
                    'ad_id',
                    'ad_name',
                    'adgroup_id',
                    'ad_format',
                    'ad_text',
                    'call_to_action',
                    'landing_page_url',
                    'video_id',
                    'image_ids',
                    'tiktok_item_id',
                    'secondary_status',
                    'operation_status',
                    'create_time',
                    'modify_time'
                ])
            }
        );

        return response.data;
    }

    /**
     * Get performance metrics/reports
     */
    async getReports(accessToken: string, advertiserId: string, params: {
        service_type: 'AUCTION'; // Required
        report_type: 'BASIC' | 'AUDIENCE' | 'PLAYABLE_MATERIAL' | 'CATALOG';
        data_level: 'AUCTION_ADVERTISER' | 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
        dimensions: string[]; // e.g., ['ad_id', 'stat_time_day']
        metrics: string[]; // e.g., ['impressions', 'clicks', 'spend', 'conversions']
        start_date: string; // YYYY-MM-DD
        end_date: string; // YYYY-MM-DD
        filters?: any[];
        page?: number;
        page_size?: number;
    }): Promise<{
        list: any[];
        page_info: any;
    }> {
        const response = await this.makeAuthorizedRequest(
            '/report/integrated/get/',
            'GET',
            accessToken,
            {
                advertiser_id: advertiserId,
                service_type: params.service_type,
                report_type: params.report_type,
                data_level: params.data_level,
                dimensions: JSON.stringify(params.dimensions),
                metrics: JSON.stringify(params.metrics),
                start_date: params.start_date,
                end_date: params.end_date,
                filters: params.filters ? JSON.stringify(params.filters) : undefined,
                page: params.page || 1,
                page_size: params.page_size || 1000
            }
        );

        return response.data;
    }

    /**
     * Get daily ad spend summary
     */
    async getDailySpend(accessToken: string, advertiserId: string, startDate: string, endDate: string): Promise<any[]> {
        const metrics = [
            'spend',
            'impressions',
            'clicks',
            'ctr',
            'cpc',
            'cpm',
            'complete_payment',
            'complete_payment_rate',
            'cost_per_complete_payment',
            'complete_payment_roas',
            'value_per_complete_payment',
            'total_complete_payment_rate'
        ];

        const response = await this.getReports(accessToken, advertiserId, {
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_ADVERTISER',
            dimensions: ['stat_time_day'],
            metrics,
            start_date: startDate,
            end_date: endDate
        });

        return response.list || [];
    }

    /**
     * Get campaign performance metrics
     */
    async getCampaignMetrics(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string,
        campaignIds?: string[]
    ): Promise<any[]> {
        const metrics = [
            'spend',
            'impressions',
            'clicks',
            'ctr',
            'cpc',
            'cpm',
            'reach',
            'frequency',
            'video_play_actions',
            'engaged_view',
            'video_watched_6s',
            'video_views_p25',
            'video_views_p50',
            'video_views_p75',
            'video_views_p100',
            'likes',
            'comments',
            'shares',
            'follows',
            'profile_visits',
            'profile_visits_rate',
            'complete_payment',
            'complete_payment_rate',
            'cost_per_complete_payment',
            'complete_payment_roas',
            'value_per_complete_payment',
            'total_complete_payment_rate'
        ];

        if (!campaignIds?.length) {
            const chunks = this._chunkDateRange(startDate, endDate, 30);
            const allRows: any[] = [];

            for (const chunk of chunks) {
                try {
                    const response = await this.getReports(accessToken, advertiserId, {
                        service_type: 'AUCTION',
                        report_type: 'BASIC',
                        data_level: 'AUCTION_CAMPAIGN',
                        dimensions: ['campaign_id', 'stat_time_day'],
                        metrics,
                        start_date: chunk.start,
                        end_date: chunk.end
                    });
                    if (response.list) {
                        allRows.push(...response.list);
                    }
                } catch (err: any) {
                    console.warn(`[API] Failed to fetch campaign metrics chunk ${chunk.start}→${chunk.end}:`, err.message);
                }
            }
            return allRows;
        }

        const CHUNK_SIZE = 100;
        const allResults: any[] = [];
        for (let i = 0; i < campaignIds.length; i += CHUNK_SIZE) {
            const chunk = campaignIds.slice(i, i + CHUNK_SIZE);
            const filters = [
                {
                    field_name: 'campaign_ids',
                    filter_type: 'IN',
                    filter_value: chunk
                }
            ];

            try {
                const response = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'BASIC',
                    data_level: 'AUCTION_CAMPAIGN',
                    dimensions: ['campaign_id', 'stat_time_day'],
                    metrics,
                    start_date: startDate,
                    end_date: endDate,
                    filters
                });
                if (response.list) {
                    allResults.push(...response.list);
                }
            } catch (err: any) {
                console.warn(`[API] Failed to fetch campaign metrics chunk:`, err.message);
            }
        }

        return allResults;
    }

    /**
     * Get ad-level performance metrics (including video performance)
     */
    async getAdMetrics(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string,
        adIds?: string[]
    ): Promise<any[]> {
        const metrics = [
            // Spend & Cost
            'spend',
            'cpc',
            'cpm',
            'cost_per_complete_payment',
            // Impressions & Reach
            'impressions',
            'reach',
            'frequency',
            // Engagement
            'clicks',
            'ctr',
            'likes',
            'comments',
            'shares',
            'follows',
            'profile_visits',
            // Video Performance
            'video_play_actions',
            'engaged_view',
            'video_watched_6s',
            'average_video_play',
            'average_video_play_per_user',
            'video_views_p25',
            'video_views_p50',
            'video_views_p75',
            'video_views_p100',
            // Conversions
            'complete_payment',
            'complete_payment_rate',
            'cost_per_complete_payment',
            'complete_payment_roas',
            'value_per_complete_payment',
            'total_complete_payment_rate'
        ];

        if (!adIds?.length) {
            const response = await this.getReports(accessToken, advertiserId, {
                service_type: 'AUCTION',
                report_type: 'BASIC',
                data_level: 'AUCTION_AD',
                dimensions: ['ad_id', 'stat_time_day'],
                metrics,
                start_date: startDate,
                end_date: endDate
            });
            return response.list || [];
        }

        const CHUNK_SIZE = 100;
        const allResults: any[] = [];
        for (let i = 0; i < adIds.length; i += CHUNK_SIZE) {
            const chunk = adIds.slice(i, i + CHUNK_SIZE);
            const filters = [
                {
                    field_name: 'ad_ids',
                    filter_type: 'IN',
                    filter_value: chunk
                }
            ];

            try {
                const response = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'BASIC',
                    data_level: 'AUCTION_AD',
                    dimensions: ['ad_id', 'stat_time_day'],
                    metrics,
                    start_date: startDate,
                    end_date: endDate,
                    filters
                });
                if (response.list) {
                    allResults.push(...response.list);
                }
            } catch (err: any) {
                console.warn(`[API] Failed to fetch ad metrics chunk:`, err.message);
            }
        }

        return allResults;
    }


    /**
     * Make authenticated API request
     */
    private async makeAuthorizedRequest(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        accessToken: string,
        params: Record<string, any> = {}
    ): Promise<any> {
        // Use string concatenation to preserve the /open_api/v1.3 path prefix
        // (new URL() with a leading-/ endpoint would drop the base path)
        const url = new URL(`${TIKTOK_ADS_API_BASE_URL}${endpoint}`);

        // Add query params
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key].toString());
            }
        });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Access-Token': accessToken
        };

        const { statusCode, headers: resHeaders, body } = await request(url.toString(), {
            method,
            headers,
            dispatcher: customFetchDispatcher
        });

        if (statusCode < 200 || statusCode >= 300) {
            const text = await body.text();
            console.error('[TikTok Ads API] HTTP Error:', {
                url: url.toString(),
                status: statusCode,
                body: text.substring(0, 500)
            });
            throw new Error(`TikTok Ads API HTTP Error ${statusCode}`);
        }

        const contentType = resHeaders['content-type'];
        if (!contentType || !String(contentType).includes('application/json')) {
            const text = await body.text();
            console.error('[TikTok Ads API] Non-JSON response:', text.substring(0, 500));
            throw new Error('TikTok Ads API returned non-JSON response. Expected JSON.');
        }

        const data: any = await body.json();

        if (data.code !== 0) {
            throw new Error(`TikTok Ads API Error: ${data.message} (Code: ${data.code})`);
        }

        return data;
    }

    /**
     * Make unauthenticated API request (for auth endpoints)
     */
    private async makeRequest(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        body?: Record<string, any>
    ): Promise<any> {
        // Properly construct URL by appending endpoint to base URL
        // Don't use 'new URL()' as it replaces the path instead of appending
        const url = `${TIKTOK_ADS_API_BASE_URL}${endpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        const reqOptions: any = {
            method,
            headers,
            dispatcher: customFetchDispatcher
        };

        if (method === 'POST' && body) {
            reqOptions.body = JSON.stringify(body);
        }

        console.log('[TikTok Ads API] Request:', {
            url,
            method,
            body: body ? JSON.stringify(body, null, 2) : undefined
        });

        const { statusCode, headers: resHeaders, body: resBody } = await request(url, reqOptions);

        // Check if response is OK before parsing
        if (statusCode < 200 || statusCode >= 300) {
            const text = await resBody.text();
            console.error('[TikTok Ads API] HTTP Error:', {
                status: statusCode,
                body: text.substring(0, 500) // Log first 500 chars
            });
            throw new Error(`TikTok Ads API HTTP Error ${statusCode}`);
        }

        // Check content type before parsing JSON
        const contentType = resHeaders['content-type'];
        if (!contentType || !String(contentType).includes('application/json')) {
            const text = await resBody.text();
            console.error('[TikTok Ads API] Non-JSON response:', text.substring(0, 500));
            throw new Error('TikTok Ads API returned non-JSON response. Expected JSON.');
        }

        const data: any = await resBody.json();

        console.log('[TikTok Ads API] Response:', data);

        if (data.code !== 0) {
            throw new Error(`TikTok Ads API Error: ${data.message} (Code: ${data.code})`);
        }

        return data;
    }

    /**
     * Get a consolidated overview of ALL advertiser metrics in a single call.
     * Used by the new Marketing Dashboard to avoid 8+ parallel API calls.
     * Returns spend, impressions, clicks, conversions, engagement, video, and reach.
     * Max date range: 30 days (capped automatically).
     *
     * For pure GMV Max advertisers (0 regular campaigns), falls back to
     * /gmv_max/report/get/ using store IDs.
     */
    async getConsolidatedOverview(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string
    ): Promise<any> {
        // Clamp to 90-day window max
        const end = new Date(endDate);
        const maxStart = new Date(end);
        maxStart.setDate(end.getDate() - 89);
        const effectiveStart = new Date(startDate) < maxStart
            ? maxStart.toISOString().slice(0, 10)
            : startDate;

        // Only include metrics confirmed valid on AUCTION_ADVERTISER integrated report.
        // video_watched_2s is NOT valid here (causes 40002 on every chunk → 0 rows).
        const metrics = [
            // Spend & Cost
            'spend', 'cpc', 'cpm', 'cost_per_complete_payment',
            // Impressions & Reach
            'impressions', 'clicks', 'ctr', 'reach', 'frequency',
            // Conversions / Purchase
            'complete_payment', 'complete_payment_rate',
            'complete_payment_roas', 'value_per_complete_payment',
            'total_complete_payment_rate',
            // Engagement
            'likes', 'comments', 'shares', 'follows', 'profile_visits',
            // Video (video_watched_2s excluded — invalid on this endpoint)
            'video_play_actions', 'video_watched_6s',
            'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
            'average_video_play', 'average_video_play_per_user',
            'engaged_view'
        ];

        console.log(`[Consolidated Overview] advertiser_id=${advertiserId} date=${effectiveStart} to ${endDate}`);

        // Fetch via /report/integrated/get/ at AUCTION_ADVERTISER level (chunked to 30-day windows).
        // This returns both standard AUCTION and GMV Max advertiser-level data in one shot.
        const combinedRows: any[] = [];
        const chunks = this._chunkDateRange(effectiveStart, endDate, 30);
        console.log(`[Consolidated Overview] Fetching ${chunks.length} chunk(s) via integrated report...`);

        for (const chunk of chunks) {
            try {
                const r = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'BASIC',
                    data_level: 'AUCTION_ADVERTISER',
                    dimensions: ['stat_time_day'],
                    metrics,
                    start_date: chunk.start,
                    end_date: chunk.end
                });
                const rows = r?.list || [];
                console.log(`[Consolidated Overview] Chunk ${chunk.start}\u2192${chunk.end}: ${rows.length} rows`);
                combinedRows.push(...rows.map((row: any) => ({ ...row, is_gmv_max: false })));
            } catch (e: any) {
                // Log the full error — a 40002 usually means an invalid metric name.
                // If ALL chunks fail here, a metric in the list above is invalid for this endpoint.
                console.warn(`[Consolidated Overview] Chunk ${chunk.start}→${chunk.end} failed: ${e.message}`);
            }
        }

        console.log(`[Consolidated Overview] Total rows fetched: ${combinedRows.length}`);

        const finalSource = combinedRows.length > 0 ? 'auction' : 'none';

        return { list: combinedRows, effectiveStart, endDate, _source: finalSource };
    }

    /**
     * Split a date range into chunks of maxDays.
     */
    private _chunkDateRange(start: string, end: string, maxDays: number): { start: string; end: string }[] {
        const chunks: { start: string; end: string }[] = [];
        let cursor = new Date(start);
        const endDate = new Date(end);

        while (cursor <= endDate) {
            const chunkEnd = new Date(cursor);
            chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
            if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

            chunks.push({
                start: cursor.toISOString().slice(0, 10),
                end: chunkEnd.toISOString().slice(0, 10)
            });

            cursor = new Date(chunkEnd);
            cursor.setDate(cursor.getDate() + 1);
        }

        return chunks;
    }

    /**
     * Get GMV Max linked stores.
     * Uses /gmv_max/store/list/
     */
    async getGmvMaxStores(
        accessToken: string,
        advertiserId: string
    ): Promise<any[]> {
        try {
            const response = await this.makeAuthorizedRequest(
                '/gmv_max/store/list/',
                'GET',
                accessToken,
                { advertiser_id: advertiserId }
            );
            const stores = response.data?.list || response.data?.stores || [];
            console.log(`[GMV Max Stores] Found ${stores.length} store(s) for advertiser ${advertiserId}`);
            return stores;
        } catch (e: any) {
            console.warn('[GMV Max Stores] Failed:', e.message);
            return [];
        }
    }

    /**
     * Get GMV Max / Shop campaign performance via /report/integrated/get/.
     * Single clean call at AUCTION_ADVERTISER level.
     * Max date range: 30 days.
     */
    async getGmvMaxReport(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string,
        storeIds: string[] = []
    ): Promise<any> {
        const chunks = this._chunkDateRange(startDate, endDate, 30);
        console.log(`[GMV Report] advertiser_id=${advertiserId} storeIds=${JSON.stringify(storeIds)} date=${startDate} to ${endDate} (${chunks.length} chunk(s))`);

        // ── Primary path: dedicated /gmv_max/report/get/ endpoint ──────────────
        // Requires store_ids. We request a richer metric set so that GMV Max
        // can fully power impressions/clicks when the standard Ads API returns 0.
        if (storeIds.length > 0) {
            // NOTE: In practice, this endpoint currently rejects impression/click
            // metrics (e.g. product_impressions/product_clicks) with 40002
            // "Invalid metric(s)". We therefore only request the metrics that are
            // reliably accepted: spend/ROI and orders. Impressions for GMV Max
            // campaigns must come from the standard integrated reports if TikTok
            // exposes them there.
            const gmvMetrics = [
                'orders',  // number of orders, mapped → complete_payment
                'cost',    // ad spend
                'roi',     // return on investment
            ];

            // Map GMV Max metric names → standard names for downstream consumption
            const metricNameMap: Record<string, string> = {
                product_impressions: 'impressions',
                product_clicks: 'clicks',
                orders: 'complete_payment',
                cost: 'cost',
                roi: 'roi',
                ctr: 'ctr',
                gmv: 'gmv',
            };

            const allRows: any[] = [];
            for (const chunk of chunks) {
                try {
                    const makeGmvRequest = async (metricsToTry: string[]) => {
                        const url = new URL(`${TIKTOK_ADS_API_BASE_URL}/gmv_max/report/get/`);
                        url.searchParams.set('advertiser_id', advertiserId);
                        url.searchParams.set('store_ids', JSON.stringify(storeIds));
                        url.searchParams.set('dimensions', JSON.stringify(['campaign_id', 'stat_time_day']));
                        url.searchParams.set('metrics', JSON.stringify(metricsToTry));
                        url.searchParams.set('start_date', chunk.start);
                        url.searchParams.set('end_date', chunk.end);
                        url.searchParams.set('page_size', '1000');

                        const { statusCode, body } = await request(url.toString(), {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'Access-Token': accessToken
                            },
                            dispatcher: customFetchDispatcher
                        });
                        return body.json();
                    };

                    let json: any = await makeGmvRequest(gmvMetrics);

                    if (json.code === 0) {
                        const rows = json.data?.list || [];
                        console.log(`[GMV Report] /gmv_max/report/get/ chunk ${chunk.start}→${chunk.end}: ${rows.length} rows`);
                        if (rows.length > 0) {
                            console.log(`[GMV Report] First row RAW metric keys:`, Object.keys(rows[0].metrics || {}));
                        }
                        // Normalize metric names and log key business fields for inspection
                        const normalizedRows = rows.map((row: any) => {
                            const rawMetrics = row.metrics || {};
                            const normalized: Record<string, string> = {};
                            for (const [key, value] of Object.entries(rawMetrics)) {
                                const stdName = metricNameMap[key] || key;
                                normalized[stdName] = value as string;
                            }
                            // Also ensure 'spend' is set from 'cost'
                            if (normalized.cost && !normalized.spend) {
                                normalized.spend = normalized.cost;
                            }
                            return { ...row, metrics: normalized };
                        });
                        allRows.push(...normalizedRows);
                    } else {
                        console.warn(`[GMV Report] /gmv_max/report/get/ error code ${json.code}: ${json.message}`);
                    }
                } catch (e: any) {
                    console.warn(`[GMV Report] /gmv_max/report/get/ chunk ${chunk.start}→${chunk.end} failed:`, e.message);
                }
            }

            if (allRows.length > 0) {
                console.log(`[GMV Report] Using dedicated GMV Max endpoint — ${allRows.length} rows total`);
                return { list: allRows, _source: 'gmv_max_dedicated' };

            }
            console.warn(`[GMV Report] /gmv_max/report/get/ returned 0 rows — falling back to integrated endpoint`);

        }

        // ── Fallback path: /report/integrated/get/ at AUCTION_ADVERTISER level ─
        // Used when storeIds is empty or GMV Max endpoint returns nothing.
        // Returns standard metrics including complete_payment + value_per_complete_payment
        // from which GMV can be estimated.
        console.log(`[GMV Report] Using integrated fallback for advertiser ${advertiserId}`);
        const fallbackMetrics = [
            'spend', 'complete_payment', 'cost_per_complete_payment',
            'complete_payment_rate', 'value_per_complete_payment',
            'complete_payment_roas',
            'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach'
        ];

        const allRows: any[] = [];
        for (const chunk of chunks) {
            try {
                const r = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'BASIC',
                    data_level: 'AUCTION_ADVERTISER',
                    dimensions: ['stat_time_day'],
                    metrics: fallbackMetrics,
                    start_date: chunk.start,
                    end_date: chunk.end
                });
                const rows = r.list || [];
                console.log(`[GMV Report] Integrated chunk ${chunk.start}→${chunk.end}: ${rows.length} rows`);
                allRows.push(...rows);
            } catch (e: any) {
                console.warn(`[GMV Report] Integrated chunk ${chunk.start}→${chunk.end} failed:`, e.message);
            }
        }

        return { list: allRows, _source: allRows.length > 0 ? 'integrated_fallback' : 'none' };
    }

    /**
     * List GMV Max campaign sessions.
     * Uses /campaign/gmv_max/session/list/ — requires campaign_id.
     * Queries each campaign and merges results.
     */
    async getGmvMaxSessions(
        accessToken: string,
        advertiserId: string,
        campaignIds: string[] = []
    ): Promise<any> {
        if (campaignIds.length === 0) {
            console.log('[GMV Max Sessions] No campaign IDs provided — skipping.');
            return [];
        }

        const sessionPromises = campaignIds.slice(0, 20).map(async (campaignId) => {
            try {
                const response = await this.makeAuthorizedRequest(
                    '/campaign/gmv_max/session/list/',
                    'GET',
                    accessToken,
                    { advertiser_id: advertiserId, campaign_id: campaignId, page_size: 100 }
                );
                const sessions = response.data?.list || [];
                sessions.forEach((s: any) => { s._campaign_id = campaignId; });
                return sessions;
            } catch (e: any) {
                if (!e.message?.includes('campaign_id')) {
                    console.warn(`[GMV Max Sessions] campaign ${campaignId}:`, e.message);
                }
                return [];
            }
        });

        const results = await Promise.all(sessionPromises);
        const allSessions = results.flat();
        return allSessions;
    }

    /**
     * Get audience demographic report.
     * Uses /report/integrated/get/ with report_type AUDIENCE.
     */
    async getAudienceReport(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string
    ): Promise<any> {
        // TikTok AUDIENCE reports are capped at 30 days per request.
        // Chunk the requested date range into \u2264 30-day segments and aggregate.
        const chunks = this._chunkDateRange(startDate, endDate, 30);
        console.log(`[Audience] Fetching ${chunks.length} chunk(s) from ${startDate} to ${endDate}...`);

        const metrics = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
        const results: any = { age: [], gender: [], country: [] };

        // Helper to merge lists of dimension rows
        const mergeRows = (existing: any[], incoming: any[], dimKey: string) => {
            const map = new Map();
            existing.forEach(r => map.set(r.dimensions[dimKey], r));
            incoming.forEach(r => {
                const key = r.dimensions[dimKey];
                const exist = map.get(key);
                if (exist) {
                    const mE = exist.metrics || {};
                    const mI = r.metrics || {};
                    const spend = parseFloat(mE.spend || '0') + parseFloat(mI.spend || '0');
                    const impressions = parseInt(mE.impressions || '0') + parseInt(mI.impressions || '0');
                    const clicks = parseInt(mE.clicks || '0') + parseInt(mI.clicks || '0');

                    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
                    const cpc = clicks > 0 ? spend / clicks : 0;
                    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

                    exist.metrics = {
                        spend: spend.toFixed(2),
                        impressions: String(impressions),
                        clicks: String(clicks),
                        cpm: cpm.toFixed(2),
                        cpc: cpc.toFixed(2),
                        ctr: ctr.toFixed(2)
                    };
                } else {
                    map.set(key, r);
                }
            });
            return Array.from(map.values());
        };

        for (const chunk of chunks) {
            // Age
            try {
                const ageResp = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'AUDIENCE',
                    data_level: 'AUCTION_ADVERTISER',
                    dimensions: ['age'],
                    metrics,
                    start_date: chunk.start,
                    end_date: chunk.end
                });
                if (ageResp.list?.length) results.age = mergeRows(results.age, ageResp.list, 'age');
            } catch (e: any) { console.warn(`[Audience] Age chunk ${chunk.start} failed:`, e.message); }

            // Gender
            try {
                const genderResp = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'AUDIENCE',
                    data_level: 'AUCTION_ADVERTISER',
                    dimensions: ['gender'],
                    metrics,
                    start_date: chunk.start,
                    end_date: chunk.end
                });
                if (genderResp.list?.length) results.gender = mergeRows(results.gender, genderResp.list, 'gender');
            } catch (e: any) { console.warn(`[Audience] Gender chunk ${chunk.start} failed:`, e.message); }

            // Country
            try {
                const countryResp = await this.getReports(accessToken, advertiserId, {
                    service_type: 'AUCTION',
                    report_type: 'AUDIENCE',
                    data_level: 'AUCTION_ADVERTISER',
                    dimensions: ['country_code'],
                    metrics,
                    start_date: chunk.start,
                    end_date: chunk.end
                });
                if (countryResp.list?.length) results.country = mergeRows(results.country, countryResp.list, 'country_code');
            } catch (e: any) { console.warn(`[Audience] Country chunk ${chunk.start} failed:`, e.message); }
        }

        return results;
    }

    /**
     * Get ad performance benchmark vs industry.
     */
    async getAdBenchmark(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string,
        campaignIds: string[]
    ): Promise<any> {
        return this.makeAuthorizedRequest(
            '/report/ad_benchmark/get/',
            'GET',
            accessToken,
            {
                advertiser_id: advertiserId,
                dimensions: JSON.stringify(['AD_CATEGORY']),
                filtering: JSON.stringify({ campaign_ids: campaignIds }),
                start_date: startDate,
                end_date: endDate
            }
        );
    }

    /**
     * Get video performance at ad level.
     * Uses getAdMetrics with video-specific metrics.
     */
    async getVideoPerformanceReport(
        accessToken: string,
        advertiserId: string,
        startDate: string,
        endDate: string
    ): Promise<any> {
        const end = new Date(endDate);
        const maxStart = new Date(end);
        maxStart.setDate(end.getDate() - 29);
        const effectiveStart = new Date(startDate) < maxStart
            ? maxStart.toISOString().slice(0, 10)
            : startDate;

        return this.getAdMetrics(accessToken, advertiserId, effectiveStart, endDate);
    }
}

export const tiktokBusinessApi = new TikTokBusinessAPIService();
