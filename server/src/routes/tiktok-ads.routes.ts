/**
 * TikTok Business API Routes
 * Handles ad campaigns, metrics, and spend tracking
 */

import express from 'express';
import { tiktokBusinessApi } from '../services/tiktok-business-api.service.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// Helper to handle API errors
const handleApiError = (res: express.Response, error: any) => {
    console.error('[TikTok Ads API Error]:', error);
    res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
    });
};

/**
 * POST /api/tiktok-ads/auth/start
 * Generate authorization URL for user to connect TikTok Ads account
 */
router.post('/auth/start', async (req, res) => {
    try {
        const { accountId, returnUrl } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        // Validate TikTok Business credentials are configured
        if (!process.env.TIKTOK_BUSINESS_APP_ID || !process.env.TIKTOK_BUSINESS_SECRET) {
            console.error('[TikTok Ads] Missing credentials: TIKTOK_BUSINESS_APP_ID or TIKTOK_BUSINESS_SECRET not set in environment');
            return res.status(500).json({
                success: false,
                error: 'TikTok Ads integration is not configured. Please contact support.'
            });
        }

        const redirectUri = process.env.TIKTOK_BUSINESS_REDIRECT_URI ||
            `${process.env.FRONTEND_URL}/auth/tiktok-ads/callback`;

        console.log('[TikTok Ads] Generating auth URL with redirect:', redirectUri);

        // Pass returnUrl to the auth URL generator so it's preserved in state
        const authUrl = tiktokBusinessApi.getAuthorizationUrl(accountId, redirectUri, returnUrl);

        res.json({ success: true, authUrl });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/auth/callback
 * Handle OAuth callback from TikTok
 */
router.get('/auth/callback', async (req, res) => {
    try {
        const { auth_code, code, state } = req.query;

        // TikTok sends both 'auth_code' and 'code' params, use whichever is available
        const authCode = auth_code || code;

        if (!authCode || !state) {
            console.error('[TikTok Ads Callback] Missing parameters:', { auth_code, code, state });
            return res.status(400).json({
                success: false,
                error: 'Missing auth_code/code or state parameter'
            });
        }

        console.log('[TikTok Ads Callback] Received:', { authCode, state });

        // Decode state to get accountId and returnUrl
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        const { accountId, returnUrl } = stateData;

        console.log('[TikTok Ads Callback] Account ID:', accountId, 'Return URL:', returnUrl);

        // Exchange auth code for access token
        console.log('[TikTok Ads Callback] Exchanging auth code for access token...');
        const tokenData = await tiktokBusinessApi.getAccessToken(authCode as string);

        console.log('[TikTok Ads Callback] Token data received:', JSON.stringify(tokenData, null, 2));

        // Step 4: Verify granted scopes
        // TikTok sometimes returns an array of integer IDs instead of string names (e.g. [1, 2, 3, 4])
        let grantedScopes = '';
        if (Array.isArray(tokenData.scope)) {
            grantedScopes = JSON.stringify(tokenData.scope);
            console.log('[TikTok Ads Callback] ✅ Granted scopes (Array of IDs):', grantedScopes);
            console.log('[TikTok Ads Callback] Treating all scopes as implicitly granted since format is numeric.');
        } else {
            grantedScopes = tokenData.scope || '';
            console.log('[TikTok Ads Callback] ✅ Granted scopes (String format):', grantedScopes);

            const requiredScopes = ['advertiser.gmv_max', 'advertiser.report'];
            const missingScopes = requiredScopes.filter(s => !grantedScopes.includes(s));
            if (missingScopes.length > 0) {
                console.warn(`[TikTok Ads Callback] ⚠️ MISSING CRITICAL SCOPES: ${missingScopes.join(', ')}`);
                console.warn('[TikTok Ads Callback] GMV Max and Reporting data may not be accessible!');
            }
        }

        // Check if we have advertiser IDs
        if (!tokenData.advertiser_ids || tokenData.advertiser_ids.length === 0) {
            throw new Error('No advertiser IDs returned from TikTok. The access token was obtained but no advertiser accounts were found.');
        }

        const advertiserId = tokenData.advertiser_ids[0];
        console.log('[TikTok Ads Callback] Using advertiser ID:', advertiserId);

        // Fetch advertiser details (name, currency, balance) from TikTok API
        let advertiserName = `Advertiser ${advertiserId}`;
        let currency = 'USD';
        let balance = 0;
        try {
            const advInfo = await tiktokBusinessApi.getAdvertiserInfo(tokenData.access_token, advertiserId);
            if (advInfo?.list?.[0]) {
                const info = advInfo.list[0];
                advertiserName = info.name || advertiserName;
                currency = info.currency || currency;
                balance = parseFloat(info.balance) || 0;
                console.log('[TikTok Ads Callback] Advertiser info:', { advertiserName, currency, balance });
            }
        } catch (infoErr: any) {
            console.warn('[TikTok Ads Callback] Could not fetch advertiser info:', infoErr.message);
        }

        // Store advertiser in database (include granted scopes)
        const { data: advertiser, error } = await supabase
            .from('tiktok_advertisers')
            .upsert({
                account_id: accountId,
                advertiser_id: advertiserId,
                advertiser_name: advertiserName,
                app_id: process.env.TIKTOK_BUSINESS_APP_ID,
                access_token: tokenData.access_token,
                granted_scopes: grantedScopes,
                currency,
                balance,
                is_active: true,
                last_synced_at: new Date().toISOString()
            }, { onConflict: 'account_id, advertiser_id' })
            .select()
            .single();

        if (error) {
            console.error('[TikTok Ads Callback] Database error:', error);
            throw error;
        }

        console.log('[TikTok Ads Callback] Success! Redirecting to frontend...');

        // Redirect back to the page the user came from (or dashboard as fallback)
        const finalReturnUrl = returnUrl || '/dashboard';
        const redirectUrl = `${process.env.FRONTEND_URL}${finalReturnUrl}?tiktok_ads_connected=true`;
        res.redirect(redirectUrl);
    } catch (error: any) {
        console.error('[TikTok Ads Callback] Error:', error);

        // Get returnUrl from state if available (for error redirect)
        let finalReturnUrl = '/dashboard';
        try {
            const { state } = req.query;
            if (state) {
                const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
                finalReturnUrl = stateData.returnUrl || '/dashboard';
            }
        } catch (e) {
            // If state parsing fails, use default
        }

        // Instead of just JSON error, redirect to frontend with error
        const errorMessage = encodeURIComponent(error.message || 'Failed to connect TikTok Ads account');
        const redirectUrl = `${process.env.FRONTEND_URL}${finalReturnUrl}?tiktok_ads_error=${errorMessage}`;
        res.redirect(redirectUrl);
    }
});

/**
 * DELETE /api/tiktok-ads/disconnect/:accountId
 * Deletes the TikTok Ads connection for a specific Mamba account.
 * This drops the advertiser record, which cascades to delete all linked campaign/ad/metrics data.
 */
router.delete('/disconnect/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Delete from tiktok_advertisers
        // (Assumes ON DELETE CASCADE is set for child tables: tiktok_ad_campaigns, tiktok_ad_groups, tiktok_ads, tiktok_ad_metrics)
        const { error } = await supabase
            .from('tiktok_advertisers')
            .delete()
            .eq('account_id', accountId);

        if (error) {
            console.error('[TikTok Ads Disconnect] Failed to delete advertiser data:', error);
            throw error;
        }

        res.json({ success: true, message: 'Ads data completely purged' });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/status/:accountId
 * Get connection status and advertiser info
 */
router.get('/status/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        const { data: advertiser } = await supabase
            .from('tiktok_advertisers')
            .select('*')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!advertiser) {
            return res.json({ success: true, connected: false });
        }

        res.json({
            success: true,
            connected: true,
            advertiser: {
                id: advertiser.id,
                advertiser_id: advertiser.advertiser_id,
                name: advertiser.advertiser_name,
                currency: advertiser.currency,
                balance: advertiser.balance,
                last_synced: advertiser.last_synced_at,
                granted_scopes: advertiser.granted_scopes || ''
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/advertisers/:accountId
 * List all available TikTok advertiser accounts for this user's access token
 */
router.get('/advertisers/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Get stored advertiser to retrieve access token
        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('*')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'No connected advertiser found' });
        }

        // Fetch all advertiser IDs from TikTok
        const advertiserList = await tiktokBusinessApi.getAdvertisers(advertiser.access_token);
        const allIds = advertiserList.map((item: any) => String(item.advertiser_id || item));

        if (allIds.length === 0) {
            return res.json({ success: true, advertisers: [] });
        }

        // Fetch detailed info for all advertisers in one call
        const infoResponse = await tiktokBusinessApi.getAdvertiserInfo(advertiser.access_token, allIds);
        const infoList = infoResponse?.list || [];

        const advertisers = infoList.map((adv: any) => ({
            advertiser_id: String(adv.advertiser_id),
            name: adv.name || `Advertiser ${adv.advertiser_id}`,
            currency: adv.currency || 'USD',
            balance: parseFloat(adv.balance) || 0,
            status: adv.status || 'UNKNOWN',
            timezone: adv.timezone || 'UTC',
            create_time: adv.create_time || null,
            is_current: String(adv.advertiser_id) === advertiser.advertiser_id
        }));

        res.json({ success: true, advertisers });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * POST /api/tiktok-ads/switch-advertiser/:accountId
 * Switch to a different advertiser ID (same access token)
 */
router.post('/switch-advertiser/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { advertiserId: newAdvertiserId } = req.body;

        if (!newAdvertiserId) {
            return res.status(400).json({ success: false, error: 'advertiserId is required' });
        }

        // Get current advertiser record
        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('*')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'No connected advertiser found' });
        }

        // Already on this advertiser
        if (advertiser.advertiser_id === String(newAdvertiserId)) {
            return res.json({ success: true, message: 'Already using this advertiser', changed: false });
        }

        // Validate the new ID is available under this token
        const advertiserList = await tiktokBusinessApi.getAdvertisers(advertiser.access_token);
        const availableIds = advertiserList.map((item: any) => String(item.advertiser_id || item));

        if (!availableIds.includes(String(newAdvertiserId))) {
            return res.status(400).json({ success: false, error: 'Advertiser ID is not available for this account' });
        }

        // Fetch info for the new advertiser
        const infoResponse = await tiktokBusinessApi.getAdvertiserInfo(advertiser.access_token, String(newAdvertiserId));
        const newInfo = infoResponse?.list?.[0] || {};

        // Delete all child data for the current advertiser (UUID primary key)
        const advUuid = advertiser.id;
        console.log(`[TikTok Ads] Switching advertiser for account ${accountId}: ${advertiser.advertiser_id} -> ${newAdvertiserId}`);
        console.log(`[TikTok Ads] Clearing child data for advertiser UUID: ${advUuid}`);

        await supabase.from('tiktok_ad_metrics').delete().eq('advertiser_id', advUuid);
        await supabase.from('tiktok_ad_spend_daily').delete().eq('advertiser_id', advUuid);
        await supabase.from('tiktok_ads').delete().eq('advertiser_id', advUuid);
        await supabase.from('tiktok_ad_groups').delete().eq('advertiser_id', advUuid);
        await supabase.from('tiktok_ad_campaigns').delete().eq('advertiser_id', advUuid);

        // Update the advertiser row with new details
        const { data: updated, error: updateError } = await supabase
            .from('tiktok_advertisers')
            .update({
                advertiser_id: String(newAdvertiserId),
                advertiser_name: newInfo.name || `Advertiser ${newAdvertiserId}`,
                currency: newInfo.currency || 'USD',
                balance: parseFloat(newInfo.balance) || 0,
                last_synced_at: null
            })
            .eq('id', advUuid)
            .select()
            .single();

        if (updateError) {
            console.error('[TikTok Ads] Switch update error:', updateError);
            throw updateError;
        }

        console.log(`[TikTok Ads] Successfully switched to advertiser: ${newAdvertiserId} (${newInfo.name})`);

        res.json({
            success: true,
            changed: true,
            advertiser: {
                id: updated.id,
                advertiser_id: updated.advertiser_id,
                advertiser_name: updated.advertiser_name,
                currency: updated.currency,
                balance: updated.balance,
                last_synced: updated.last_synced_at
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * POST /api/tiktok-ads/sync/:accountId
 * Sync ad campaigns, ad groups, ads, and metrics
 */
router.post('/sync/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.body;

        // Get advertiser
        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('*')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        const { access_token, advertiser_id, id: advertiserId } = advertiser;

        console.log(`[Ads Sync] Starting sync for advertiser ${advertiser_id}...`);

        // Diagnostic: log ALL advertiser IDs available under this access token
        // This helps identify if GMV Max campaigns are under a different advertiser ID
        try {
            const allAdvertisers = await tiktokBusinessApi.getAdvertisers(access_token);
            console.log(`[Ads Sync] All advertiser IDs available under this token:`);
            allAdvertisers.forEach((a: any) => {
                const id = a.advertiser_id || a;
                const name = a.advertiser_name || a.name || '(no name)';
                const isCurrent = String(id) === String(advertiser_id);
                console.log(`  ${isCurrent ? '→ CURRENT' : '         '} ${id}  ${name}`);
            });
        } catch (e: any) {
            console.warn(`[Ads Sync] Could not list advertiser IDs:`, e.message);
        }

        // Refresh advertiser info (name, currency, balance) on each sync
        try {
            const advInfo = await tiktokBusinessApi.getAdvertiserInfo(access_token, advertiser_id);
            if (advInfo?.list?.[0]) {
                const info = advInfo.list[0];
                const updates: Record<string, any> = {};
                if (info.name) updates.advertiser_name = info.name;
                if (info.currency) updates.currency = info.currency;
                if (info.balance != null) updates.balance = parseFloat(info.balance) || 0;
                if (Object.keys(updates).length > 0) {
                    await supabase.from('tiktok_advertisers').update(updates).eq('id', advertiserId);
                    console.log(`[Ads Sync] Updated advertiser info:`, updates);
                }
            }
        } catch (infoErr: any) {
            console.warn(`[Ads Sync] Could not refresh advertiser info:`, infoErr.message);
        }

        // 1. Sync Campaigns (fetch all pages)
        let allCampaigns: any[] = [];
        let campaignPage = 1;
        while (true) {
            const campaigns = await tiktokBusinessApi.getCampaigns(access_token, advertiser_id, { page: campaignPage, page_size: 100 });
            allCampaigns = allCampaigns.concat(campaigns.list || []);
            console.log(`[Ads Sync] Campaigns page ${campaignPage}: ${campaigns.list?.length || 0} items (total so far: ${allCampaigns.length})`);
            if (!campaigns.page_info || campaignPage >= campaigns.page_info.total_page) break;
            campaignPage++;
        }
        console.log(`[Ads Sync] Found ${allCampaigns.length} campaigns total`);

        // Log campaign status distribution (compact summary instead of per-campaign logging)
        const campaignStatusCounts: Record<string, number> = {};
        allCampaigns.forEach((c: any) => {
            const s = c.secondary_status || c.operation_status || 'UNKNOWN';
            campaignStatusCounts[s] = (campaignStatusCounts[s] || 0) + 1;
        });
        console.log(`[Ads Sync] Campaign status distribution:`, campaignStatusCounts);

        for (const campaign of allCampaigns) {
            // Prefer secondary_status (more descriptive, e.g. CAMPAIGN_STATUS_ENABLE)
            // Fall back to operation_status (simple ENABLE/DISABLE)
            await supabase.from('tiktok_ad_campaigns').upsert({
                advertiser_id: advertiserId,
                campaign_id: campaign.campaign_id,
                campaign_name: campaign.campaign_name,
                objective_type: campaign.objective_type,
                status: campaign.secondary_status || campaign.operation_status || 'UNKNOWN',
                budget: campaign.budget,
                budget_mode: campaign.budget_mode,
                raw_data: campaign,
                last_synced_at: new Date().toISOString()
            });
        }



        // 2. Sync Ad Groups (all pages, parallel upserts)
        let allAdGroups: any[] = [];
        try {
            let adGroupPage = 1;
            while (true) {
                const adGroups = await tiktokBusinessApi.getAdGroups(access_token, advertiser_id, { page: adGroupPage, page_size: 100 });
                allAdGroups = allAdGroups.concat(adGroups.list || []);
                if (!adGroups.page_info || adGroupPage >= adGroups.page_info.total_page) break;
                adGroupPage++;
            }
            console.log(`[Ads Sync] Found ${allAdGroups.length} ad groups — upserting...`);

            // Build a campaign_id → UUID map to avoid N+1 DB lookups
            const { data: campaignRows } = await supabase
                .from('tiktok_ad_campaigns')
                .select('id, campaign_id')
                .eq('advertiser_id', advertiserId);
            const campaignMap = new Map((campaignRows || []).map((c: any) => [c.campaign_id, c.id]));

            const adGroupRecords = allAdGroups
                .filter(ag => campaignMap.has(ag.campaign_id))
                .map(ag => ({
                    advertiser_id: advertiserId,
                    campaign_id: campaignMap.get(ag.campaign_id),
                    adgroup_id: ag.adgroup_id,
                    adgroup_name: ag.adgroup_name,
                    status: ag.secondary_status || ag.operation_status || 'UNKNOWN',
                    budget: ag.budget,
                    budget_mode: ag.budget_mode,
                    bid_type: ag.bid_type,
                    bid_price: ag.bid_price,
                    optimization_goal: ag.optimization_goal,
                    raw_data: ag,
                    last_synced_at: new Date().toISOString()
                }));

            for (let i = 0; i < adGroupRecords.length; i += 1000) {
                const batch = adGroupRecords.slice(i, i + 1000);
                const { error } = await supabase.from('tiktok_ad_groups').upsert(batch, { onConflict: 'adgroup_id' });
                if (error) console.error('[Ads Sync] Ad Group batch upsert error:', error);
            }

            const adGroupStatusCounts: Record<string, number> = {};
            allAdGroups.forEach((ag: any) => {
                const s = ag.secondary_status || ag.operation_status || 'UNKNOWN';
                adGroupStatusCounts[s] = (adGroupStatusCounts[s] || 0) + 1;
            });
            console.log(`[Ads Sync] Ad Groups upserted. Status distribution:`, adGroupStatusCounts);
        } catch (e: any) {
            console.error(`[Ads Sync] Ad Group sync failed:`, e.message);
        }


        // 3. Sync Ads (all pages, parallel upserts)
        let allAds: any[] = [];
        try {
            let adPage = 1;
            while (true) {
                const ads = await tiktokBusinessApi.getAds(access_token, advertiser_id, { page: adPage, page_size: 100 });
                allAds = allAds.concat(ads.list || []);
                if (!ads.page_info || adPage >= ads.page_info.total_page) break;
                adPage++;
            }
            console.log(`[Ads Sync] Found ${allAds.length} ads — upserting...`);

            // Build adgroup_id → UUID map to avoid N+1 DB lookups
            const { data: adGroupRows } = await supabase
                .from('tiktok_ad_groups')
                .select('id, adgroup_id')
                .eq('advertiser_id', advertiserId);
            const adGroupMap = new Map((adGroupRows || []).map((ag: any) => [ag.adgroup_id, ag.id]));

            const adRecords = allAds
                .filter(ad => adGroupMap.has(ad.adgroup_id))
                .map(ad => ({
                    advertiser_id: advertiserId,
                    adgroup_id: adGroupMap.get(ad.adgroup_id),
                    ad_id: ad.ad_id,
                    ad_name: ad.ad_name,
                    ad_format: ad.ad_format,
                    ad_text: ad.ad_text,
                    call_to_action: ad.call_to_action,
                    landing_page_url: ad.landing_page_url,
                    video_id: ad.video_id,
                    image_ids: ad.image_ids,
                    status: ad.secondary_status || ad.operation_status || 'UNKNOWN',
                    raw_data: ad,
                    last_synced_at: new Date().toISOString()
                }));

            for (let i = 0; i < adRecords.length; i += 1000) {
                const batch = adRecords.slice(i, i + 1000);
                const { error } = await supabase.from('tiktok_ads').upsert(batch, { onConflict: 'ad_id' });
                if (error) console.error('[Ads Sync] Ads batch upsert error:', error);
            }

            const adStatusCounts: Record<string, number> = {};
            allAds.forEach((a: any) => {
                const s = a.secondary_status || a.operation_status || 'UNKNOWN';
                adStatusCounts[s] = (adStatusCounts[s] || 0) + 1;
            });
            console.log(`[Ads Sync] Ads upserted. Status distribution:`, adStatusCounts);
        } catch (e: any) {
            console.error(`[Ads Sync] Ads sync failed:`, e.message);
        }

        // 4. Sync Metrics (or requested range)
        // Default to 30 days of history for ALL data types to avoid excessive API calls and long sync times.
        const syncEndDate = endDate ? new Date(endDate) : new Date();
        const syncStartDate = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default to 90 days ago

        console.log(`[Ads Sync] Starting Unified Sync from ${syncStartDate.toISOString().split('T')[0]} to ${syncEndDate.toISOString().split('T')[0]}...`);

        // Fetch store IDs for GMV Max syncing
        const { data: shops } = await supabase.from('tiktok_shops').select('shop_id').eq('account_id', accountId);
        const storeIds: string[] = (shops || []).map((s: any) => s.shop_id).filter(Boolean);

        const fullAdMetrics: any[] = [];
        const fullCampaignMetrics: any[] = [];
        const fullDailySpend: any[] = [];
        const fullGmvSpend: any[] = [];

        let currentChunkStart = new Date(syncStartDate);

        while (currentChunkStart <= syncEndDate) {
            let currentChunkEnd = new Date(currentChunkStart);
            currentChunkEnd.setDate(currentChunkEnd.getDate() + 29); // 30 day window
            if (currentChunkEnd > syncEndDate) currentChunkEnd = syncEndDate;

            const sDate = currentChunkStart.toISOString().split('T')[0];
            const eDate = currentChunkEnd.toISOString().split('T')[0];

            console.log(`[Ads Sync] Fetching chunk: ${sDate} to ${eDate}`);

            try {
                // Fetch all 4 types in parallel for this time chunk
                const [chunkAdMetrics, chunkCampaignMetrics, chunkDailySpend, chunkGmvSpend] = await Promise.all([
                    tiktokBusinessApi.getAdMetrics(
                        access_token,
                        advertiser_id,
                        sDate,
                        eDate,
                        undefined
                    ).catch(e => {
                        console.error(`[Ads Sync] Error fetching ad metrics for ${sDate}:`, e.message);
                        return [];
                    }),
                    tiktokBusinessApi.getCampaignMetrics(
                        access_token,
                        advertiser_id,
                        sDate,
                        eDate
                    ).catch(e => {
                        console.error(`[Ads Sync] Error fetching campaign metrics for ${sDate}:`, e.message);
                        return [];
                    }),
                    tiktokBusinessApi.getConsolidatedOverview(
                        access_token,
                        advertiser_id,
                        sDate,
                        eDate
                    )
                        .then(res => res.list || [])
                        .catch(e => {
                            console.error(`[Ads Sync] Error fetching daily spend for ${sDate}:`, e.message);
                            return [];
                        }),
                    storeIds.length > 0
                        ? tiktokBusinessApi.getGmvMaxReport(
                            access_token,
                            advertiser_id,
                            sDate,
                            eDate,
                            storeIds
                        ).then(res => res.list || []).catch(e => {
                            console.error(`[Ads Sync] Error fetching GMV Max for ${sDate}:`, e.message);
                            return [];
                        })
                        : Promise.resolve([])
                ]);

                if (chunkAdMetrics?.length) fullAdMetrics.push(...chunkAdMetrics);
                if (chunkCampaignMetrics?.length) fullCampaignMetrics.push(...chunkCampaignMetrics);
                if (chunkDailySpend?.length) fullDailySpend.push(...chunkDailySpend);
                if (chunkGmvSpend?.length) fullGmvSpend.push(...chunkGmvSpend);

                console.log(`[Ads Sync] Chunk results: ${chunkAdMetrics?.length || 0} ads, ${chunkCampaignMetrics?.length || 0} campaigns, ${chunkDailySpend?.length || 0} spend, ${chunkGmvSpend?.length || 0} GMV`);

            } catch (err: any) {
                console.error(`[Ads Sync] Critical error in chunk ${sDate}-${eDate}:`, err.message);
            }

            // Move to next day
            currentChunkStart.setDate(currentChunkStart.getDate() + 30);
        }

        // Process Daily Spend
        console.log(`[Ads Sync] Total daily spend records: ${fullDailySpend.length}, GMV Max records: ${fullGmvSpend.length}`);

        // Merge GMV Max into Daily Spend
        const spendMap = new Map<string, any>();

        fullDailySpend.forEach(day => {
            const dateStr = day.dimensions?.stat_time_day;
            if (dateStr) spendMap.set(dateStr, day);
        });

        fullGmvSpend.forEach(gmvDay => {
            const dateStr = gmvDay.dimensions?.stat_time_day || gmvDay.metrics?.stat_time_day;
            if (!dateStr) return;

            const gm = gmvDay.metrics || {};
            const costToAdd = parseFloat(gm.cost || gm.spend || '0');
            const ordersToAdd = parseInt(gm.orders || gm.complete_payment || '0');
            const roiVal = parseFloat(gm.roi || '0');
            const conversionValueToAdd = costToAdd * roiVal;

            const existing = spendMap.get(dateStr);
            if (existing) {
                if (!existing._gmvFlag) {
                    existing._gmvFlag = true;
                    const m = existing.metrics || {};
                    existing.metrics = {
                        ...m,
                        spend: parseFloat(m.spend || m.cost || '0'),
                        cost: parseFloat(m.cost || m.spend || '0'),
                        complete_payment: parseInt(m.complete_payment || '0'),
                        impressions: parseInt(m.impressions || '0'),
                        clicks: parseInt(m.clicks || '0'),
                        _gmv_revenue: 0
                    };
                }

                existing.metrics.spend += costToAdd;
                existing.metrics.cost += costToAdd;
                existing.metrics.complete_payment += ordersToAdd;
                existing.metrics.impressions += parseInt(gm.impressions || '0');
                existing.metrics.clicks += parseInt(gm.clicks || '0');
                existing.metrics._gmv_revenue += conversionValueToAdd;

                if (existing.metrics.spend > 0) {
                    existing.metrics.roi = String(existing.metrics._gmv_revenue / existing.metrics.spend);
                }
            } else {
                spendMap.set(dateStr, {
                    dimensions: { stat_time_day: dateStr },
                    metrics: {
                        spend: costToAdd,
                        cost: costToAdd,
                        complete_payment: ordersToAdd,
                        roi: roiVal ? String(roiVal) : '0',
                        _gmv_revenue: conversionValueToAdd
                    },
                    _gmvFlag: true
                });
            }
        });

        const mergedDailySpend = Array.from(spendMap.values());

        if (mergedDailySpend.length > 0) {
            const spendRecords = mergedDailySpend.map(day => {
                const dimensions = day.dimensions || {};
                const metrics = day.metrics || {};
                const statDate = dimensions.stat_time_day || metrics.stat_time_day;

                const spend = parseFloat(String(metrics.spend || metrics.cost || '0'));
                const conversionVal = metrics._gmv_revenue !== undefined
                    ? metrics._gmv_revenue
                    : metrics.roi
                        ? spend * parseFloat(metrics.roi || '0')
                        : parseFloat(metrics.value_per_complete_payment || '0') * parseInt(metrics.complete_payment || '0');

                return {
                    advertiser_id: advertiserId,
                    account_id: accountId,
                    spend_date: statDate,
                    total_spend: spend,
                    total_impressions: parseInt(metrics.impressions || '0'),
                    total_clicks: parseInt(metrics.clicks || '0'),
                    total_conversions: parseInt(metrics.complete_payment || metrics.orders || '0'),
                    conversion_value: conversionVal,
                    currency: advertiser.currency
                };
            });

            // Upsert in batches of 1000 to be safe
            for (let i = 0; i < spendRecords.length; i += 1000) {
                const batch = spendRecords.slice(i, i + 1000);
                const { error } = await supabase
                    .from('tiktok_ad_spend_daily')
                    .upsert(batch, { onConflict: 'advertiser_id, spend_date' });

                if (error) console.error('[Ads Sync] Error upserting daily spend batch:', error);
            }
            console.log(`[Ads Sync] Upserted ${spendRecords.length} daily spend records`);

            // NEW: Upsert same data into tiktok_ad_metrics under ADVERTISER dimension 
            // This ensures pure top-level data (including Reach, Video, and GMV Max) is safely queryable for the Dashboard.
            const advertiserMetricsRecords = mergedDailySpend.map(day => {
                const dimensions = day.dimensions || {};
                const metrics = day.metrics || {};
                const statDate = dimensions.stat_time_day || metrics.stat_time_day;

                // Derive pure GMV revenue if native values are missing
                const spend = parseFloat(String(metrics.spend || metrics.cost || '0'));
                const conversionVal = metrics._gmv_revenue !== undefined
                    ? metrics._gmv_revenue
                    : metrics.roi
                        ? spend * parseFloat(metrics.roi || '0')
                        : parseFloat(metrics.value_per_complete_payment || '0') * parseInt(metrics.complete_payment || '0');

                return {
                    advertiser_id: advertiserId,
                    dimension_type: 'ADVERTISER',
                    dimension_id: advertiserId, // The advertiser IS the dimension
                    stat_date: statDate,
                    stat_datetime: new Date(statDate).toISOString(),
                    impressions: parseInt(metrics.impressions || '0'),
                    clicks: parseInt(metrics.clicks || '0'),
                    reach: parseInt(metrics.reach || '0'),
                    frequency: parseFloat(metrics.frequency || '0'),
                    likes: parseInt(metrics.likes || '0'),
                    comments: parseInt(metrics.comments || '0'),
                    shares: parseInt(metrics.shares || '0'),
                    follows: parseInt(metrics.follows || '0'),
                    profile_visits: parseInt(metrics.profile_visits || '0'),
                    video_views: parseInt(metrics.video_play_actions || '0'),
                    video_watched_2s: parseInt(metrics.engaged_view || metrics.video_watched_2s || '0'),
                    video_watched_6s: parseInt(metrics.video_watched_6s || '0'),
                    video_views_p25: parseInt(metrics.video_views_p25 || '0'),
                    video_views_p50: parseInt(metrics.video_views_p50 || '0'),
                    video_views_p75: parseInt(metrics.video_views_p75 || '0'),
                    video_views_p100: parseInt(metrics.video_views_p100 || '0'),
                    spend: spend,
                    cpc: parseFloat(metrics.cpc || '0'),
                    cpm: parseFloat(metrics.cpm || '0'),
                    conversions: parseInt(metrics.complete_payment || metrics.orders || '0'),
                    conversion_rate: parseFloat(metrics.complete_payment_rate || '0'),
                    cost_per_conversion: parseFloat(metrics.cost_per_complete_payment || '0'),
                    conversion_value: conversionVal,
                    ctr: parseFloat(metrics.ctr || '0'),
                    currency: advertiser.currency
                };
            });

            for (let i = 0; i < advertiserMetricsRecords.length; i += 1000) {
                const batch = advertiserMetricsRecords.slice(i, i + 1000);
                const { error } = await supabase
                    .from('tiktok_ad_metrics')
                    .upsert(batch, { onConflict: 'advertiser_id, dimension_type, dimension_id, stat_date' });

                if (error) {
                    // If profile_visits column doesn't exist yet, retry without it
                    if (error.message?.includes('profile_visits')) {
                        console.warn('[Ads Sync] profile_visits column missing — retrying ADVERTISER batch without it...');
                        const cleanBatch = batch.map(({ profile_visits, ...rest }: any) => rest);
                        const { error: retryErr } = await supabase
                            .from('tiktok_ad_metrics')
                            .upsert(cleanBatch, { onConflict: 'advertiser_id, dimension_type, dimension_id, stat_date' });
                        if (retryErr) console.error('[Ads Sync] Retry ADVERTISER upsert also failed:', retryErr);
                    } else {
                        console.error('[Ads Sync] Error upserting ADVERTISER metrics batch:', error);
                    }
                }
            }
            console.log(`[Ads Sync] Upserted ${advertiserMetricsRecords.length} ADVERTISER metric records`);
        }

        // Process Campaign Metrics
        console.log(`[Ads Sync] Total campaign metrics records: ${fullCampaignMetrics.length}`);

        if (fullCampaignMetrics.length > 0) {
            // Create a map of campaign_id -> id to avoid individual DB lookups
            const campaignIds = [...new Set(fullCampaignMetrics.map(m => m.dimensions.campaign_id))];
            const { data: campaigns } = await supabase
                .from('tiktok_ad_campaigns')
                .select('id, campaign_id')
                .in('campaign_id', campaignIds);

            const campaignMap = new Map();
            if (campaigns) {
                campaigns.forEach(c => campaignMap.set(c.campaign_id, c.id));
            }

            const campaignMetricsRecords = [];
            for (const metric of fullCampaignMetrics) {
                const dimensions = metric.dimensions;
                const metricsData = metric.metrics;
                const internalId = campaignMap.get(dimensions.campaign_id);

                if (internalId) {
                    campaignMetricsRecords.push({
                        advertiser_id: advertiserId,
                        dimension_type: 'CAMPAIGN',
                        dimension_id: internalId,
                        stat_date: dimensions.stat_time_day,
                        stat_datetime: new Date(dimensions.stat_time_day).toISOString(),
                        impressions: parseInt(metricsData.impressions || '0'),
                        clicks: parseInt(metricsData.clicks || '0'),
                        reach: parseInt(metricsData.reach || '0'),
                        frequency: parseFloat(metricsData.frequency || '0'),
                        likes: parseInt(metricsData.likes || '0'),
                        comments: parseInt(metricsData.comments || '0'),
                        shares: parseInt(metricsData.shares || '0'),
                        follows: parseInt(metricsData.follows || '0'),
                        profile_visits: parseInt(metricsData.profile_visits || '0'),
                        video_views: parseInt(metricsData.video_play_actions || '0'),
                        video_watched_2s: parseInt(metricsData.engaged_view || '0'),
                        video_watched_6s: parseInt(metricsData.video_watched_6s || '0'),
                        video_views_p25: parseInt(metricsData.video_views_p25 || '0'),
                        video_views_p50: parseInt(metricsData.video_views_p50 || '0'),
                        video_views_p75: parseInt(metricsData.video_views_p75 || '0'),
                        video_views_p100: parseInt(metricsData.video_views_p100 || '0'),
                        spend: parseFloat(metricsData.spend || '0'),
                        cpc: parseFloat(metricsData.cpc || '0'),
                        cpm: parseFloat(metricsData.cpm || '0'),
                        conversions: parseInt(metricsData.complete_payment || '0'),
                        conversion_rate: parseFloat(metricsData.complete_payment_rate || '0'),
                        cost_per_conversion: parseFloat(metricsData.cost_per_complete_payment || '0'),
                        conversion_value: parseFloat(metricsData.value_per_complete_payment || '0') * parseInt(metricsData.complete_payment || '0'),
                        ctr: parseFloat(metricsData.ctr || '0'),
                        currency: advertiser.currency
                    });
                }
            }

            // Upsert in batches
            for (let i = 0; i < campaignMetricsRecords.length; i += 1000) {
                const batch = campaignMetricsRecords.slice(i, i + 1000);
                const { error } = await supabase.from('tiktok_ad_metrics').upsert(batch, { onConflict: 'advertiser_id, dimension_type, dimension_id, stat_date' });
                if (error) {
                    // If profile_visits column doesn't exist yet, retry without it
                    if (error.message?.includes('profile_visits')) {
                        console.warn('[Ads Sync] profile_visits column missing — retrying CAMPAIGN batch without it...');
                        const cleanBatch = batch.map(({ profile_visits, ...rest }: any) => rest);
                        const { error: retryErr } = await supabase.from('tiktok_ad_metrics').upsert(cleanBatch, { onConflict: 'advertiser_id, dimension_type, dimension_id, stat_date' });
                        if (retryErr) console.error('[Ads Sync] Retry CAMPAIGN upsert also failed:', retryErr);
                    } else {
                        console.error('[Ads Sync] Error upserting campaign metrics batch:', error);
                    }
                }
            }
            console.log(`[Ads Sync] Upserted ${campaignMetricsRecords.length} campaign metrics records`);
        }

        console.log(`[Ads Sync] Total ad metrics records: ${fullAdMetrics.length}`);

        if (fullAdMetrics.length > 0) {
            // Create a map of ad_id -> id to avoid individual DB lookups
            const adIds = [...new Set(fullAdMetrics.map(m => m.dimensions.ad_id))];

            // Fetch ads in chunks to avoid query length limits if too many ads
            const adMap = new Map();
            for (let i = 0; i < adIds.length; i += 1000) {
                const chunk = adIds.slice(i, i + 1000);
                const { data: ads } = await supabase
                    .from('tiktok_ads')
                    .select('id, ad_id')
                    .in('ad_id', chunk);

                if (ads) {
                    ads.forEach(a => adMap.set(a.ad_id, a.id));
                }
            }

            const adMetricsRecords = [];
            for (const metric of fullAdMetrics) {
                const dimensions = metric.dimensions;
                const metricsData = metric.metrics;
                const internalId = adMap.get(dimensions.ad_id);

                if (internalId) {
                    adMetricsRecords.push({
                        advertiser_id: advertiserId,
                        dimension_type: 'AD',
                        dimension_id: internalId,
                        stat_date: dimensions.stat_time_day,
                        stat_datetime: new Date(dimensions.stat_time_day).toISOString(),
                        // Spend & Cost
                        spend: parseFloat(metricsData.spend || '0'),
                        cpc: parseFloat(metricsData.cpc || '0'),
                        cpm: parseFloat(metricsData.cpm || '0'),
                        cost_per_conversion: parseFloat(metricsData.cost_per_complete_payment || '0'),
                        // Impressions & Reach
                        impressions: parseInt(metricsData.impressions || '0'),
                        reach: parseInt(metricsData.reach || '0'),
                        frequency: parseFloat(metricsData.frequency || '0'),
                        // Engagement
                        clicks: parseInt(metricsData.clicks || '0'),
                        ctr: parseFloat(metricsData.ctr || '0'),
                        likes: parseInt(metricsData.likes || '0'),
                        comments: parseInt(metricsData.comments || '0'),
                        shares: parseInt(metricsData.shares || '0'),
                        follows: parseInt(metricsData.follows || '0'),
                        // Video Performance
                        video_views: parseInt(metricsData.video_play_actions || '0'),
                        video_watched_2s: parseInt(metricsData.engaged_view || '0'),
                        video_watched_6s: parseInt(metricsData.video_watched_6s || '0'),
                        video_views_p25: parseInt(metricsData.video_views_p25 || '0'),
                        video_views_p50: parseInt(metricsData.video_views_p50 || '0'),
                        video_views_p75: parseInt(metricsData.video_views_p75 || '0'),
                        video_views_p100: parseInt(metricsData.video_views_p100 || '0'),
                        // Conversions
                        conversions: parseInt(metricsData.complete_payment || '0'),
                        conversion_rate: parseFloat(metricsData.complete_payment_rate || '0'),
                        conversion_value: parseFloat(metricsData.value_per_complete_payment || '0') * parseInt(metricsData.complete_payment || '0'),
                        currency: advertiser.currency
                    });
                }
            }

            // Upsert in batches
            for (let i = 0; i < adMetricsRecords.length; i += 1000) {
                const batch = adMetricsRecords.slice(i, i + 1000);
                const { error } = await supabase
                    .from('tiktok_ad_metrics')
                    .upsert(batch, { onConflict: 'advertiser_id, dimension_type, dimension_id, stat_date' });

                if (error) console.error('[Ads Sync] Error upserting ad metrics batch:', error);
            }
            console.log(`[Ads Sync] Upserted ${adMetricsRecords.length} ad metrics records`);
        }


        // Update last synced
        await supabase
            .from('tiktok_advertisers')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('id', advertiserId);

        console.log('[Ads Sync] Sync completed successfully');

        // Hydrate GMV Max campaign metadata from already-fetched data (no re-fetch needed)
        if (fullGmvSpend.length > 0) {
            const uniqueGmvCampaignIds = Array.from(new Set(fullGmvSpend.map((r: any) => r.dimensions?.campaign_id).filter(Boolean))) as string[];
            console.log(`[Ads Sync] Found ${uniqueGmvCampaignIds.length} unique GMV Max campaign IDs. Hydrating...`);

            if (uniqueGmvCampaignIds.length > 0) {
                try {
                    const sessions = await tiktokBusinessApi.getGmvMaxSessions(
                        access_token,
                        advertiser_id,
                        uniqueGmvCampaignIds
                    );
                    console.log(`[Ads Sync] Fetched ${sessions.length} GMV Max sessions for hydration`);

                    const campaignUpserts: any[] = [];
                    for (const s of sessions) {
                        const cid = s._campaign_id || s.campaign_id;
                        if (!cid) continue;
                        // Deduplicate by campaign_id — keep first seen
                        if (campaignUpserts.find(c => c.campaign_id === cid)) continue;

                        const campaign = {
                            advertiser_id: advertiserId,
                            campaign_id: cid,
                            campaign_name: s.campaign_name || s.session_name || `GMV Max Campaign ${cid}`,
                            objective_type: 'SHOP_PURCHASES',
                            status: s.status || 'UNKNOWN',
                            budget: s.budget || 0,
                            budget_mode: s.budget_mode || 'BUDGET_MODE_DAY',
                            raw_data: s,
                            last_synced_at: new Date().toISOString()
                        };
                        campaignUpserts.push(campaign);

                        if (!allCampaigns.find(c => c.campaign_id === cid)) {
                            allCampaigns.push(campaign);
                        }
                    }

                    // Batch upsert all GMV Max campaigns at once
                    if (campaignUpserts.length > 0) {
                        const { error } = await supabase.from('tiktok_ad_campaigns').upsert(campaignUpserts, { onConflict: 'campaign_id' });
                        if (error) console.error('[Ads Sync] GMV campaign upsert error:', error);
                        else console.log(`[Ads Sync] Upserted ${campaignUpserts.length} GMV Max campaigns`);
                    }
                } catch (err: any) {
                    console.warn(`[Ads Sync] Failed to hydrate GMV Max campaigns:`, err.message);
                }
            }
        }

        res.json({
            success: true,
            summary: {
                campaigns: allCampaigns.length,
                adGroups: allAdGroups.length,
                ads: allAds.length,
                metricsRecords: fullDailySpend.length + fullCampaignMetrics.length + fullAdMetrics.length
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/marketing-data/:accountId
 * Returns all synced daily data from Supabase (no TikTok API calls).
 * Frontend loads this into Zustand on mount, then filters locally.
 */
router.get('/marketing-data/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Get advertiser
        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('id, advertiser_id, advertiser_name, currency, balance, last_synced_at, granted_scopes')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('created_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            console.warn(`[Marketing Data] No active advertiser found for account ${accountId}`);
            return res.json({ success: true, data: { spendDaily: [], campaignMetrics: [], advertiser: null } });
        }

        // Fetch both tables in parallel
        const [spendResult, metricsResult, campaignCountResult, activeCampaignCountResult] = await Promise.all([
            supabase
                .from('tiktok_ad_spend_daily')
                .select('*')
                .eq('account_id', accountId)
                .order('spend_date', { ascending: true }),
            supabase
                .from('tiktok_ad_metrics')
                .select('*')
                .eq('advertiser_id', advertiser.id)
                .in('dimension_type', ['CAMPAIGN', 'ADVERTISER']),
            supabase
                .from('tiktok_ad_campaigns')
                .select('*', { count: 'exact', head: true })
                .eq('advertiser_id', advertiser.id),
            supabase
                .from('tiktok_ad_campaigns')
                .select('*', { count: 'exact', head: true })
                .eq('advertiser_id', advertiser.id)
                .or('status.eq.ENABLE,status.eq.CAMPAIGN_STATUS_ENABLE'),
        ]);

        const spendDaily = spendResult.data || [];
        const campaignMetrics = metricsResult.data || [];

        console.log(`[Marketing Data] Loaded ${spendDaily.length} spend rows, ${campaignMetrics.length} campaign metric rows for account ${accountId}`);

        res.json({
            success: true,
            data: {
                spendDaily,
                campaignMetrics,
                advertiser: {
                    advertiser_id: advertiser.advertiser_id,
                    name: advertiser.advertiser_name,
                    currency: advertiser.currency,
                    balance: advertiser.balance,
                    last_synced: advertiser.last_synced_at,
                    granted_scopes: advertiser.granted_scopes || '',
                },
                campaigns: {
                    total: campaignCountResult.count || 0,
                    active: activeCampaignCountResult.count || 0,
                },
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/spend/:accountId
 * Get ad spend data for date range
 */
router.get('/spend/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        let query = supabase
            .from('tiktok_ad_spend_daily')
            .select('*')
            .eq('account_id', accountId)
            .order('spend_date', { ascending: false });

        if (startDate) {
            query = query.gte('spend_date', startDate);
        }
        if (endDate) {
            query = query.lte('spend_date', endDate);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Calculate totals
        const totals = data.reduce((acc, day) => ({
            total_spend: acc.total_spend + parseFloat(day.total_spend || '0'),
            total_impressions: acc.total_impressions + parseInt(day.total_impressions || '0'),
            total_clicks: acc.total_clicks + parseInt(day.total_clicks || '0'),
            total_conversions: acc.total_conversions + parseInt(day.total_conversions || '0'),
            conversion_value: acc.conversion_value + parseFloat(day.conversion_value || '0')
        }), {
            total_spend: 0,
            total_impressions: 0,
            total_clicks: 0,
            total_conversions: 0,
            conversion_value: 0
        });

        res.json({
            success: true,
            data: {
                daily: data,
                totals,
                average_cpc: totals.total_clicks > 0 ? totals.total_spend / totals.total_clicks : 0,
                average_cpm: totals.total_impressions > 0 ? (totals.total_spend / totals.total_impressions) * 1000 : 0,
                roas: totals.total_spend > 0 ? totals.conversion_value / totals.total_spend : 0
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/campaigns/:accountId
 * Get campaigns with metrics
 */
router.get('/campaigns/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        // Get advertiser
        const { data: advertiser } = await supabase
            .from('tiktok_advertisers')
            .select('id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        // Get campaigns
        const { data: campaigns, error } = await supabase
            .from('tiktok_ad_campaigns')
            .select('*')
            .eq('advertiser_id', advertiser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Get metrics for each campaign
        const campaignsWithMetrics = await Promise.all(
            campaigns.map(async (campaign) => {
                let metricsQuery = supabase
                    .from('tiktok_ad_metrics')
                    .select('*')
                    .eq('dimension_type', 'CAMPAIGN')
                    .eq('dimension_id', campaign.id);

                if (startDate) metricsQuery = metricsQuery.gte('stat_date', startDate);
                if (endDate) metricsQuery = metricsQuery.lte('stat_date', endDate);

                const { data: metrics } = await metricsQuery;

                // Aggregate metrics
                const totals = metrics?.reduce((acc, m) => ({
                    impressions: acc.impressions + (m.impressions || 0),
                    clicks: acc.clicks + (m.clicks || 0),
                    spend: acc.spend + parseFloat(m.spend || '0'),
                    conversions: acc.conversions + (m.conversions || 0),
                    conversion_value: acc.conversion_value + parseFloat(m.conversion_value || '0')
                }), {
                    impressions: 0,
                    clicks: 0,
                    spend: 0,
                    conversions: 0,
                    conversion_value: 0
                }) || {};

                return {
                    ...campaign,
                    metrics: totals
                };
            })
        );

        res.json({ success: true, data: campaignsWithMetrics });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/overview/:accountId
 * Get overview/summary stats
 */
router.get('/overview/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        // Get advertiser
        const { data: advertiser } = await supabase
            .from('tiktok_advertisers')
            .select('*')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!advertiser) {
            return res.json({ success: true, connected: false });
        }

        // Get spend totals
        // Get aggregate metrics from AD level data (contains most granular video metrics)
        let metricsQuery = supabase
            .from('tiktok_ad_metrics')
            .select('*')
            .eq('advertiser_id', advertiser.id)
            .eq('dimension_type', 'AD');

        if (startDate) metricsQuery = metricsQuery.gte('stat_date', startDate);
        if (endDate) metricsQuery = metricsQuery.lte('stat_date', endDate);

        const { data: metricsData, error: metricsError } = await metricsQuery;

        if (metricsError) throw metricsError;

        // Calculate totals
        const totals = metricsData.reduce((acc, curr) => ({
            spend: acc.spend + (curr.spend || 0),
            impressions: acc.impressions + (curr.impressions || 0),
            clicks: acc.clicks + (curr.clicks || 0),
            conversions: acc.conversions + (curr.conversions || 0),
            conversion_value: acc.conversion_value + (curr.conversion_value || 0),
            // Engagement
            likes: acc.likes + (curr.likes || 0),
            comments: acc.comments + (curr.comments || 0),
            shares: acc.shares + (curr.shares || 0),
            follows: acc.follows + (curr.follows || 0),
            // Video
            video_views: acc.video_views + (curr.video_views || 0),
            video_watched_2s: acc.video_watched_2s + (curr.video_watched_2s || 0),
            video_watched_6s: acc.video_watched_6s + (curr.video_watched_6s || 0),
            video_views_p100: acc.video_views_p100 + (curr.video_views_p100 || 0),
            // Reach (summing reach is not technically correct for unique reach, but it's an approximation for periods)
            // For correct unique reach we'd need daily unique users which API provides but we store as aggregate
            reach: acc.reach + (curr.reach || 0)
        }), {
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            conversion_value: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            follows: 0,
            video_views: 0,
            video_watched_2s: 0,
            video_watched_6s: 0,
            video_views_p100: 0,
            reach: 0
        });

        // Calculate averages/rates
        const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
        const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
        const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
        const conversion_rate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
        const roas = totals.spend > 0 ? totals.conversion_value / totals.spend : 0;
        const frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;

        // Get campaign counts
        const { count: activeCampaigns } = await supabase
            .from('tiktok_ad_campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('advertiser_id', advertiser.id)
            .in('status', ['ENABLE', 'CAMPAIGN_STATUS_ENABLE']);

        const { count: totalCampaigns } = await supabase
            .from('tiktok_ad_campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('advertiser_id', advertiser.id);

        res.json({
            success: true,
            data: {
                connected: true,
                advertiser: {
                    name: advertiser.advertiser_name,
                    currency: advertiser.currency,
                    balance: advertiser.balance || 0
                },
                metrics: {
                    total_spend: totals.spend,
                    total_impressions: totals.impressions,
                    total_clicks: totals.clicks,
                    ctr,
                    cpc,
                    cpm,
                    conversions: totals.conversions,
                    conversion_rate,
                    roas,
                    // New metrics
                    total_likes: totals.likes,
                    total_comments: totals.comments,
                    total_shares: totals.shares,
                    total_follows: totals.follows,
                    total_video_views: totals.video_views,
                    total_video_watched_2s: totals.video_watched_2s,
                    total_video_watched_6s: totals.video_watched_6s,
                    total_video_views_p100: totals.video_views_p100,
                    total_reach: totals.reach,
                    average_frequency: frequency
                },
                campaigns: {
                    active: activeCampaigns || 0,
                    total: totalCampaigns || 0
                },
                last_synced: advertiser.last_synced_at
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/assets/:accountId
 * Get full ad hierarchy: campaigns → ad groups → ads
 */
router.get('/assets/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        // Get advertiser
        const { data: advertiser } = await supabase
            .from('tiktok_advertisers')
            .select('id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        // Fetch all three levels in parallel
        const [campaignsResult, adGroupsResult, adsResult] = await Promise.all([
            supabase
                .from('tiktok_ad_campaigns')
                .select('id, campaign_id, campaign_name, objective_type, status, budget, budget_mode, created_at')
                .eq('advertiser_id', advertiser.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('tiktok_ad_groups')
                .select('id, adgroup_id, adgroup_name, campaign_id, status, budget, budget_mode, bid_type, optimization_goal, created_at')
                .eq('advertiser_id', advertiser.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('tiktok_ads')
                .select('id, ad_id, ad_name, adgroup_id, ad_format, ad_text, call_to_action, landing_page_url, video_id, image_ids, status, created_at')
                .eq('advertiser_id', advertiser.id)
                .order('created_at', { ascending: false })
        ]);

        // Fetch campaign-level metrics directly (dimension_type = CAMPAIGN).
        // Ad Group / Ad rollup is disabled, so we must read campaign metrics directly.
        let campaignMetricsQuery = supabase
            .from('tiktok_ad_metrics')
            .select('*')
            .eq('advertiser_id', advertiser.id)
            .eq('dimension_type', 'CAMPAIGN');

        if (startDate) campaignMetricsQuery = campaignMetricsQuery.gte('stat_date', startDate);
        if (endDate) campaignMetricsQuery = campaignMetricsQuery.lte('stat_date', endDate);

        const { data: campaignMetricsData } = await campaignMetricsQuery;

        // Build campaign_id → aggregated metrics map
        const campaignMetricsMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number }>();
        if (campaignMetricsData) {
            campaignMetricsData.forEach((m: any) => {
                const key = m.dimension_id; // campaign UUID
                const cur = campaignMetricsMap.get(key) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
                campaignMetricsMap.set(key, {
                    spend: cur.spend + (m.spend || 0),
                    impressions: cur.impressions + (m.impressions || 0),
                    clicks: cur.clicks + (m.clicks || 0),
                    conversions: cur.conversions + (m.conversions || 0),
                    conversion_value: cur.conversion_value + (m.conversion_value || 0)
                });
            });
        }

        const campaigns = campaignsResult.data || [];
        const adGroups = adGroupsResult.data || [];
        const ads = adsResult.data || [];

        // Build hierarchy using direct campaign metrics (no ad rollup)
        const hierarchy = campaigns.map(campaign => {
            const metrics = campaignMetricsMap.get(campaign.id) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
            const campaignAdGroups = adGroups
                .filter(ag => ag.campaign_id === campaign.id)
                .map(ag => {
                    const groupAds = ads
                        .filter(ad => ad.adgroup_id === ag.id)
                        .map(ad => ({ ...ad, metrics: { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 }, last_active: null }));
                    return { ...ag, ads: groupAds, metrics: { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 } };
                });
            return { ...campaign, ad_groups: campaignAdGroups, metrics };
        })
            .sort((a, b) => {
                // 1. Prioritize campaigns with spend or impressions
                const aHasActivity = a.metrics.spend > 0 || a.metrics.impressions > 0;
                const bHasActivity = b.metrics.spend > 0 || b.metrics.impressions > 0;

                if (aHasActivity && !bHasActivity) return -1;
                if (!aHasActivity && bHasActivity) return 1;

                // 2. Sort by creation date descending
                const aDate = new Date(a.created_at || 0).getTime();
                const bDate = new Date(b.created_at || 0).getTime();
                return bDate - aDate;
            });

        res.json({
            success: true,
            data: {
                hierarchy,
                counts: {
                    campaigns: campaigns.length,
                    ad_groups: adGroups.length,
                    ads: ads.length
                }
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});


/**
 * GET /api/tiktok-ads/historical/:accountId
 * Get ad performance data for a specific date range, grouped by ad
 */
router.get('/historical/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query;

        // Verify account ownership
        const { data: connection } = await supabase
            .from('tiktok_advertisers')
            .select('id')
            .eq('account_id', accountId)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!connection) {
            return res.status(404).json({ success: false, error: 'Ad account not found' });
        }

        const advertiserId = connection.id;

        // Query metrics for the date range
        let query = supabase
            .from('tiktok_ad_metrics')
            .select('*')
            .eq('advertiser_id', advertiserId)
            .eq('dimension_type', 'AD');

        if (startDate) query = query.gte('stat_date', startDate);
        if (endDate) query = query.lte('stat_date', endDate);

        const { data: metrics, error: metricsError } = await query;

        if (metricsError) throw metricsError;

        if (!metrics || metrics.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Get unique ad IDs from metrics
        const adIds = [...new Set(metrics.map(m => m.dimension_id))];

        // Fetch ad details
        const { data: ads, error: adsError } = await supabase
            .from('tiktok_ads')
            .select('*')
            .in('id', adIds);

        if (adsError) throw adsError;

        // Group metrics by Ad ID
        const adPerformance = ads.map(ad => {
            const adMetrics = metrics.filter(m => m.dimension_id === ad.id);

            // Aggregate metrics
            const totalMetrics = adMetrics.reduce((acc, curr) => ({
                spend: acc.spend + (curr.spend || 0),
                impressions: acc.impressions + (curr.impressions || 0),
                clicks: acc.clicks + (curr.clicks || 0),
                conversions: acc.conversions + (curr.conversions || 0),
                conversion_value: acc.conversion_value + (curr.conversion_value || 0),
                video_views: acc.video_views + (curr.video_views || 0),
                video_watched_2s: acc.video_watched_2s + (curr.video_watched_2s || 0),
            }), {
                spend: 0, impressions: 0, clicks: 0, conversions: 0,
                conversion_value: 0, video_views: 0, video_watched_2s: 0
            });

            // Calculate derived metrics
            const ctr = totalMetrics.impressions ? (totalMetrics.clicks / totalMetrics.impressions) * 100 : 0;
            const cpc = totalMetrics.clicks ? totalMetrics.spend / totalMetrics.clicks : 0;
            const cpm = totalMetrics.impressions ? (totalMetrics.spend / totalMetrics.impressions) * 1000 : 0;
            const cpa = totalMetrics.conversions ? totalMetrics.spend / totalMetrics.conversions : 0;
            const roas = totalMetrics.spend ? totalMetrics.conversion_value / totalMetrics.spend : 0;

            return {
                ...ad,
                metrics: {
                    ...totalMetrics,
                    ctr,
                    cpc,
                    cpm,
                    cpa,
                    roas
                }
            };
        });

        //Sort by spend descending
        adPerformance.sort((a, b) => b.metrics.spend - a.metrics.spend);

        res.json({
            success: true,
            data: adPerformance
        });

    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/gmv-max/:accountId
 * GMV Max campaign report — spend, GMV driven, ROAS, orders, CPA, CVR, impressions, clicks, CTR, CPC, CPM, reach
 * Uses /gmv_max/report/get/ (primary, requires TikTok Shop store_id) with
 * /report/integrated/get/ as fallback when no linked shop is found.
 */
router.get('/gmv-max/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        // Look up linked TikTok Shop store_id(s) for this account
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('shop_id')
            .eq('account_id', accountId);

        const storeIds: string[] = (shops || []).map((s: any) => s.shop_id).filter(Boolean);
        console.log(`[GMV Route] account=${accountId} storeIds=${JSON.stringify(storeIds)}`);

        const end = endDate || new Date().toISOString().split('T')[0];
        const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();

        const raw = await tiktokBusinessApi.getGmvMaxReport(
            advertiser.access_token,
            advertiser.advertiser_id,
            start,
            end,
            storeIds
        );

        // Service returns { list: [...], _source: string }
        const list: any[] = raw?.list || [];
        const source: string = raw?._source || 'none';
        const isDedicatedGmvMax = source === 'gmv_max_dedicated';

        if (list.length > 0) {
            console.log(`[GMV Route] source=${source}, first row metric keys:`, Object.keys(list[0]?.metrics || {}));
        } else {
            console.log(`[GMV Route] source=${source}, 0 rows returned`);
        }

        let totals: any;

        if (isDedicatedGmvMax) {
            // Dedicated /gmv_max/report/get/ fields: cost (spend), roi (ROAS)
            // impressions, clicks, ctr, cpc, cpm, reach are also available
            const base = list.reduce((acc, row) => {
                const m = row.metrics || {};
                const cost = parseFloat(m.cost || '0');
                const roi = parseFloat(m.roi || '0');
                return {
                    spend: acc.spend + cost,
                    revenue: acc.revenue + (roi > 0 ? cost * roi : 0),
                    impressions: acc.impressions + parseInt(m.impressions || '0'),
                    clicks: acc.clicks + parseInt(m.clicks || '0'),
                    reach: acc.reach + parseInt(m.reach || '0'),
                    roi_sum: acc.roi_sum + roi,
                    roi_count: acc.roi_count + (roi > 0 ? 1 : 0),
                };
            }, { spend: 0, revenue: 0, impressions: 0, clicks: 0, reach: 0, roi_sum: 0, roi_count: 0 });

            const avgRoi = base.roi_count > 0 ? base.roi_sum / base.roi_count : 0;
            totals = {
                spend: base.spend,
                estimated_revenue: base.revenue,
                complete_payment: 0,      // not returned by GMV Max dedicated endpoint
                impressions: base.impressions,
                clicks: base.clicks,
                reach: base.reach,
                purchase_roas: avgRoi,
                cost_per_complete_payment: 0,
                complete_payment_rate: 0,
                ctr: base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0,
                cpc: base.clicks > 0 ? base.spend / base.clicks : 0,
                cpm: base.impressions > 0 ? (base.spend / base.impressions) * 1000 : 0,
            };
        } else if (source.startsWith('integrated')) {
            // Integrated report fields: spend, complete_payment, value_per_complete_payment,
            // complete_payment_rate, impressions, clicks, ctr, cpc, cpm, reach
            const base = list.reduce((acc, row) => {
                const m = row.metrics || {};
                const orders = parseInt(m.complete_payment || '0');
                const avgVal = parseFloat(m.value_per_complete_payment || '0');
                return {
                    spend: acc.spend + parseFloat(m.spend || '0'),
                    revenue: acc.revenue + (orders * avgVal),
                    orders: acc.orders + orders,
                    impressions: acc.impressions + parseInt(m.impressions || '0'),
                    clicks: acc.clicks + parseInt(m.clicks || '0'),
                    reach: acc.reach + parseInt(m.reach || '0'),
                };
            }, { spend: 0, revenue: 0, orders: 0, impressions: 0, clicks: 0, reach: 0 });

            totals = {
                spend: base.spend,
                estimated_revenue: base.revenue,
                complete_payment: base.orders,
                impressions: base.impressions,
                clicks: base.clicks,
                reach: base.reach,
                purchase_roas: base.spend > 0 ? base.revenue / base.spend : 0,
                cost_per_complete_payment: base.orders > 0 ? base.spend / base.orders : 0,
                complete_payment_rate: base.clicks > 0 ? (base.orders / base.clicks) * 100 : 0,
                ctr: base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0,
                cpc: base.clicks > 0 ? base.spend / base.clicks : 0,
                cpm: base.impressions > 0 ? (base.spend / base.impressions) * 1000 : 0,
            };
        } else {
            // gmv_max endpoint fields: cost (spend), roi (ROAS) — orders/impressions not available
            const { totalCost, roiSum, roiCount } = list.reduce((acc, row) => {
                const m = row.metrics || {};
                return {
                    totalCost: acc.totalCost + parseFloat(m.cost || '0'),
                    roiSum: acc.roiSum + parseFloat(m.roi || '0'),
                    roiCount: acc.roiCount + (m.roi !== undefined ? 1 : 0),
                };
            }, { totalCost: 0, roiSum: 0, roiCount: 0 });

            totals = {
                spend: totalCost,
                purchase_roas: roiCount > 0 ? roiSum / roiCount : 0,
                estimated_revenue: 0,
                complete_payment: 0,
                impressions: 0,
                clicks: 0,
                reach: 0,
                cost_per_complete_payment: 0,
                complete_payment_rate: 0,
                ctr: 0,
                cpc: 0,
                cpm: 0,
            };
        }

        res.json({ success: true, data: { totals, daily: list, source } });
    } catch (error) {
        handleApiError(res, error);
    }
});


/**
 * GET /api/tiktok-ads/ad-benchmark/:accountId
 * Ad benchmark — your metrics vs industry benchmarks for CTR, CPM, CPC, CVR.
 * TikTok returns a list of rows per dimension (e.g. AD_CATEGORY); we aggregate
 * them here into the flat object the UI expects:
 *   { your_ctr, benchmark_ctr, your_cpm, benchmark_cpm, your_cpc, benchmark_cpc, your_cvr, benchmark_cvr }
 */
router.get('/ad-benchmark/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id, id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        // Fetch campaign IDs from DB — required by the benchmark filtering param
        const { data: campaigns } = await supabase
            .from('tiktok_ad_campaigns')
            .select('campaign_id')
            .eq('advertiser_id', advertiser.id)
            .limit(50);

        const campaignIds = (campaigns || []).map((c: any) => c.campaign_id);

        if (campaignIds.length === 0) {
            return res.json({ success: true, data: null, message: 'No campaigns found — sync first to enable benchmark data.' });
        }

        const end = endDate || new Date().toISOString().split('T')[0];
        const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();

        const raw = await tiktokBusinessApi.getAdBenchmark(
            advertiser.access_token,
            advertiser.advertiser_id,
            start,
            end,
            campaignIds
        );

        // TikTok returns: { data: { list: [{ dimensions: {...}, metrics: { ctr, benchmark_ctr, cpm, benchmark_cpm, ... } }] } }
        // The UI expects a flat object: { your_ctr, benchmark_ctr, your_cpm, benchmark_cpm, ... }
        // We average across all dimension rows to produce a single representative set.
        const list: any[] = raw?.data?.list || [];

        if (list.length === 0) {
            return res.json({ success: true, data: null, message: 'No benchmark data returned for this date range.' });
        }

        // Aggregate: sum values across all rows then divide
        const sums = list.reduce((acc, row) => {
            const m = row.metrics || {};
            // TikTok benchmark field names vary — try known field names
            return {
                your_ctr: acc.your_ctr + (parseFloat(m.ctr ?? m.your_ctr ?? 0)),
                benchmark_ctr: acc.benchmark_ctr + (parseFloat(m.benchmark_ctr ?? m.industry_ctr ?? 0)),
                your_cpm: acc.your_cpm + (parseFloat(m.cpm ?? m.your_cpm ?? 0)),
                benchmark_cpm: acc.benchmark_cpm + (parseFloat(m.benchmark_cpm ?? m.industry_cpm ?? 0)),
                your_cpc: acc.your_cpc + (parseFloat(m.cpc ?? m.your_cpc ?? 0)),
                benchmark_cpc: acc.benchmark_cpc + (parseFloat(m.benchmark_cpc ?? m.industry_cpc ?? 0)),
                your_cvr: acc.your_cvr + (parseFloat(m.cvr ?? m.complete_payment_rate ?? m.your_cvr ?? 0)),
                benchmark_cvr: acc.benchmark_cvr + (parseFloat(m.benchmark_cvr ?? m.industry_cvr ?? 0)),
                _count: acc._count + 1,
            };
        }, { your_ctr: 0, benchmark_ctr: 0, your_cpm: 0, benchmark_cpm: 0, your_cpc: 0, benchmark_cpc: 0, your_cvr: 0, benchmark_cvr: 0, _count: 0 });

        const count = sums._count || 1;
        const normalized = {
            your_ctr: sums.your_ctr / count,
            benchmark_ctr: sums.benchmark_ctr / count,
            your_cpm: sums.your_cpm / count,
            benchmark_cpm: sums.benchmark_cpm / count,
            your_cpc: sums.your_cpc / count,
            benchmark_cpc: sums.benchmark_cpc / count,
            your_cvr: sums.your_cvr / count,
            benchmark_cvr: sums.benchmark_cvr / count,
            // keep the raw list for debugging
            _raw_rows: list.length,
        };

        console.log(`[Ad Benchmark] Normalized across ${list.length} rows:`, normalized);

        res.json({ success: true, data: normalized });
    } catch (error) {
        handleApiError(res, error);
    }
});


/**
 * GET /api/tiktok-ads/video-performance/:accountId
 * Video performance — plays, 2s/6s views, completion funnel (p25/p50/p75/p100), avg watch time, play rate
 */
router.get('/video-performance/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        const end = endDate || new Date().toISOString().split('T')[0];
        const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();

        const raw = await tiktokBusinessApi.getVideoPerformanceReport(
            advertiser.access_token,
            advertiser.advertiser_id,
            start,
            end
        );

        const list: any[] = raw?.data?.list || [];

        // Aggregate across all ads
        const totals = list.reduce((acc, row) => {
            const m = row.metrics || {};
            return {
                video_play_actions: acc.video_play_actions + parseInt(m.video_play_actions || '0'),
                video_watched_2s: acc.video_watched_2s + parseInt(m.video_watched_2s || '0'),
                video_watched_6s: acc.video_watched_6s + parseInt(m.video_watched_6s || '0'),
                video_views_p25: acc.video_views_p25 + parseInt(m.video_views_p25 || '0'),
                video_views_p50: acc.video_views_p50 + parseInt(m.video_views_p50 || '0'),
                video_views_p75: acc.video_views_p75 + parseInt(m.video_views_p75 || '0'),
                video_views_p100: acc.video_views_p100 + parseInt(m.video_views_p100 || '0'),
                average_video_play: acc.average_video_play + parseFloat(m.average_video_play || '0'),
                video_play_rate: acc.video_play_rate + parseFloat(m.video_play_rate || '0'),
                impression_video_play_rate: acc.impression_video_play_rate + parseFloat(m.impression_video_play_rate || '0'),
                _count: acc._count + 1,
            };
        }, {
            video_play_actions: 0, video_watched_2s: 0, video_watched_6s: 0,
            video_views_p25: 0, video_views_p50: 0, video_views_p75: 0, video_views_p100: 0,
            average_video_play: 0, video_play_rate: 0, impression_video_play_rate: 0, _count: 0
        });

        // Averages for rate/duration fields
        const count = totals._count || 1;
        const result = {
            video_play_actions: totals.video_play_actions,
            video_watched_2s: totals.video_watched_2s,
            video_watched_6s: totals.video_watched_6s,
            video_views_p25: totals.video_views_p25,
            video_views_p50: totals.video_views_p50,
            video_views_p75: totals.video_views_p75,
            video_views_p100: totals.video_views_p100,
            average_video_play: totals.average_video_play / count,
            video_play_rate: totals.video_play_rate / count,
            impression_video_play_rate: totals.impression_video_play_rate / count,
            // Computed retention rates
            retention_2s_rate: totals.video_play_actions > 0 ? (totals.video_watched_2s / totals.video_play_actions) * 100 : 0,
            retention_6s_rate: totals.video_play_actions > 0 ? (totals.video_watched_6s / totals.video_play_actions) * 100 : 0,
            completion_rate: totals.video_play_actions > 0 ? (totals.video_views_p100 / totals.video_play_actions) * 100 : 0,
        };

        res.json({ success: true, data: { totals: result, ads: list } });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/dashboard/:accountId
 * Consolidated dashboard — fetches ALL metrics in a single TikTok API call.
 * Falls back to GMV Max report for pure GMV Max advertisers.
 * Returns daily breakdown + computed totals for KPIs, engagement, video, reach.
 */
router.get('/dashboard/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
        console.log(`[Dashboard] v2 Entry: accountId=${accountId} startDate=${startDate} endDate=${endDate}`);

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id, advertiser_name, currency, balance, last_synced_at, granted_scopes')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.json({ success: true, data: { connected: false } });
        }

        const end = endDate || new Date().toISOString().split('T')[0];
        const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();

        // ── Fetch shop store IDs (needed for GMV Max API) ──────────────────────
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('shop_id')
            .eq('account_id', accountId);
        const storeIds: string[] = (shops || []).map((s: any) => s.shop_id).filter(Boolean);

        // ── Call BOTH APIs in parallel ─────────────────────────────────────────
        // 🚪 Standard Ads API  → ADVERTISER-level daily report (impressions, clicks, video, engagement)
        //    Uses AUCTION_ADVERTISER level so ALL campaign types (including GMV Max) are included
        // 🚪 GMV Max API       → dedicated /gmv_max/report/get/ for spend, revenue (cost × roi), ROAS
        console.log(`[Dashboard] Calling ADVERTISER-level Standard API + GMV Max API in parallel (storeIds=${JSON.stringify(storeIds)})`);

        // Metrics for the AUCTION_ADVERTISER level report — includes everything the UI needs.
        // video_watched_2s may fail on some advertiser configs, so we include it but handle errors gracefully.
        const advertiserMetrics = [
            'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency',
            'complete_payment', 'complete_payment_rate', 'value_per_complete_payment',
            'total_complete_payment_rate',
            'likes', 'comments', 'shares', 'follows', 'profile_visits',
            'video_play_actions', 'video_watched_2s', 'video_watched_6s',
            'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
            'engaged_view',
        ];

        // Chunk the date range into 30-day windows (TikTok API limit)
        const dateChunks: { start: string; end: string }[] = [];
        {
            let cs = new Date(start);
            const ce = new Date(end);
            while (cs <= ce) {
                const chunkEnd = new Date(cs);
                chunkEnd.setDate(cs.getDate() + 29);
                const actualEnd = chunkEnd > ce ? end : chunkEnd.toISOString().slice(0, 10);
                dateChunks.push({ start: cs.toISOString().slice(0, 10), end: actualEnd });
                cs = new Date(actualEnd);
                cs.setDate(cs.getDate() + 1);
            }
        }

        const [standardResult, gmvResult, allCampaignsResp, activeCampaignsResp, advertiserInfoResp] = await Promise.all([
            // Standard API at ADVERTISER level — one row per day with all metrics aggregated
            (async () => {
                const allRows: any[] = [];
                for (const chunk of dateChunks) {
                    try {
                        const r = await tiktokBusinessApi.getReports(
                            advertiser.access_token,
                            advertiser.advertiser_id,
                            {
                                service_type: 'AUCTION',
                                report_type: 'BASIC',
                                data_level: 'AUCTION_ADVERTISER',
                                dimensions: ['stat_time_day'],
                                metrics: advertiserMetrics,
                                start_date: chunk.start,
                                end_date: chunk.end,
                            }
                        );
                        const rows = r?.list || [];
                        console.log(`[Dashboard] Advertiser report chunk ${chunk.start}→${chunk.end}: ${rows.length} rows`);
                        if (rows.length > 0) {
                            console.log(`[Dashboard] First row metric keys:`, Object.keys(rows[0].metrics || {}));
                            // Log raw impressions from each row
                            rows.forEach((row: any, i: number) => {
                                const date = (row.dimensions?.stat_time_day || '').slice(0, 10);
                                console.log(`[Dashboard] Row ${i} (${date}): impressions=${row.metrics?.impressions}, clicks=${row.metrics?.clicks}, spend=${row.metrics?.spend}, likes=${row.metrics?.likes}`);
                            });
                        }
                        allRows.push(...rows);
                    } catch (e: any) {
                        console.warn(`[Dashboard] Advertiser report chunk ${chunk.start}→${chunk.end} failed:`, e.message);
                        // If video_watched_2s causes the failure, retry without it
                        try {
                            const retryMetrics = advertiserMetrics.filter(m => m !== 'video_watched_2s');
                            const r = await tiktokBusinessApi.getReports(
                                advertiser.access_token,
                                advertiser.advertiser_id,
                                {
                                    service_type: 'AUCTION',
                                    report_type: 'BASIC',
                                    data_level: 'AUCTION_ADVERTISER',
                                    dimensions: ['stat_time_day'],
                                    metrics: retryMetrics,
                                    start_date: chunk.start,
                                    end_date: chunk.end,
                                }
                            );
                            const retryRows = r?.list || [];
                            console.log(`[Dashboard] Retry (without video_watched_2s) chunk ${chunk.start}→${chunk.end}: ${retryRows.length} rows`);
                            allRows.push(...retryRows);
                        } catch (retryErr: any) {
                            console.warn(`[Dashboard] Retry also failed:`, retryErr.message);
                        }
                    }
                }
                return allRows;
            })(),
            // GMV Max API
            storeIds.length > 0
                ? tiktokBusinessApi.getGmvMaxReport(
                    advertiser.access_token,
                    advertiser.advertiser_id,
                    start,
                    end,
                    storeIds
                ).catch((e: any) => {
                    console.warn(`[Dashboard] GMV Max API failed:`, e.message);
                    return { list: [], _source: 'none' };
                })
                : Promise.resolve({ list: [], _source: 'no_store_ids' }),
            // All campaigns (for total count)
            tiktokBusinessApi.getCampaigns(advertiser.access_token, advertiser.advertiser_id, {
                page_size: 1
            }).catch(() => null),
            // Active campaigns only
            tiktokBusinessApi.getCampaigns(advertiser.access_token, advertiser.advertiser_id, {
                primary_status: "ENABLE",
                page_size: 1
            }).catch(() => null),
            tiktokBusinessApi.getAdvertiserInfo(advertiser.access_token, advertiser.advertiser_id).catch(() => null)
        ]);

        const standardRows: any[] = standardResult || [];
        const gmvRowsRaw: any[] = gmvResult.list || [];

        console.log(`[Dashboard] Advertiser-level rows: ${standardRows.length} | GMV Max rows: ${gmvRowsRaw.length}`);

        const source = gmvRowsRaw.length > 0
            ? (standardRows.length > 0 ? 'standard+gmv_max' : 'gmv_max_only')
            : (standardRows.length > 0 ? 'standard_only' : 'none');

        // ── Aggregate: Standard rows give us impressions/video/engagement/etc
        const standardTotals = standardRows.reduce((acc, row) => {
            const m = row.metrics || {};
            return {
                impressions: acc.impressions + parseInt(m.impressions || '0'),
                clicks: acc.clicks + parseInt(m.clicks || '0'),
                reach: acc.reach + parseInt(m.reach || '0'),
                complete_payment: acc.complete_payment + parseInt(m.complete_payment || '0'),
                value_per_complete_payment_sum: acc.value_per_complete_payment_sum + (parseInt(m.complete_payment || '0') * parseFloat(m.value_per_complete_payment || '0')),
                likes: acc.likes + parseInt(m.likes || '0'),
                comments: acc.comments + parseInt(m.comments || '0'),
                shares: acc.shares + parseInt(m.shares || '0'),
                follows: acc.follows + parseInt(m.follows || '0'),
                profile_visits: acc.profile_visits + parseInt(m.profile_visits || '0'),
                video_play_actions: acc.video_play_actions + parseInt(m.video_play_actions || '0'),
                video_watched_2s: acc.video_watched_2s + parseInt(m.video_watched_2s || '0'),
                video_watched_6s: acc.video_watched_6s + parseInt(m.video_watched_6s || '0'),
                video_views_p25: acc.video_views_p25 + parseInt(m.video_views_p25 || '0'),
                video_views_p50: acc.video_views_p50 + parseInt(m.video_views_p50 || '0'),
                video_views_p75: acc.video_views_p75 + parseInt(m.video_views_p75 || '0'),
                video_views_p100: acc.video_views_p100 + parseInt(m.video_views_p100 || '0'),
                engaged_view: acc.engaged_view + parseInt(m.engaged_view || '0'),
                // Spend from standard API — only used if GMV Max API is unavailable
                spend_from_standard: acc.spend_from_standard + parseFloat(m.spend || '0'),
            };
        }, {
            impressions: 0, clicks: 0, reach: 0,
            complete_payment: 0, value_per_complete_payment_sum: 0,
            likes: 0, comments: 0, shares: 0, follows: 0, profile_visits: 0,
            video_play_actions: 0, video_watched_2s: 0, video_watched_6s: 0,
            video_views_p25: 0, video_views_p50: 0, video_views_p75: 0, video_views_p100: 0,
            engaged_view: 0, spend_from_standard: 0,
        });

        // If the advertiser-level standard report returned no rows (common for pure GMV Max setups),
        // fall back to campaign-level integrated reports to recover impressions/clicks/reach and
        // basic conversion metrics.
        let effectiveStandardTotals = standardTotals;
        if (standardRows.length === 0) {
            try {
                const campaignMetricRows = await tiktokBusinessApi.getCampaignMetrics(
                    advertiser.access_token,
                    advertiser.advertiser_id,
                    start,
                    end
                );
                if (campaignMetricRows && campaignMetricRows.length > 0) {
                    console.log(`[Dashboard] Campaign-level metrics fallback rows: ${campaignMetricRows.length}`);
                    effectiveStandardTotals = campaignMetricRows.reduce((acc: any, row: any) => {
                        const m = row.metrics || {};
                        return {
                            impressions: acc.impressions + parseInt(m.impressions || '0'),
                            clicks: acc.clicks + parseInt(m.clicks || '0'),
                            reach: acc.reach + parseInt(m.reach || '0'),
                            complete_payment: acc.complete_payment + parseInt(m.complete_payment || '0'),
                            value_per_complete_payment_sum: acc.value_per_complete_payment_sum + (parseInt(m.complete_payment || '0') * parseFloat(m.value_per_complete_payment || '0')),
                            likes: acc.likes + parseInt(m.likes || '0'),
                            comments: acc.comments + parseInt(m.comments || '0'),
                            shares: acc.shares + parseInt(m.shares || '0'),
                            follows: acc.follows + parseInt(m.follows || '0'),
                            profile_visits: acc.profile_visits + parseInt(m.profile_visits || '0'),
                            video_play_actions: acc.video_play_actions + parseInt(m.video_play_actions || '0'),
                            video_watched_2s: acc.video_watched_2s + parseInt(m.video_watched_2s || '0'),
                            video_watched_6s: acc.video_watched_6s + parseInt(m.video_watched_6s || '0'),
                            video_views_p25: acc.video_views_p25 + parseInt(m.video_views_p25 || '0'),
                            video_views_p50: acc.video_views_p50 + parseInt(m.video_views_p50 || '0'),
                            video_views_p75: acc.video_views_p75 + parseInt(m.video_views_p75 || '0'),
                            video_views_p100: acc.video_views_p100 + parseInt(m.video_views_p100 || '0'),
                            engaged_view: acc.engaged_view + parseInt(m.engaged_view || '0'),
                            spend_from_standard: acc.spend_from_standard + parseFloat(m.spend || '0'),
                        };
                    }, {
                        impressions: 0, clicks: 0, reach: 0,
                        complete_payment: 0, value_per_complete_payment_sum: 0,
                        likes: 0, comments: 0, shares: 0, follows: 0, profile_visits: 0,
                        video_play_actions: 0, video_watched_2s: 0, video_watched_6s: 0,
                        video_views_p25: 0, video_views_p50: 0, video_views_p75: 0, video_views_p100: 0,
                        engaged_view: 0, spend_from_standard: 0,
                    });
                }
            } catch (e: any) {
                console.warn('[Dashboard] Campaign metrics fallback failed:', e.message);
            }
        }

        // ── GMV Max totals for spend/revenue + impressions/clicks if available
        const gmvTotals = gmvRowsRaw.reduce((acc, row) => {
            const m = row.metrics || {};
            const cost = parseFloat(m.cost || m.spend || '0');
            const roi = parseFloat(m.roi || '0');
            return {
                spend: acc.spend + cost,
                gmv_max_spend: acc.gmv_max_spend + cost,
                gmv_max_revenue: acc.gmv_max_revenue + (roi > 0 ? cost * roi : 0),
                roi_sum: acc.roi_sum + roi,
                roi_count: acc.roi_count + (roi > 0 ? 1 : 0),
                // GMV Max endpoint may also return impressions/clicks/reach
                impressions: acc.impressions + parseInt(m.impressions || '0'),
                clicks: acc.clicks + parseInt(m.clicks || '0'),
                reach: acc.reach + parseInt(m.reach || '0'),
                conversions: acc.conversions + parseInt(m.conversions || m.complete_payment || '0'),
            };
        }, {
            spend: 0, gmv_max_spend: 0, gmv_max_revenue: 0, roi_sum: 0, roi_count: 0,
            impressions: 0, clicks: 0, reach: 0, conversions: 0,
        });

        console.log(`[Dashboard] GMV totals: spend=${gmvTotals.spend}, impressions=${gmvTotals.impressions}, clicks=${gmvTotals.clicks}, reach=${gmvTotals.reach}`);

        // Merge: prefer GMV Max for spend/revenue.
        // For impressions/clicks/reach: use standard (advertiser- or campaign-level) if available,
        // otherwise fall back to GMV Max data.
        // For conversions (orders), always fall back to GMV Max when standard is 0.
        const useGmvForMetrics = effectiveStandardTotals.impressions === 0 && gmvTotals.impressions > 0;
        const mergedCompletePayment = effectiveStandardTotals.complete_payment > 0
            ? effectiveStandardTotals.complete_payment
            : gmvTotals.conversions;
        const totals = {
            spend: gmvTotals.spend > 0 ? gmvTotals.spend : effectiveStandardTotals.spend_from_standard,
            gmv_max_spend: gmvTotals.gmv_max_spend,
            gmv_max_revenue: gmvTotals.gmv_max_revenue,
            roi_sum: gmvTotals.roi_sum,
            roi_count: gmvTotals.roi_count,
            ...effectiveStandardTotals,
            complete_payment: mergedCompletePayment,
            // Override with GMV Max data for delivery metrics if standard returned 0
            ...(useGmvForMetrics ? {
                impressions: gmvTotals.impressions,
                clicks: gmvTotals.clicks,
                reach: gmvTotals.reach,
            } : {}),
        };

        if (useGmvForMetrics) {
            console.log(`[Dashboard] Using GMV Max data for impressions/clicks (standard API returned 0)`);
        }

        // Daily chart — use standard rows if available, otherwise aggregate GMV Max rows by date
        const list = standardRows.length > 0 ? standardRows : (() => {
            // Aggregate GMV Max rows by date for the daily chart
            const byDate = new Map<string, any>();
            for (const row of gmvRowsRaw) {
                const date = (row.dimensions?.stat_time_day || '').slice(0, 10);
                if (!date) continue;
                const existing = byDate.get(date) || { dimensions: { stat_time_day: date }, metrics: { spend: '0', cost: '0', impressions: '0', clicks: '0' } };
                const m = row.metrics || {};
                existing.metrics.spend = String(parseFloat(existing.metrics.spend) + parseFloat(m.cost || m.spend || '0'));
                existing.metrics.cost = existing.metrics.spend;
                existing.metrics.impressions = String(parseInt(existing.metrics.impressions) + parseInt(m.impressions || '0'));
                existing.metrics.clicks = String(parseInt(existing.metrics.clicks) + parseInt(m.clicks || '0'));
                byDate.set(date, existing);
            }
            return Array.from(byDate.values());
        })();


        // Compute derived metrics
        const revenue = totals.value_per_complete_payment_sum;
        const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
        const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
        const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
        // ROAS: prefer complete_payment-based revenue; fall back to GMV Max ROI
        const roas = revenue > 0 && totals.spend > 0
            ? revenue / totals.spend
            : (totals.roi_count > 0 ? totals.roi_sum / totals.roi_count : 0);
        const conversion_rate = totals.clicks > 0 ? (totals.complete_payment / totals.clicks) * 100 : 0;
        const cost_per_conversion = totals.complete_payment > 0 ? totals.spend / totals.complete_payment : 0;
        const frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;

        let activeCampaigns = 0;
        let totalCampaigns = 0;
        if (allCampaignsResp && allCampaignsResp.page_info) {
            totalCampaigns = allCampaignsResp.page_info.total_number || 0;
        }
        if (activeCampaignsResp && activeCampaignsResp.page_info) {
            activeCampaigns = activeCampaignsResp.page_info.total_number || 0;
        }
        // Fallback: derive campaign count from GMV Max rows if standard API returned 0
        let liveBalance = advertiser.balance || 0;
        if (Array.isArray(advertiserInfoResp) && advertiserInfoResp.length > 0) {
            liveBalance = parseFloat(advertiserInfoResp[0].balance || String(liveBalance));
        }

        res.json({
            success: true,
            data: {
                connected: true,
                advertiser: {
                    name: advertiser.advertiser_name,
                    currency: advertiser.currency,
                    balance: liveBalance,
                    advertiser_id: advertiser.advertiser_id,
                    granted_scopes: advertiser.granted_scopes || '',
                },
                kpis: {
                    spend: totals.spend,
                    gmv_max_spend: totals.gmv_max_spend,
                    revenue,
                    gmv_max_revenue: totals.gmv_max_revenue,
                    roas,
                    impressions: totals.impressions,
                    clicks: totals.clicks,
                    ctr,
                    cpc,
                    cpm,
                    conversions: totals.complete_payment,
                    conversion_rate,
                    cost_per_conversion,
                    reach: totals.reach,
                    frequency,
                },
                engagement: {
                    likes: totals.likes,
                    comments: totals.comments,
                    shares: totals.shares,
                    follows: totals.follows,
                    profile_visits: totals.profile_visits,
                },
                video: {
                    video_play_actions: totals.video_play_actions,
                    video_watched_2s: totals.video_watched_2s,
                    video_watched_6s: totals.video_watched_6s,
                    video_views_p25: totals.video_views_p25,
                    video_views_p50: totals.video_views_p50,
                    video_views_p75: totals.video_views_p75,
                    video_views_p100: totals.video_views_p100,
                    engaged_view: totals.engaged_view,
                    retention_2s: totals.video_play_actions > 0 ? (totals.video_watched_2s / totals.video_play_actions) * 100 : 0,
                    retention_6s: totals.video_play_actions > 0 ? (totals.video_watched_6s / totals.video_play_actions) * 100 : 0,
                    completion_rate: totals.video_play_actions > 0 ? (totals.video_views_p100 / totals.video_play_actions) * 100 : 0,
                },
                campaigns: { active: activeCampaigns, total: totalCampaigns },
                daily: (() => {
                    // Aggregate per-campaign rows into one entry per day
                    // (GMV Max fallback splits rows by campaign_id × day)
                    const byDate = new Map<string, number>();
                    for (const row of list) {
                        const m = row.metrics || {};
                        const date = (row.dimensions?.stat_time_day || '').slice(0, 10);
                        if (!date) continue;
                        const spendVal = parseFloat(m.spend || m.cost || '0');
                        byDate.set(date, (byDate.get(date) || 0) + spendVal);
                    }
                    return Array.from(byDate.entries())
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([date, spend]) => ({ date, spend: String(spend) }));
                })(),
                last_synced: advertiser.last_synced_at,
                date_range: { start, end },
                _source: source,
            }
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/gmv-max/sessions/:accountId
 * List GMV Max campaign sessions
 */
router.get('/gmv-max/sessions/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id, id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        // Get ALL campaign IDs from DB for this advertiser (not just ENABLE — GMV Max sessions
        // exist for paused/deleted campaigns too, and status strings vary e.g. CAMPAIGN_STATUS_ENABLE)
        const { data: campaigns } = await supabase
            .from('tiktok_ad_campaigns')
            .select('campaign_id')
            .eq('advertiser_id', advertiser.id)
            .limit(100);

        let campaignIds = (campaigns || []).map((c: any) => c.campaign_id);
        console.log(`[GMV Max Sessions] Found ${campaignIds.length} campaign IDs in DB for advertiser ${advertiser.id}`);

        // Safety net: if DB has no campaigns (sync not run yet), fetch live from TikTok API
        if (campaignIds.length === 0) {
            console.log(`[GMV Max Sessions] DB empty — fetching campaign IDs live from TikTok API...`);
            try {
                const liveCampaigns = await tiktokBusinessApi.getCampaigns(advertiser.access_token, advertiser.advertiser_id, { page_size: 100 });
                campaignIds = (liveCampaigns.list || []).map((c: any) => c.campaign_id);
                console.log(`[GMV Max Sessions] Live fetch returned ${campaignIds.length} campaigns`);
            } catch (e: any) {
                console.warn(`[GMV Max Sessions] Live campaign fetch failed:`, e.message);
            }
        }

        const sessions = await tiktokBusinessApi.getGmvMaxSessions(
            advertiser.access_token,
            advertiser.advertiser_id,
            campaignIds
        );

        res.json({ success: true, data: sessions });
    } catch (error) {
        handleApiError(res, error);
    }
});

/**
 * GET /api/tiktok-ads/audience/:accountId
 * Audience demographics — age, gender, country breakdowns
 */
router.get('/audience/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

        const { data: advertiser, error: advError } = await supabase
            .from('tiktok_advertisers')
            .select('access_token, advertiser_id')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .order('last_synced_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (advError || !advertiser) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        const end = endDate || new Date().toISOString().split('T')[0];
        const start = startDate || (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();

        const data = await tiktokBusinessApi.getAudienceReport(
            advertiser.access_token,
            advertiser.advertiser_id,
            start,
            end
        );

        res.json({ success: true, data });
    } catch (error) {
        handleApiError(res, error);
    }
});

export default router;
