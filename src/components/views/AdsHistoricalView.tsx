import { useState, useEffect } from 'react';
import { useTikTokAdsStore } from '../../store/useTikTokAdsStore';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { Search, Calendar, ExternalLink, Video, Image } from 'lucide-react';
import { formatShopDateISO } from '../../utils/dateUtils';

interface AdsHistoricalViewProps {
    accountId: string;
    defaultDateRange?: DateRange;
    timezone?: string;
}

export function AdsHistoricalView({ accountId, defaultDateRange, timezone = 'America/Los_Angeles' }: AdsHistoricalViewProps) {
    const { fetchHistoricalAds } = useTikTokAdsStore();
    const [loading, setLoading] = useState(false);
    const [ads, setAds] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<DateRange>(() => {
        if (defaultDateRange) return defaultDateRange;

        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 365);
        return {
            startDate: formatShopDateISO(start, timezone),
            endDate: formatShopDateISO(end, timezone)
        };
    });

    const loadData = async () => {
        if (!accountId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchHistoricalAds(accountId, dateRange.startDate, dateRange.endDate);
            setAds(data || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load historical data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [accountId, dateRange]);

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    const formatNumber = (val: number) => new Intl.NumberFormat('en-US').format(val);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                    <h2 className="text-lg font-medium text-white">Historical Performance</h2>
                    <p className="text-sm text-gray-400">Analyze ad performance over custom date ranges</p>
                </div>
                <div className="flex items-center gap-3">
                    <DateRangePicker value={dateRange} onChange={setDateRange} timezone={timezone} />
                    <button
                        onClick={loadData}
                        className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                        disabled={loading}
                    >
                        <Search className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center items-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
            ) : ads.length === 0 ? (
                <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700/50">
                    <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">No ads found for this period</p>
                    <p className="text-sm text-gray-500 mt-1">Try selecting a different date range</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-xs mb-1">Total Spend</p>
                            <p className="text-xl font-bold text-white">
                                {formatCurrency(ads.reduce((acc, ad) => acc + ad.metrics.spend, 0))}
                            </p>
                        </div>
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-xs mb-1">Total Conversions</p>
                            <p className="text-xl font-bold text-green-400">
                                {formatNumber(ads.reduce((acc, ad) => acc + ad.metrics.conversions, 0))}
                            </p>
                        </div>
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-xs mb-1">Total Impressions</p>
                            <p className="text-xl font-bold text-white">
                                {formatNumber(ads.reduce((acc, ad) => acc + ad.metrics.impressions, 0))}
                            </p>
                        </div>
                        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-xs mb-1">Avg ROAS</p>
                            <p className="text-xl font-bold text-yellow-400">
                                {(ads.reduce((acc, ad) => acc + ad.metrics.conversion_value, 0) / (ads.reduce((acc, ad) => acc + ad.metrics.spend, 0) || 1)).toFixed(2)}x
                            </p>
                        </div>
                    </div>

                    {/* Ads List */}
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs font-medium">
                                    <tr>
                                        <th className="px-4 py-3">Ad Details</th>
                                        <th className="px-4 py-3 text-right">Spend</th>
                                        <th className="px-4 py-3 text-right">Impressions</th>
                                        <th className="px-4 py-3 text-right">Clicks</th>
                                        <th className="px-4 py-3 text-right">CTR</th>
                                        <th className="px-4 py-3 text-right">Conv.</th>
                                        <th className="px-4 py-3 text-right">CPA</th>
                                        <th className="px-4 py-3 text-right">ROAS</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/50">
                                    {ads.map((ad) => (
                                        <tr key={ad.id} className="hover:bg-gray-700/20 transition-colors">
                                            <td className="px-4 py-3 max-w-[300px]">
                                                <div className="flex items-start gap-3">
                                                    <div className={`p-1.5 rounded-lg shrink-0 ${(ad.video_id || ad.tiktok_item_id) ? 'bg-purple-500/10 text-purple-400' : 'bg-gray-500/10 text-gray-400'
                                                        }`}>
                                                        {(ad.video_id || ad.tiktok_item_id) ? <Video className="w-4 h-4" /> : <Image className="w-4 h-4" />}
                                                    </div>
                                                    <div>
                                                        <p className="text-white font-medium truncate">{ad.ad_name}</p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="text-xs text-gray-500 font-mono">{ad.ad_id}</span>
                                                            {(ad.video_id || ad.tiktok_item_id) && (
                                                                <a
                                                                    href={`https://www.tiktok.com/video/${ad.video_id || ad.tiktok_item_id}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs text-purple-400 hover:underline flex items-center gap-0.5"
                                                                >
                                                                    View Video <ExternalLink className="w-3 h-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium text-white">
                                                {formatCurrency(ad.metrics.spend)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-300">
                                                {formatNumber(ad.metrics.impressions)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-300">
                                                {formatNumber(ad.metrics.clicks)}
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-300">
                                                {ad.metrics.ctr.toFixed(2)}%
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`${ad.metrics.conversions > 0 ? 'text-green-400 font-medium' : 'text-gray-400'}`}>
                                                    {formatNumber(ad.metrics.conversions)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-300">
                                                {formatCurrency(ad.metrics.cpa)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`${ad.metrics.roas >= 2 ? 'text-green-400 font-bold' :
                                                    ad.metrics.roas >= 1 ? 'text-yellow-400 font-medium' :
                                                        'text-gray-400'
                                                    }`}>
                                                    {ad.metrics.roas.toFixed(2)}x
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
