import { create } from 'zustand';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdvertiserInfo {
    id?: string;
    advertiser_id: string;
    name: string;
    currency: string;
    balance: number;
    last_synced?: string;
    granted_scopes?: string;
}

export interface AvailableAdvertiser {
    advertiser_id: string;
    name: string;
    currency: string;
    balance: number;
    status: string;
    timezone: string;
    create_time: number | null;
    is_current: boolean;
}

export interface DashboardKPIs {
    spend: number;
    gmv_max_spend: number;
    revenue: number;
    gmv_max_revenue: number;
    roas: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    cpm: number;
    conversions: number;
    conversion_rate: number;
    cost_per_conversion: number;
    reach: number;
    frequency: number;
}

export interface DashboardEngagement {
    likes: number;
    comments: number;
    shares: number;
    follows: number;
    profile_visits: number;
}

export interface DashboardVideo {
    video_play_actions: number;
    video_watched_2s: number;
    video_watched_6s: number;
    video_views_p25: number;
    video_views_p50: number;
    video_views_p75: number;
    video_views_p100: number;
    engaged_view: number;
    retention_2s: number;
    retention_6s: number;
    completion_rate: number;
}

export interface DashboardData {
    connected: boolean;
    advertiser?: {
        name: string;
        currency: string;
        balance: number;
        advertiser_id: string;
        granted_scopes?: string;
    };
    kpis: DashboardKPIs;
    engagement: DashboardEngagement;
    video: DashboardVideo;
    campaigns: { active: number; total: number };
    daily: any[];
    last_synced?: string;
    date_range?: { start: string; end: string };
}

export interface AudienceData {
    age: any[];
    gender: any[];
    country: any[];
}

export interface AdCampaign {
    campaign_id: string;
    campaign_name: string;
    objective_type: string;
    status: string;
    budget: number;
    budget_mode: string;
    metrics?: {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
        conversion_value: number;
    };
}

export interface AdSpendData {
    daily: Array<{
        spend_date: string;
        total_spend: number;
        total_impressions: number;
        total_clicks: number;
        total_conversions: number;
        conversion_value: number;
    }>;
    totals: {
        total_spend: number;
        total_impressions: number;
        total_clicks: number;
        total_conversions: number;
        conversion_value: number;
    };
    average_cpc: number;
    average_cpm: number;
    roas: number;
}

export interface AdAsset {
    id: string;
    ad_id: string;
    ad_name: string;
    adgroup_id: string;
    ad_format: string;
    ad_text: string;
    call_to_action: string;
    landing_page_url: string;
    video_id: string;
    image_ids: string[];
    tiktok_item_id?: string;
    status: string;
    created_at: string;
    metrics?: AdMetrics;
    last_active?: string;
}

export interface AdGroupAsset {
    id: string;
    adgroup_id: string;
    adgroup_name: string;
    campaign_id: string;
    status: string;
    budget: number;
    budget_mode: string;
    bid_type: string;
    optimization_goal: string;
    created_at: string;
    ads: AdAsset[];
    metrics?: AdMetrics;
}

export interface CampaignAsset {
    id: string;
    campaign_id: string;
    campaign_name: string;
    objective_type: string;
    status: string;
    budget: number;
    budget_mode: string;
    created_at: string;
    ad_groups: AdGroupAsset[];
    metrics?: AdMetrics;
}

export interface AdMetrics {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversion_value: number;
}

export interface DailySettlementAdSpend {
    date: string;
    shop_ads_spend: number;
    affiliate_ads_spend: number;
    total_ad_spend: number;
    total_revenue: number;
    transaction_count: number;
}

export interface AdAssets {
    hierarchy: CampaignAsset[];
    counts: {
        campaigns: number;
        ad_groups: number;
        ads: number;
    };
}

// ─── State ───────────────────────────────────────────────────────────────────

interface TikTokAdsState {
    connected: boolean;
    isLoading: boolean;
    isSyncing: boolean;
    isSwitching: boolean;
    error: string | null;
    advertiserInfo: AdvertiserInfo | null;
    availableAdvertisers: AvailableAdvertiser[] | null;

    // New consolidated dashboard data
    dashboardData: DashboardData | null;
    gmvMaxSessions: any[] | null;
    audienceData: AudienceData | null;

    // Kept from old store
    campaigns: AdCampaign[];
    spendData: AdSpendData | null;
    dailySettlementSpend: DailySettlementAdSpend[] | null;
    assets: AdAssets | null;
    lastFetchTime: number | null;
    assetsDateRange: { start: string; end: string } | null;
    assetsLastFetchTime: number | null;
    lastConnectionCheckTime: number | null;

    // Actions
    checkConnection: (accountId: string) => Promise<boolean>;
    connectTikTokAds: (accountId: string) => Promise<void>;
    syncAdsData: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchDashboard: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchGmvMaxSessions: (accountId: string) => Promise<void>;
    fetchAudienceData: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchCampaigns: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchSpendData: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchDailySettlementSpend: (accountId: string, shopId: string, startDate: string, endDate: string) => Promise<void>;
    fetchAssets: (accountId: string, startDate?: string, endDate?: string) => Promise<void>;
    fetchHistoricalAds: (accountId: string, startDate: string, endDate: string) => Promise<any[]>;
    fetchAvailableAdvertisers: (accountId: string) => Promise<void>;
    switchAdvertiser: (accountId: string, advertiserId: string) => Promise<void>;
    disconnectTikTokAds: (accountId: string) => Promise<boolean>;
    clearData: () => void;

    // ─── DB-First Data from Supabase ──────────────────────────────────────
    marketingDaily: any[];
    marketingMetrics: any[];
    marketingLoaded: boolean;
    marketingAccountId: string | null;
    marketingCampaigns: { active: number; total: number };
    loadMarketingFromDB: (accountId: string) => Promise<void>;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTikTokAdsStore = create<TikTokAdsState>((set, get) => ({
    connected: false,
    isLoading: false,
    isSyncing: false,
    isSwitching: false,
    error: null,
    advertiserInfo: null,
    availableAdvertisers: null,
    dashboardData: null,
    gmvMaxSessions: null,
    audienceData: null,
    campaigns: [],
    spendData: null,
    dailySettlementSpend: null,
    assets: null,
    lastFetchTime: null,
    assetsDateRange: null,
    assetsLastFetchTime: null,
    lastConnectionCheckTime: null,

    // DB-First state
    marketingDaily: [],
    marketingMetrics: [],
    marketingLoaded: false,
    marketingAccountId: null,
    marketingCampaigns: { active: 0, total: 0 },

    checkConnection: async (accountId: string) => {
        try {
            const state = get();
            if (state.connected && state.advertiserInfo && state.lastConnectionCheckTime && (Date.now() - state.lastConnectionCheckTime < 5 * 60 * 1000)) {
                return true;
            }

            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/status/${accountId}`);
            const result = await response.json();

            if (result.success) {
                const updates: Partial<TikTokAdsState> = {
                    connected: result.connected,
                    advertiserInfo: null,
                    lastConnectionCheckTime: Date.now()
                };
                if (result.connected && result.advertiser) {
                    updates.advertiserInfo = {
                        id: result.advertiser.id,
                        advertiser_id: result.advertiser.advertiser_id,
                        name: result.advertiser.name,
                        currency: result.advertiser.currency,
                        balance: result.advertiser.balance,
                        last_synced: result.advertiser.last_synced,
                        granted_scopes: result.advertiser.granted_scopes || '',
                    };
                }
                set(updates);
                return result.connected;
            }
            return false;
        } catch (error: any) {
            console.error('[TikTok Ads] Connection check failed:', error);
            set({ error: error.message });
            return false;
        }
    },

    connectTikTokAds: async (accountId: string) => {
        try {
            set({ isLoading: true, error: null });
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/auth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId })
            });
            const result = await response.json();
            if (result.success && result.authUrl) {
                window.location.href = result.authUrl;
            } else {
                throw new Error(result.error || 'Failed to start OAuth flow');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Connect failed:', error);
            set({ error: error.message, isLoading: false });
            throw error;
        }
    },

    syncAdsData: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            set({ isSyncing: true, error: null });
            const body: any = {};
            if (startDate) body.startDate = startDate;
            if (endDate) body.endDate = endDate;

            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/sync/${accountId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Sync failed');
            console.log('[TikTok Ads] Sync complete:', result.summary);

            // After sync, refresh the DB-first data store so the UI updates with new data
            await get().loadMarketingFromDB(accountId);
            // Wait heavily to prevent race conditions during fast reloads
            set({ isSyncing: false });
        } catch (error: any) {
            console.error('[TikTok Ads] Sync failed:', error);
            set({ error: error.message, isSyncing: false });
            throw error;
        }
    },

    // ─── New consolidated dashboard fetch ─────────────────────────────────
    fetchDashboard: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const url = `${API_BASE_URL}/api/tiktok-ads/dashboard/${accountId}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                const data = result.data as DashboardData;
                const updates: Partial<TikTokAdsState> = {
                    dashboardData: data,
                    connected: data.connected,
                    error: null,
                    lastFetchTime: Date.now(),
                };
                if (data.advertiser) {
                    updates.advertiserInfo = {
                        advertiser_id: data.advertiser.advertiser_id,
                        name: data.advertiser.name,
                        currency: data.advertiser.currency,
                        balance: data.advertiser.balance,
                        last_synced: data.last_synced,
                        granted_scopes: data.advertiser.granted_scopes || '',
                    };
                }
                set(updates);
            } else {
                throw new Error(result.error || 'Failed to fetch dashboard');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch dashboard failed:', error);
            set({ error: error.message });
        }
    },

    loadMarketingFromDB: async (accountId: string) => {
        try {
            set({ isLoading: true, error: null });
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/marketing-data/${accountId}`);
            const result = await response.json();

            if (result.success) {
                const data = result.data;
                const updates: Partial<TikTokAdsState> = {
                    marketingDaily: data.spendDaily || [],
                    marketingMetrics: data.campaignMetrics || [],
                    marketingCampaigns: data.campaigns || { active: 0, total: 0 },
                    marketingLoaded: true,
                    marketingAccountId: accountId,
                    isLoading: false,
                    error: null,
                };
                if (data.advertiser) {
                    updates.advertiserInfo = {
                        advertiser_id: data.advertiser.advertiser_id,
                        name: data.advertiser.name,
                        currency: data.advertiser.currency,
                        balance: data.advertiser.balance,
                        last_synced: data.advertiser.last_synced,
                        granted_scopes: data.advertiser.granted_scopes || '',
                    };
                }
                set(updates);
            } else {
                throw new Error(result.error || 'Failed to load marketing data from DB');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Load marketing data failed:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    fetchGmvMaxSessions: async (accountId: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/gmv-max/sessions/${accountId}`);
            const result = await response.json();
            if (result.success) {
                set({ gmvMaxSessions: result.data });
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch GMV Max sessions failed:', error);
        }
    },

    fetchAudienceData: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/audience/${accountId}?${params.toString()}`);
            const result = await response.json();
            if (result.success) {
                set({ audienceData: result.data });
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch audience data failed:', error);
        }
    },

    // ─── Kept from old store ──────────────────────────────────────────────
    fetchCampaigns: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const url = `${API_BASE_URL}/api/tiktok-ads/campaigns/${accountId}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                set({ campaigns: result.data, error: null });
            } else {
                throw new Error(result.error || 'Failed to fetch campaigns');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch campaigns failed:', error);
            set({ error: error.message });
        }
    },

    fetchSpendData: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const url = `${API_BASE_URL}/api/tiktok-ads/spend/${accountId}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                set({ spendData: result.data, error: null });
            } else {
                throw new Error(result.error || 'Failed to fetch spend data');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch spend failed:', error);
            set({ error: error.message });
        }
    },

    fetchDailySettlementSpend: async (accountId: string, shopId: string, startDate: string, endDate: string) => {
        try {
            const startUnix = Math.floor(new Date(startDate).getTime() / 1000);
            const endUnix = Math.floor(new Date(endDate).getTime() / 1000);
            const url = `${API_BASE_URL}/api/tiktok-shop/finance/daily-ad-spend/${accountId}?shopId=${shopId}&startDate=${startUnix}&endDate=${endUnix}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                set({ dailySettlementSpend: result.data.daily });
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch daily settlement spend failed:', error);
        }
    },

    fetchAssets: async (accountId: string, startDate?: string, endDate?: string) => {
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const url = `${API_BASE_URL}/api/tiktok-ads/assets/${accountId}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                set({ 
                    assets: result.data, 
                    error: null,
                    assetsLastFetchTime: Date.now(),
                    assetsDateRange: startDate && endDate ? { start: startDate, end: endDate } : null
                });
            } else {
                throw new Error(result.error || 'Failed to fetch assets');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch assets failed:', error);
            set({ error: error.message });
        }
    },

    fetchHistoricalAds: async (accountId: string, startDate: string, endDate: string) => {
        try {
            const params = new URLSearchParams();
            params.append('startDate', startDate);
            params.append('endDate', endDate);

            const url = `${API_BASE_URL}/api/tiktok-ads/historical/${accountId}?${params.toString()}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || 'Failed to fetch historical ads');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch historical ads failed:', error);
            throw error;
        }
    },

    fetchAvailableAdvertisers: async (accountId: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/advertisers/${accountId}`);
            const result = await response.json();
            if (result.success) {
                set({ availableAdvertisers: result.advertisers });
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Fetch available advertisers failed:', error);
        }
    },

    switchAdvertiser: async (accountId: string, advertiserId: string) => {
        try {
            set({ isSwitching: true, error: null });
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/switch-advertiser/${accountId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ advertiserId })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Failed to switch advertiser');

            // Clear cached data
            set({
                dashboardData: null,
                gmvMaxSessions: null,
                audienceData: null,
                campaigns: [],
                spendData: null,
                dailySettlementSpend: null,
                assets: null,
                lastFetchTime: null,
                isSwitching: false,
                marketingDaily: [],
                marketingMetrics: [],
                marketingLoaded: false,
                marketingAccountId: null,
                marketingCampaigns: { active: 0, total: 0 }
            });

            await get().checkConnection(accountId);
            await get().fetchAvailableAdvertisers(accountId);
        } catch (error: any) {
            console.error('[TikTok Ads] Switch advertiser failed:', error);
            set({ error: error.message, isSwitching: false });
            throw error;
        }
    },

    disconnectTikTokAds: async (accountId: string) => {
        try {
            set({ isLoading: true, error: null });
            const response = await fetch(`${API_BASE_URL}/api/tiktok-ads/disconnect/${accountId}`, {
                method: 'DELETE',
            });
            const result = await response.json();

            if (result.success) {
                return true;
            } else {
                throw new Error(result.error || 'Failed to disconnect TikTok Ads account');
            }
        } catch (error: any) {
            console.error('[TikTok Ads] Disconnect failed:', error);
            set({ error: error.message, isLoading: false });
            return false;
        }
    },

    clearData: () => set({
        connected: false,
        advertiserInfo: null,
        availableAdvertisers: null,
        dashboardData: null,
        gmvMaxSessions: null,
        audienceData: null,
        campaigns: [],
        spendData: null,
        dailySettlementSpend: null,
        assets: null,
        error: null,
        lastFetchTime: null,
        marketingDaily: [],
        marketingMetrics: [],
        marketingLoaded: false,
        marketingAccountId: null,
        marketingCampaigns: { active: 0, total: 0 },
    }),
}));
