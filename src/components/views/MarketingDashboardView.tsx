/**
 * MarketingDashboardView — Rebuilt from scratch.
 *
 * Uses a single /api/tiktok-ads/dashboard/:accountId endpoint for all KPIs,
 * engagement, video, and daily performance data. GMV Max sessions and
 * audience demographics are fetched via separate endpoints.
 *
 * Sections:
 * 1. Header — title, date picker, sync button, advertiser switcher
 * 2. Connection Card — connect button or status
 * 3. KPI Grid — 10 metric cards
 * 4. Daily Spend Chart — spend over time
 * 5. Campaign Performance — table from synced DB data
 * 6. Engagement & Video — compact stat rows
 * 7. Audience Insights — age/gender/country breakdown
 * 8. Ad Hierarchy — expandable campaign → ad group → ad tree
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    DollarSign, TrendingUp, Eye, MousePointerClick, Target,
    Users, BarChart3, Video, Heart, MessageCircle, Share2, UserPlus,
    RefreshCw, Link2, ChevronDown, ChevronRight, Megaphone,
    Zap, Globe, Calendar, LogOut, AlertTriangle
} from 'lucide-react';
import { useTikTokAdsStore, CampaignAsset, AdGroupAsset, AdAsset } from '../../store/useTikTokAdsStore';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { Account } from '../../lib/supabase';
import { formatShopDateISO } from '../../utils/dateUtils';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer
} from 'recharts';

interface MarketingDashboardViewProps {
    account: Account;
    shopId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number, decimals = 2) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
        : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
            : n.toFixed(decimals);

const fmtCurrency = (n: number) => `$${fmt(n)}`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtInt = (n: number) => n.toLocaleString();

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color, subtitle }: {
    label: string; value: string; icon: any; color: string; subtitle?: string;
}) {
    return (
        <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700/50 rounded-xl p-5 hover:border-gray-600/50 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-sm font-medium">{label}</span>
                <div className={`p-2 rounded-lg ${color}`}>
                    <Icon size={16} className="text-white" />
                </div>
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
    );
}

function EngagementRow({ label, value, icon: Icon, color }: {
    label: string; value: number; icon: any; color: string;
}) {
    return (
        <div className="flex items-center gap-3 py-2">
            <div className={`p-2 rounded-lg ${color}`}>
                <Icon size={14} className="text-white" />
            </div>
            <span className="text-gray-300 text-sm flex-1">{label}</span>
            <span className="text-white font-semibold text-sm">{fmtInt(value)}</span>
        </div>
    );
}

function CampaignRow({ campaign }: { campaign: CampaignAsset }) {
    const [expanded, setExpanded] = useState(false);
    const m = campaign.metrics || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
    const statusColor = campaign.status === 'ENABLE' || campaign.status === 'CAMPAIGN_STATUS_ENABLE'
        ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-400';

    return (
        <div className="border-b border-gray-700/50 last:border-b-0">
            <div
                className="flex items-center gap-3 py-3 px-4 cursor-pointer hover:bg-gray-700/20 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="text-gray-500">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{campaign.campaign_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>
                            {campaign.status === 'ENABLE' || campaign.status === 'CAMPAIGN_STATUS_ENABLE' ? 'Active' : campaign.status}
                        </span>
                        <span className="text-xs text-gray-500">{campaign.objective_type}</span>
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-6 text-right text-sm">
                    <div>
                        <p className="text-gray-400 text-xs">Spend</p>
                        <p className="text-white font-medium">${m.spend.toFixed(2)}</p>
                    </div>
                    <div>
                        <p className="text-gray-400 text-xs">Impressions</p>
                        <p className="text-white font-medium">{fmtInt(m.impressions)}</p>
                    </div>
                    <div>
                        <p className="text-gray-400 text-xs">Clicks</p>
                        <p className="text-white font-medium">{fmtInt(m.clicks)}</p>
                    </div>
                    <div>
                        <p className="text-gray-400 text-xs">ROAS</p>
                        <p className="text-white font-medium">
                            {m.spend > 0 ? (m.conversion_value / m.spend).toFixed(2) + 'x' : '—'}
                        </p>
                    </div>
                </div>
            </div>
            {expanded && campaign.ad_groups?.map(ag => (
                <AdGroupRow key={ag.id} adGroup={ag} />
            ))}
        </div>
    );
}

function AdGroupRow({ adGroup }: { adGroup: AdGroupAsset }) {
    const [expanded, setExpanded] = useState(false);
    const m = adGroup.metrics || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };

    return (
        <div className="ml-8">
            <div
                className="flex items-center gap-3 py-2 px-4 cursor-pointer hover:bg-gray-700/10 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="text-gray-600">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-gray-300 text-sm truncate">{adGroup.adgroup_name}</p>
                </div>
                <div className="grid grid-cols-4 gap-6 text-right text-xs">
                    <p className="text-gray-400">${m.spend.toFixed(2)}</p>
                    <p className="text-gray-400">{fmtInt(m.impressions)}</p>
                    <p className="text-gray-400">{fmtInt(m.clicks)}</p>
                    <p className="text-gray-400">
                        {m.spend > 0 ? (m.conversion_value / m.spend).toFixed(2) + 'x' : '—'}
                    </p>
                </div>
            </div>
            {expanded && adGroup.ads?.map(ad => (
                <AdRow key={ad.id} ad={ad} />
            ))}
        </div>
    );
}

function AdRow({ ad }: { ad: AdAsset }) {
    const m = ad.metrics || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
    return (
        <div className="ml-16 flex items-center gap-3 py-2 px-4 hover:bg-gray-700/10 transition-colors">
            <div className="w-3 h-3 rounded-full bg-gray-600"></div>
            <div className="flex-1 min-w-0">
                <p className="text-gray-400 text-xs truncate">{ad.ad_name}</p>
            </div>
            <div className="grid grid-cols-4 gap-6 text-right text-xs">
                <p className="text-gray-500">${m.spend.toFixed(2)}</p>
                <p className="text-gray-500">{fmtInt(m.impressions)}</p>
                <p className="text-gray-500">{fmtInt(m.clicks)}</p>
                <p className="text-gray-500">
                    {m.spend > 0 ? (m.conversion_value / m.spend).toFixed(2) + 'x' : '—'}
                </p>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function MarketingDashboardView({ account, shopId: _shopId }: MarketingDashboardViewProps) {
    const accountId = account.id;

    const {
        connected,
        isLoading,
        isSyncing,
        isSwitching,
        error,
        advertiserInfo,
        availableAdvertisers,
        dashboardData,
        gmvMaxSessions,
        audienceData,
        assets,
        lastFetchTime,
        checkConnection,
        connectTikTokAds,
        syncAdsData,
        fetchDashboard,
        fetchGmvMaxSessions,
        fetchAudienceData,
        fetchAssets,
        fetchAvailableAdvertisers,
        switchAdvertiser,
        disconnectTikTokAds,
        marketingDaily,
        marketingMetrics,
        marketingLoaded,
        marketingAccountId,
        marketingCampaigns,
        loadMarketingFromDB
    } = useTikTokAdsStore();

    const [dateRange, setDateRange] = useState<DateRange>(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 90); // Default to 90 days inclusive

        // Match DateRangePicker format and static timezone logic
        const tz = 'America/Los_Angeles';

        return {
            startDate: formatShopDateISO(start, tz),
            endDate: formatShopDateISO(end, tz),
        };
    });

    // Audience now uses the 90-day window (matches backend default)
    const AUDIENCE_END = formatShopDateISO(new Date(), 'America/Los_Angeles');
    const AUDIENCE_START = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        return formatShopDateISO(d, 'America/Los_Angeles');
    })();

    const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'audience'>('overview');
    const [showAdvertiserSwitcher, setShowAdvertiserSwitcher] = useState(false);
    const [hasCheckedConnection, setHasCheckedConnection] = useState(false);

    // Disconnect state
    const [showDisconnectModal, setShowDisconnectModal] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(null);

    // Check connection and load marketing data on mount (one-time per account)
    useEffect(() => {
        if (accountId) {
            checkConnection(accountId).then((isConnected) => {
                if (isConnected && (!marketingLoaded || marketingAccountId !== accountId)) {
                    loadMarketingFromDB(accountId);
                }
            }).finally(() => {
                setHasCheckedConnection(true);
            });
        } else {
            setHasCheckedConnection(true);
        }
    }, [accountId, checkConnection, loadMarketingFromDB, marketingLoaded, marketingAccountId]);

    // Fetch dashboard data when connected, with caching to avoid redundant calls
    // Fallback ONLY (when marketingLoaded is true but we never synced)
    useEffect(() => {
        if (!connected || !accountId) return;

        const desiredStart = dateRange.startDate;
        const desiredEnd = dateRange.endDate;
        const currentRange = dashboardData?.date_range;
        const sameRange =
            !!currentRange &&
            currentRange.start === desiredStart &&
            currentRange.end === desiredEnd;

        // Consider data "fresh" for 5 minutes
        const STALE_MS = 5 * 60 * 1000;
        const isFresh = typeof lastFetchTime === 'number'
            ? (Date.now() - lastFetchTime) < STALE_MS
            : false;

        // If we already have fresh data for this date range, skip refetch
        if (sameRange && isFresh && dashboardData) {
            return;
        }

        // Only use live API if DB returns no data AND we haven't synced
        const neverSynced = marketingLoaded && !advertiserInfo?.last_synced;
        if (neverSynced) {
            fetchDashboard(accountId, desiredStart, desiredEnd);
        }

        // Date-dependent static endpoints still need calling correctly
        // (but backend could be optimized later, keeping existing logic for assets)
        fetchAssets(accountId, desiredStart, desiredEnd);
    }, [
        accountId,
        connected,
        dateRange.startDate,
        dateRange.endDate,
        dashboardData,
        lastFetchTime,
        fetchDashboard,
        fetchAssets,
        marketingLoaded,
        advertiserInfo?.last_synced
    ]);

    // Date-independent endpoints fetch ONCE per account
    useEffect(() => {
        if (!connected || !accountId) return;
        // Clear stale data from previous account immediately
        useTikTokAdsStore.setState({ availableAdvertisers: null, gmvMaxSessions: null, audienceData: null });
        fetchAvailableAdvertisers(accountId);
        fetchGmvMaxSessions(accountId);
        fetchAudienceData(accountId, AUDIENCE_START, AUDIENCE_END);
    }, [accountId, connected, fetchAvailableAdvertisers, fetchGmvMaxSessions, fetchAudienceData]);

    // ─── LOCAL FILTERING (The Magic) ─────────────────────────────────────
    // If DB data is loaded, filter it locally by date range instead of calling the API
    const computedDashboardData = useMemo(() => {
        if (!marketingLoaded || !advertiserInfo?.last_synced) return null;

        const start = dateRange.startDate;
        const end = dateRange.endDate + 'T23:59:59';

        const filteredSpend = marketingDaily.filter((r: any) => r.spend_date >= start && r.spend_date <= end);

        // ONLY use the true account-level ADVERTISER rollup from database sync
        // Fall back to CAMPAIGN-level metrics if ADVERTISER records haven't been synced yet
        const advertiserMetrics = marketingMetrics.filter((r: any) =>
            r.stat_date >= start &&
            r.stat_date <= end &&
            r.dimension_type === 'ADVERTISER'
        );
        const filteredMetrics = advertiserMetrics.length > 0
            ? advertiserMetrics
            : marketingMetrics.filter((r: any) => r.stat_date >= start && r.stat_date <= end);

        const spendTotals = filteredSpend.reduce((acc: any, row: any) => ({
            spend: acc.spend + parseFloat(row.total_spend || '0'),
            impressions: acc.impressions + parseInt(row.total_impressions || '0'),
            clicks: acc.clicks + parseInt(row.total_clicks || '0'),
            conversions: acc.conversions + parseInt(row.total_conversions || '0'),
            conversion_value: acc.conversion_value + parseFloat(row.conversion_value || '0'),
        }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });

        const engagementAndVideo = filteredMetrics.reduce((acc: any, row: any) => ({
            impressions: acc.impressions + (row.impressions || 0),
            clicks: acc.clicks + (row.clicks || 0),
            reach: acc.reach + (row.reach || 0),
            spend: acc.spend + parseFloat(row.spend || '0'),
            likes: acc.likes + (row.likes || 0),
            comments: acc.comments + (row.comments || 0),
            shares: acc.shares + (row.shares || 0),
            follows: acc.follows + (row.follows || 0),
            profile_visits: acc.profile_visits + (row.profile_visits || 0),
            video_play_actions: acc.video_play_actions + (row.video_views || 0),
            video_watched_2s: acc.video_watched_2s + (row.video_watched_2s || 0),
            video_watched_6s: acc.video_watched_6s + (row.video_watched_6s || 0),
            video_views_p25: acc.video_views_p25 + (row.video_views_p25 || 0),
            video_views_p50: acc.video_views_p50 + (row.video_views_p50 || 0),
            video_views_p75: acc.video_views_p75 + (row.video_views_p75 || 0),
            video_views_p100: acc.video_views_p100 + (row.video_views_p100 || 0),
            conversions: acc.conversions + (row.conversions || 0),
            conversion_value: acc.conversion_value + parseFloat(row.conversion_value || '0'),
        }), {
            impressions: 0, clicks: 0, reach: 0, spend: 0,
            likes: 0, comments: 0, shares: 0, follows: 0, profile_visits: 0,
            video_play_actions: 0, video_watched_2s: 0, video_watched_6s: 0,
            video_views_p25: 0, video_views_p50: 0, video_views_p75: 0, video_views_p100: 0,
            conversions: 0, conversion_value: 0,
        });

        // Resolve data source conflicts
        const totalSpend = spendTotals.spend > 0 ? spendTotals.spend : engagementAndVideo.spend;
        const totalImpressions = spendTotals.impressions > 0 ? spendTotals.impressions : engagementAndVideo.impressions;
        const totalClicks = spendTotals.clicks > 0 ? spendTotals.clicks : engagementAndVideo.clicks;
        const totalConversions = spendTotals.conversions > 0 ? spendTotals.conversions : engagementAndVideo.conversions;
        const totalConversionValue = spendTotals.conversion_value > 0 ? spendTotals.conversion_value : engagementAndVideo.conversion_value;

        const roas = totalSpend > 0 && totalConversionValue > 0 ? totalConversionValue / totalSpend : 0;
        const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
        const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
        const conversion_rate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
        const cost_per_conversion = totalConversions > 0 ? totalSpend / totalConversions : 0;
        const frequency = engagementAndVideo.reach > 0 ? totalImpressions / engagementAndVideo.reach : 0;

        return {
            connected: true,
            last_synced: advertiserInfo.last_synced,
            kpis: {
                spend: totalSpend,
                gmv_max_spend: totalSpend,
                revenue: totalConversionValue,
                gmv_max_revenue: totalConversionValue,
                roas,
                impressions: totalImpressions,
                clicks: totalClicks,
                ctr,
                cpc,
                cpm,
                conversions: totalConversions,
                conversion_rate,
                cost_per_conversion,
                reach: engagementAndVideo.reach,
                frequency,
            },
            engagement: {
                likes: engagementAndVideo.likes,
                comments: engagementAndVideo.comments,
                shares: engagementAndVideo.shares,
                follows: engagementAndVideo.follows,
                profile_visits: engagementAndVideo.profile_visits,
            },
            video: {
                video_play_actions: engagementAndVideo.video_play_actions,
                video_watched_2s: engagementAndVideo.video_watched_2s,
                video_watched_6s: engagementAndVideo.video_watched_6s,
                video_views_p25: engagementAndVideo.video_views_p25,
                video_views_p50: engagementAndVideo.video_views_p50,
                video_views_p75: engagementAndVideo.video_views_p75,
                video_views_p100: engagementAndVideo.video_views_p100,
                engaged_view: 0,
                retention_2s: engagementAndVideo.video_play_actions > 0 ? (engagementAndVideo.video_watched_2s / engagementAndVideo.video_play_actions) * 100 : 0,
                retention_6s: engagementAndVideo.video_play_actions > 0 ? (engagementAndVideo.video_watched_6s / engagementAndVideo.video_play_actions) * 100 : 0,
                completion_rate: engagementAndVideo.video_play_actions > 0 ? (engagementAndVideo.video_views_p100 / engagementAndVideo.video_play_actions) * 100 : 0,
            },
            campaigns: marketingCampaigns,
            daily: filteredSpend.map((row: any) => ({
                date: (row.spend_date || '').slice(0, 10),
                spend: String(parseFloat(row.total_spend || '0')),
            })),
        };
    }, [marketingDaily, marketingMetrics, marketingLoaded, marketingCampaigns, dateRange, advertiserInfo]);

    const effectiveDashboardData = computedDashboardData || dashboardData;

    // Handle sync
    const handleSync = useCallback(async () => {
        if (!accountId) return;
        await syncAdsData(accountId); // No date override — backend uses 120-day default
        // State updates via syncAdsData
    }, [accountId, syncAdsData]);

    const handleSwitchAdvertiser = useCallback(async (advertiserId: string) => {
        if (!accountId) return;
        setShowAdvertiserSwitcher(false);
        await switchAdvertiser(accountId, advertiserId);
        // Switch clears state, the component effect will reconnect
    }, [accountId, switchAdvertiser]);

    // Handle Disconnection
    const handleDisconnect = async () => {
        if (!accountId || isDisconnecting) return;
        setIsDisconnecting(true);

        const success = await disconnectTikTokAds(accountId);
        if (success) {
            // Start countdown
            setDisconnectCountdown(5);
            const interval = setInterval(() => {
                setDisconnectCountdown(prev => {
                    if (prev === null || prev <= 1) {
                        clearInterval(interval);
                        window.location.href = 'https://ads.tiktok.com/ac/page/authorizations';
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            setIsDisconnecting(false);
            setShowDisconnectModal(false);
        }
    };

    // Daily chart data
    const dailyChartData = useMemo(() => {
        if (!effectiveDashboardData?.daily) return [];
        return effectiveDashboardData.daily
            .filter((d: any) => d.date)
            .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
            .map((d: any) => ({ date: d.date?.slice(0, 10) || '', value: parseFloat(d.spend || '0') }));
    }, [effectiveDashboardData]);

    const kpis = effectiveDashboardData?.kpis;
    const eng = effectiveDashboardData?.engagement;
    const vid = effectiveDashboardData?.video;

    // ─── LOADING ─────────────────────────────────────────────────────────
    if (!hasCheckedConnection || (isLoading && !effectiveDashboardData)) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <RefreshCw size={32} className="text-indigo-400 animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading marketing data...</p>
                </div>
            </div>
        );
    }

    // ─── NOT CONNECTED ───────────────────────────────────────────────────
    if (!connected && !isLoading && hasCheckedConnection) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-10 text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Megaphone size={28} className="text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">Connect TikTok Ads</h2>
                    <p className="text-gray-400 mb-6 max-w-md mx-auto">
                        Link your TikTok Ads account to track campaign performance, ad spend, ROAS, and GMV Max metrics all in one place.
                    </p>
                    <button
                        onClick={() => connectTikTokAds(accountId)}
                        className="px-6 py-3 bg-gradient-to-r from-pink-600 to-red-600 hover:from-pink-500 hover:to-red-500 text-white font-semibold rounded-xl transition-all duration-200 flex items-center gap-2 mx-auto"
                    >
                        <Link2 size={18} />
                        Connect Account
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* ─── HEADER ─────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Marketing</h1>
                    <div className="flex items-center gap-3 mt-1">
                        {advertiserInfo && (
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        if (!availableAdvertisers) fetchAvailableAdvertisers(accountId);
                                        setShowAdvertiserSwitcher(!showAdvertiserSwitcher);
                                    }}
                                    className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                                >
                                    <span>{advertiserInfo.name}</span>
                                    <ChevronDown size={14} />
                                </button>
                                {showAdvertiserSwitcher && availableAdvertisers && (
                                    <div className="absolute top-full left-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                                        {availableAdvertisers.map(adv => (
                                            <button
                                                key={adv.advertiser_id}
                                                onClick={() => handleSwitchAdvertiser(adv.advertiser_id)}
                                                disabled={isSwitching}
                                                className={`w-full text-left px-4 py-3 hover:bg-gray-700/50 transition-colors ${adv.is_current ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''
                                                    }`}
                                            >
                                                <p className="text-white text-sm font-medium">{adv.name}</p>
                                                <p className="text-gray-500 text-xs">{adv.advertiser_id} · {adv.currency}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {advertiserInfo && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-800/80 border border-gray-700 text-xs text-gray-300">
                                <DollarSign size={12} className="text-emerald-400" />
                                <span>Balance: {fmtCurrency(advertiserInfo.balance || 0)}</span>
                                {advertiserInfo.currency && (
                                    <span className="text-gray-500 ml-1">{advertiserInfo.currency}</span>
                                )}
                            </span>
                        )}
                        {effectiveDashboardData?.last_synced && (
                            <span className="text-xs text-gray-500">
                                Synced {new Date(effectiveDashboardData.last_synced).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <DateRangePicker
                        value={dateRange}
                        onChange={(range: DateRange) => setDateRange(range)}
                    />
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="p-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 hover:text-white rounded-xl transition-all duration-200 disabled:opacity-50"
                        title="Sync ads data"
                    >
                        <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* ERROR */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
                    {error}
                </div>
            )}

            {/* ─── SCOPE STATUS ───────────────────────────────────────── */}
            {advertiserInfo && (() => {
                const scopes = advertiserInfo.granted_scopes || '';
                const requiredScopes = [
                    { key: 'advertiser.gmv_max', label: 'GMV Max' },
                    { key: 'advertiser.report', label: 'Reporting' },
                    { key: 'advertiser.ads_management', label: 'Ads Management' },
                    { key: 'advertiser.audience_management', label: 'Audience' },
                ];
                // Check if scopes is a stringified JSON array (e.g. "[1,2,3]")
                let isNumericArray = false;
                try {
                    const parsed = JSON.parse(scopes);
                    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
                        isNumericArray = true;
                    }
                } catch (e) {
                    // Not a JSON array, proceed normally
                }

                const granted = requiredScopes.filter(s => isNumericArray || scopes.includes(s.key));
                const missing = requiredScopes.filter(s => !isNumericArray && !scopes.includes(s.key));
                const allGranted = isNumericArray || missing.length === 0;

                // Only show the banner or details if the dashboard data has finished loading
                if (!effectiveDashboardData || isLoading) return null;

                const noScopes = (!scopes || scopes === '[]');

                if (noScopes) {
                    return (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-amber-400 text-sm font-semibold flex items-center gap-2">
                                    <Zap size={16} />
                                    OAuth Scopes Not Configured
                                </p>
                                <p className="text-amber-400/70 text-xs mt-1">
                                    Your token was issued before scopes were added. Re-authorize to unlock GMV Max, Reporting, and Audience data.
                                </p>
                            </div>
                            <button
                                onClick={() => connectTikTokAds(accountId)}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                            >
                                Re-authorize
                            </button>
                        </div>
                    );
                }

                return (
                    <details className={`rounded-xl border ${allGranted ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/30'}`}>
                        <summary className="px-4 py-3 cursor-pointer text-sm font-medium flex items-center gap-2 select-none">
                            <span className={allGranted ? 'text-emerald-400' : 'text-amber-400'}>
                                {allGranted ? '✓' : '⚠'}
                            </span>
                            <span className={allGranted ? 'text-emerald-400' : 'text-amber-400'}>
                                {allGranted
                                    ? (isNumericArray ? 'Scopes granted (Internal IDs)' : 'All scopes granted')
                                    : `${missing.length} scope${missing.length > 1 ? 's' : ''} missing`}
                            </span>
                        </summary>
                        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                            {granted.map(s => (
                                <span key={s.key} className="px-2.5 py-1 text-xs font-medium bg-emerald-500/15 text-emerald-400 rounded-lg">
                                    ✓ {s.label}
                                </span>
                            ))}
                            {missing.map(s => (
                                <span key={s.key} className="px-2.5 py-1 text-xs font-medium bg-red-500/15 text-red-400 rounded-lg">
                                    ✗ {s.label}
                                </span>
                            ))}
                            {missing.length > 0 && (
                                <button
                                    onClick={() => connectTikTokAds(accountId)}
                                    className="ml-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                    Re-authorize
                                </button>
                            )}
                        </div>
                    </details>
                );
            })()}

            {/* ─── TAB BAR ────────────────────────────────────────────────── */}
            <div className="flex gap-1 bg-gray-800/50 p-1 rounded-xl w-fit">
                {[
                    { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
                    { id: 'campaigns' as const, label: 'Campaigns', icon: Megaphone },
                    { id: 'audience' as const, label: 'Audience', icon: Users },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === tab.id
                            ? 'bg-gray-700 text-white shadow-sm'
                            : 'text-gray-400 hover:text-gray-300'
                            }`}
                    >
                        <tab.icon size={15} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ─── OVERVIEW TAB ────────────────────────────────────────────── */}
            {activeTab === 'overview' && kpis && (
                <div className="space-y-6">
                    {/* Primary KPI rows — financial metrics (2 rows × 3 cards) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <KpiCard
                            label="Cost"
                            value={fmtCurrency(kpis.spend || 0)}
                            icon={DollarSign}
                            color="bg-amber-500/20"
                            subtitle="Total ad spend"
                        />
                        <KpiCard
                            label="Orders"
                            value={fmtInt(kpis.conversions || 0)}
                            icon={Megaphone}
                            color="bg-emerald-500/20"
                            subtitle="Attributed orders"
                        />
                        <KpiCard
                            label="Cost per Order"
                            value={fmtCurrency(kpis.cost_per_conversion || 0)}
                            icon={DollarSign}
                            color="bg-orange-500/20"
                            subtitle="Average cost per order"
                        />
                        <KpiCard
                            label="Gross Revenue"
                            value={fmtCurrency(kpis.gmv_max_revenue || kpis.revenue || 0)}
                            icon={TrendingUp}
                            color="bg-purple-500/20"
                            subtitle={`All GMV Max revenue`}
                        />
                        <KpiCard
                            label="ROI (GMV Max)"
                            value={kpis.gmv_max_spend > 0 && (kpis.gmv_max_revenue || 0) > 0
                                ? `${((kpis.gmv_max_revenue || 0) / kpis.gmv_max_spend).toFixed(2)}x`
                                : '—'}
                            icon={Target}
                            color="bg-blue-500/20"
                            subtitle="GMV Max only"
                        />
                        <KpiCard
                            label="ROAS (Blended)"
                            value={`${kpis.roas.toFixed(2)}x`}
                            icon={BarChart3}
                            color="bg-indigo-500/20"
                            subtitle="All campaigns"
                        />
                    </div>

                    {/* Daily Spend Chart (Recharts) */}
                    <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                            <Calendar size={16} className="text-indigo-400" />
                            Daily Ad Spend
                        </h3>
                        {dailyChartData.length === 0 ? (
                            <p className="text-gray-500 text-sm py-8 text-center">No spend data in this range</p>
                        ) : (
                            <div className="w-full h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart
                                        data={dailyChartData.map(d => ({ date: d.date, spend: d.value }))}
                                        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                                    >
                                        <defs>
                                            <linearGradient id="adSpendGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#6366F1" stopOpacity={0.35} />
                                                <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                            tickLine={false}
                                            axisLine={{ stroke: '#4B5563' }}
                                        />
                                        <YAxis
                                            tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                                            tickLine={false}
                                            axisLine={{ stroke: '#4B5563' }}
                                        />
                                        <RechartsTooltip
                                            contentStyle={{ backgroundColor: '#020617', borderColor: '#4B5563' }}
                                            labelStyle={{ color: '#E5E7EB', fontSize: 12 }}
                                            formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`, 'Spend']}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="spend"
                                            stroke="#6366F1"
                                            strokeWidth={2}
                                            fill="url(#adSpendGradient)"
                                            name="Spend"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* Secondary KPIs — delivery context under financial cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <KpiCard
                            label="Impressions"
                            value={fmt(kpis.impressions, 0)}
                            icon={Eye}
                            color="bg-slate-500/20"
                            subtitle={`CPM: $${kpis.cpm.toFixed(2)}`}
                        />
                        <KpiCard
                            label="Clicks"
                            value={fmtInt(kpis.clicks)}
                            icon={MousePointerClick}
                            color="bg-pink-500/20"
                            subtitle={`CTR: ${fmtPct(kpis.ctr)}`}
                        />
                        <KpiCard
                            label="Reach & Frequency"
                            value={kpis.reach > 0 ? fmtInt(kpis.reach) : '—'}
                            icon={Users}
                            color="bg-cyan-500/20"
                            subtitle={kpis.frequency > 0 ? `Freq: ${kpis.frequency.toFixed(2)}x` : 'No reach yet'}
                        />
                    </div>

                    {/* Engagement + Video side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Engagement */}
                        {eng && (
                            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <Heart size={16} className="text-pink-400" />
                                    Engagement
                                </h3>
                                <div className="divide-y divide-gray-700/50">
                                    <EngagementRow label="Likes" value={eng.likes} icon={Heart} color="bg-pink-500/20" />
                                    <EngagementRow label="Comments" value={eng.comments} icon={MessageCircle} color="bg-blue-500/20" />
                                    <EngagementRow label="Shares" value={eng.shares} icon={Share2} color="bg-green-500/20" />
                                    <EngagementRow label="Follows" value={eng.follows} icon={UserPlus} color="bg-purple-500/20" />
                                    <EngagementRow label="Profile Visits" value={eng.profile_visits} icon={Eye} color="bg-cyan-500/20" />
                                </div>
                            </div>
                        )}

                        {/* Video */}
                        {vid && vid.video_play_actions > 0 && (
                            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <Video size={16} className="text-indigo-400" />
                                    Video Performance
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-400">Total Plays</span>
                                        <span className="text-white font-semibold">{fmtInt(vid.video_play_actions)}</span>
                                    </div>
                                    {/* Retention funnel */}
                                    <div className="space-y-2">
                                        {[
                                            { label: '2s Retention', pct: vid.retention_2s, count: vid.video_watched_2s },
                                            { label: '6s Retention', pct: vid.retention_6s, count: vid.video_watched_6s },
                                            { label: 'Completion', pct: vid.completion_rate, count: vid.video_views_p100 },
                                        ].map(item => (
                                            <div key={item.label}>
                                                <div className="flex justify-between text-xs mb-1">
                                                    <span className="text-gray-400">{item.label}</span>
                                                    <span className="text-gray-300">{fmtPct(item.pct)} ({fmtInt(item.count)})</span>
                                                </div>
                                                <div className="w-full bg-gray-700/50 rounded-full h-1.5">
                                                    <div
                                                        className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                                        style={{ width: `${Math.min(item.pct, 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* View funnel */}
                                    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-gray-700/50">
                                        {[
                                            { label: '25%', value: vid.video_views_p25 },
                                            { label: '50%', value: vid.video_views_p50 },
                                            { label: '75%', value: vid.video_views_p75 },
                                            { label: '100%', value: vid.video_views_p100 },
                                        ].map(v => (
                                            <div key={v.label} className="text-center">
                                                <p className="text-xs text-gray-500">{v.label}</p>
                                                <p className="text-sm text-white font-medium">{fmt(v.value, 0)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* GMV Max Sessions */}
                    {gmvMaxSessions && gmvMaxSessions.length > 0 && (
                        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                <Zap size={16} className="text-amber-400" />
                                GMV Max Sessions
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-gray-500 text-xs border-b border-gray-700/50">
                                            <th className="text-left py-2 font-medium">Session</th>
                                            <th className="text-right py-2 font-medium">Status</th>
                                            <th className="text-right py-2 font-medium">Budget</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {gmvMaxSessions.map((session: any, i: number) => (
                                            <tr key={i} className="border-b border-gray-700/30 last:border-b-0">
                                                <td className="py-2.5 text-white">{session.session_name || session.campaign_name || `Session ${i + 1}`}</td>
                                                <td className="py-2.5 text-right">
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${session.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-400'
                                                        }`}>
                                                        {session.status || 'Unknown'}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 text-right text-gray-300">{session.budget ? fmtCurrency(parseFloat(session.budget)) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── CAMPAIGNS TAB ───────────────────────────────────────────── */}
            {activeTab === 'campaigns' && (
                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between">
                        <h3 className="text-white font-semibold flex items-center gap-2">
                            <Megaphone size={16} className="text-pink-400" />
                            Campaign Performance
                        </h3>
                        {assets && (
                            <span className="text-xs text-gray-500">
                                {assets.counts.campaigns} campaigns · {assets.counts.ad_groups} ad groups · {assets.counts.ads} ads
                            </span>
                        )}
                    </div>
                    {/* Column headers */}
                    <div className="flex items-center gap-3 py-2 px-4 bg-gray-900/30 border-b border-gray-700/50 text-xs text-gray-500">
                        <span className="w-6" />
                        <span className="flex-1">Campaign</span>
                        <div className="grid grid-cols-4 gap-6 text-right">
                            <span>Spend</span>
                            <span>Impressions</span>
                            <span>Clicks</span>
                            <span>ROAS</span>
                        </div>
                    </div>
                    {assets?.hierarchy && assets.hierarchy.length > 0 ? (
                        assets.hierarchy.map(campaign => (
                            <CampaignRow key={campaign.id} campaign={campaign} />
                        ))
                    ) : (
                        <div className="p-10 text-center text-gray-500">
                            <Megaphone size={32} className="mx-auto mb-3 opacity-50" />
                            <p>No campaigns found. Click Sync to fetch the latest data.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ─── AUDIENCE TAB ────────────────────────────────────────────── */}
            {activeTab === 'audience' && (
                <div className="space-y-6">
                    {audienceData && (audienceData.age.length > 0 || audienceData.gender.length > 0 || audienceData.country.length > 0) ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Age */}
                            {audienceData.age.length > 0 && (
                                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                        <Users size={16} className="text-blue-400" />
                                        Age Distribution
                                    </h3>
                                    <div className="space-y-3">
                                        {audienceData.age.map((row: any, i: number) => {
                                            const spend = parseFloat(row.metrics?.spend || '0');
                                            const maxSpend = Math.max(...audienceData.age.map((r: any) => parseFloat(r.metrics?.spend || '0')), 1);
                                            return (
                                                <div key={i}>
                                                    <div className="flex justify-between text-xs mb-1">
                                                        <span className="text-gray-300">{row.dimensions?.age || `Age ${i}`}</span>
                                                        <span className="text-gray-400">${spend.toFixed(2)}</span>
                                                    </div>
                                                    <div className="w-full bg-gray-700/50 rounded-full h-2">
                                                        <div className="h-2 rounded-full bg-blue-500/70" style={{ width: `${(spend / maxSpend) * 100}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Gender */}
                            {audienceData.gender.length > 0 && (
                                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                        <Users size={16} className="text-pink-400" />
                                        Gender Distribution
                                    </h3>
                                    <div className="space-y-3">
                                        {audienceData.gender.map((row: any, i: number) => {
                                            const spend = parseFloat(row.metrics?.spend || '0');
                                            const totalSpend = audienceData.gender.reduce((s: number, r: any) => s + parseFloat(r.metrics?.spend || '0'), 0) || 1;
                                            const pct = (spend / totalSpend) * 100;
                                            const genderLabel = row.dimensions?.gender === 'MALE' ? '♂ Male' : row.dimensions?.gender === 'FEMALE' ? '♀ Female' : row.dimensions?.gender || `Gender ${i}`;
                                            return (
                                                <div key={i} className="flex items-center gap-3">
                                                    <span className="text-gray-300 text-sm w-24">{genderLabel}</span>
                                                    <div className="flex-1 bg-gray-700/50 rounded-full h-2">
                                                        <div className="h-2 rounded-full bg-pink-500/70" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-gray-400 text-xs w-12 text-right">{pct.toFixed(1)}%</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Country */}
                            {audienceData.country.length > 0 && (
                                <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
                                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                                        <Globe size={16} className="text-green-400" />
                                        Top Countries
                                    </h3>
                                    <div className="space-y-2">
                                        {audienceData.country.slice(0, 10).map((row: any, i: number) => {
                                            const spend = parseFloat(row.metrics?.spend || '0');
                                            const clicks = parseInt(row.metrics?.clicks || '0');
                                            return (
                                                <div key={i} className="flex items-center justify-between text-sm py-1">
                                                    <span className="text-gray-300">{row.dimensions?.country_code || 'Unknown'}</span>
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-gray-400 text-xs">{fmtInt(clicks)} clicks</span>
                                                        <span className="text-white font-medium">${spend.toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-10 text-center">
                            <Users size={32} className="mx-auto mb-3 text-gray-500 opacity-50" />
                            <p className="text-gray-400">No audience data available for this date range.</p>
                            <p className="text-gray-500 text-sm mt-1">Audience reports require active campaigns with impressions.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ─── DANGER ZONE ────────────────────────────────────────────── */}
            <div className="mt-12 pt-8 border-t border-red-900/30">
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                            <AlertTriangle size={20} />
                            Danger Zone
                        </h3>
                        <p className="text-gray-400 text-sm mt-1 max-w-xl">
                            Disconnecting your TikTok Ads account will permanently delete all synced campaigns, metrics, and authentication tokens from Mamba's database.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowDisconnectModal(true)}
                        className="px-6 py-2.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 border border-red-500/30 rounded-xl font-medium transition-all duration-200 whitespace-nowrap flex items-center gap-2"
                    >
                        <LogOut size={18} />
                        Disconnect Account
                    </button>
                </div>
            </div>

            {/* ─── DISCONNECT MODAL ───────────────────────────────────────── */}
            {showDisconnectModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
                        {/* 5-second countdown mode active */}
                        {disconnectCountdown !== null ? (
                            <div className="text-center space-y-6 py-4">
                                <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                                    <AlertTriangle size={32} className="text-red-500" />
                                </div>
                                <h3 className="text-xl font-bold text-white">Connection Purged</h3>
                                <p className="text-gray-400 text-sm leading-relaxed">
                                    Your data has been permanently deleted from Mamba.
                                    <br /><br />
                                    <strong className="text-white">Crucial Next Step:</strong> You must now revoke access from within your TikTok Ads dashboard to prevent future syncs.
                                </p>

                                <div className="p-4 bg-gray-800 rounded-xl space-y-3">
                                    <p className="text-sm font-medium text-gray-300">
                                        Redirecting to TikTok Security Settings in <strong className="text-white text-lg ml-1">{disconnectCountdown}s</strong>
                                    </p>
                                    <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className="bg-red-500 h-full transition-all duration-1000 ease-linear"
                                            style={{ width: `${(disconnectCountdown / 5) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                <a
                                    href="https://ads.tiktok.com/ac/page/authorizations"
                                    className="block w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors"
                                >
                                    Redirect Now
                                </a>
                            </div>
                        ) : (
                            /* Initial confirmation mode */
                            <div className="space-y-6">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                                        <LogOut size={24} className="text-red-500" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white mb-2">Disconnect Ads Account?</h3>
                                        <p className="text-sm text-gray-400">
                                            This will instantly delete all cached campaigns, ads, metrics, and your secure token from our database.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowDisconnectModal(false)}
                                        disabled={isDisconnecting}
                                        className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDisconnect}
                                        disabled={isDisconnecting}
                                        className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                                    >
                                        {isDisconnecting ? <RefreshCw size={18} className="animate-spin" /> : "Purge Data"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
