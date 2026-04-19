import { tiktokBusinessApi } from './tiktok-business-api.service.js';
import { supabase } from '../config/supabase.js';

export class AdsSyncAdvertiserNotFoundError extends Error {
    override name = 'AdsSyncAdvertiserNotFoundError';
    constructor(message = 'Advertiser not found') {
        super(message);
    }
}

export type TikTokAdsFullSyncResult = {
    success: true;
    summary: {
        campaigns: number;
        adGroups: number;
        ads: number;
        metricsRecords: number;
    };
};

/**
 * Full TikTok Ads pull (campaigns, ad groups, ads, metrics, daily spend).
 * Used by the ingestion worker; keep side effects DB + TikTok API only (no HTTP response).
 */
export async function runTikTokAdsFullSync(params: {
    accountId: string;
    startDate?: string;
    endDate?: string;
}): Promise<TikTokAdsFullSyncResult> {
    const { accountId, startDate, endDate } = params;
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
            throw new AdsSyncAdvertiserNotFoundError();
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

    return {
        success: true,
        summary: {
            campaigns: allCampaigns.length,
            adGroups: allAdGroups.length,
            ads: allAds.length,
            metricsRecords: fullDailySpend.length + fullCampaignMetrics.length + fullAdMetrics.length,
        },
    };
}
