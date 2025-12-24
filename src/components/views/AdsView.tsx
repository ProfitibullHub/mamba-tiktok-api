import { TrendingUp, DollarSign, MousePointer, Eye, Target } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { useKPIData } from '../../hooks/useKPIData';
import { Account, AdCampaign, supabase } from '../../lib/supabase';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface AdsViewProps {
  account: Account;
}

const getDefaultDateRange = (): DateRange => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
};

export function AdsView({ account }: AdsViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const { data, loading, aggregateMetrics } = useKPIData(account, 'ads', dateRange);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  useEffect(() => {
    fetchCampaigns();
  }, [account.id, account.is_agency_view, dateRange]);

  const fetchCampaigns = async () => {
    try {
      setCampaignsLoading(true);
      let query = supabase.from('ad_campaigns').select('*');

      if (!account.is_agency_view) {
        query = query.eq('account_id', account.id);
      }

      query = query
        .gte('start_date', dateRange.startDate)
        .lte('start_date', dateRange.endDate)
        .order('created_at', { ascending: false });

      const { data: campaignsData, error } = await query;
      if (error) throw error;
      setCampaigns(campaignsData || []);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
    } finally {
      setCampaignsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  const metrics = aggregateMetrics(data);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCurrency = (num: number): string => {
    return `$${formatNumber(num)}`;
  };

  const ctr = metrics?.clicks && metrics?.impressions
    ? ((metrics.clicks / metrics.impressions) * 100).toFixed(2)
    : '0.00';

  const roas = metrics?.revenue && metrics?.spend
    ? (metrics.revenue / metrics.spend).toFixed(2)
    : '0.00';

  const cpc = metrics?.clicks && metrics?.spend
    ? (metrics.spend / metrics.clicks).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Ads Performance</h2>
          <p className="text-gray-400">Track your TikTok ad campaigns and ROI</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Impressions"
          value={formatNumber(metrics?.impressions || 0)}
          change={12.3}
          icon={Eye}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Total Clicks"
          value={formatNumber(metrics?.clicks || 0)}
          change={8.7}
          icon={MousePointer}
          iconColor="bg-gradient-to-r from-orange-500 to-red-500"
        />
        <StatCard
          title="Total Spend"
          value={formatCurrency(metrics?.spend || 0)}
          change={5.2}
          icon={DollarSign}
          iconColor="bg-gradient-to-r from-red-500 to-pink-500"
        />
        <StatCard
          title="Revenue"
          value={formatCurrency(metrics?.revenue || 0)}
          change={15.8}
          icon={TrendingUp}
          iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Campaign Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Click-Through Rate"
            value={`${ctr}%`}
            change={3.2}
            icon={Target}
            iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
          />
          <StatCard
            title="Return on Ad Spend"
            value={`${roas}x`}
            change={10.5}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-teal-500 to-green-500"
          />
          <StatCard
            title="Cost Per Click"
            value={`$${cpc}`}
            change={-4.3}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-indigo-500 to-blue-500"
          />
          <StatCard
            title="Conversions"
            value={formatNumber(metrics?.conversions || 0)}
            change={7.8}
            icon={Target}
            iconColor="bg-gradient-to-r from-pink-500 to-red-500"
          />
          <StatCard
            title="Cost Per Conversion"
            value={metrics?.conversions ? `$${(metrics.spend / metrics.conversions).toFixed(2)}` : '$0.00'}
            change={-2.1}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-yellow-500 to-orange-500"
          />
          <StatCard
            title="Conversion Rate"
            value={`${metrics?.clicks ? ((metrics.conversions / metrics.clicks) * 100).toFixed(2) : '0.00'}%`}
            change={5.6}
            icon={Target}
            iconColor="bg-gradient-to-r from-green-500 to-teal-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Individual Campaigns</h3>
        {campaignsLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-pink-500 border-t-transparent"></div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
            <p className="text-gray-400">No campaigns found</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Campaign</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Impressions</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Clicks</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">CTR</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Conversions</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Spend</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Revenue</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {campaigns.map((campaign) => {
                    const ctr = campaign.impressions > 0
                      ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2)
                      : '0.00';
                    const roas = campaign.spend > 0
                      ? (campaign.revenue / campaign.spend).toFixed(2)
                      : '0.00';

                    return (
                      <tr key={campaign.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-white font-medium">{campaign.name}</p>
                            <p className="text-sm text-gray-400">{new Date(campaign.start_date).toLocaleDateString()}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            campaign.status === 'active'
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : campaign.status === 'paused'
                              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                              : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                          }`}>
                            {campaign.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(campaign.impressions)}</td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(campaign.clicks)}</td>
                        <td className="px-6 py-4 text-right text-white">{ctr}%</td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(campaign.conversions)}</td>
                        <td className="px-6 py-4 text-right text-white">{formatCurrency(campaign.spend)}</td>
                        <td className="px-6 py-4 text-right text-green-400 font-medium">{formatCurrency(campaign.revenue)}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-medium ${
                            parseFloat(roas) >= 3 ? 'text-green-400' : parseFloat(roas) >= 2 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {roas}x
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
