import { ShoppingBag, DollarSign, TrendingUp, Package, CreditCard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { useKPIData } from '../../hooks/useKPIData';
import { Account, SalesCampaign, supabase } from '../../lib/supabase';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface SalesViewProps {
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

export function SalesView({ account }: SalesViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const { data, loading, aggregateMetrics } = useKPIData(account, 'sales', dateRange);
  const [campaigns, setCampaigns] = useState<SalesCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  useEffect(() => {
    fetchCampaigns();
  }, [account.id, account.is_agency_view, dateRange]);

  const fetchCampaigns = async () => {
    try {
      setCampaignsLoading(true);
      let query = supabase.from('sales_campaigns').select('*');

      if (!account.is_agency_view) {
        query = query.eq('account_id', account.id);
      }

      query = query
        .gte('start_date', dateRange.startDate)
        .lte('start_date', dateRange.endDate)
        .order('revenue', { ascending: false });

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

  const avgOrderValue = metrics?.conversions
    ? (metrics.revenue / metrics.conversions).toFixed(2)
    : '0.00';

  const profit = (metrics?.revenue || 0) - (metrics?.spend || 0);
  const profitMargin = metrics?.revenue
    ? ((profit / metrics.revenue) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Sales Performance</h2>
          <p className="text-gray-400">Monitor your TikTok Shop sales and revenue</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Revenue"
          value={formatCurrency(metrics?.revenue || 0)}
          change={18.4}
          icon={DollarSign}
          iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
        />
        <StatCard
          title="Total Orders"
          value={formatNumber(metrics?.conversions || 0)}
          change={12.7}
          icon={ShoppingBag}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Avg Order Value"
          value={`$${avgOrderValue}`}
          change={5.3}
          icon={CreditCard}
          iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
        />
        <StatCard
          title="Profit"
          value={formatCurrency(profit)}
          change={22.1}
          icon={TrendingUp}
          iconColor="bg-gradient-to-r from-teal-500 to-green-500"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Financial Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Total Spend"
            value={formatCurrency(metrics?.spend || 0)}
            change={8.9}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-red-500 to-pink-500"
            subtitle="Marketing costs"
          />
          <StatCard
            title="Profit Margin"
            value={`${profitMargin}%`}
            change={3.5}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-green-500 to-teal-500"
          />
          <StatCard
            title="Products Sold"
            value={formatNumber(metrics?.conversions || 0)}
            change={15.2}
            icon={Package}
            iconColor="bg-gradient-to-r from-indigo-500 to-purple-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Conversion Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Total Impressions"
            value={formatNumber(metrics?.impressions || 0)}
            change={10.3}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
          />
          <StatCard
            title="Conversion Rate"
            value={`${metrics?.clicks ? ((metrics.conversions / metrics.clicks) * 100).toFixed(2) : '0.00'}%`}
            change={7.1}
            icon={ShoppingBag}
            iconColor="bg-gradient-to-r from-pink-500 to-red-500"
          />
          <StatCard
            title="ROAS"
            value={`${metrics?.spend ? (metrics.revenue / metrics.spend).toFixed(2) : '0.00'}x`}
            change={12.8}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
            subtitle="Return on ad spend"
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
            <p className="text-gray-400">No sales campaigns found</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Campaign</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Product</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Orders</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Revenue</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Cost</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Profit</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Margin</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">AOV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {campaigns.map((campaign) => {
                    const profitMargin = campaign.revenue > 0
                      ? ((campaign.profit / campaign.revenue) * 100).toFixed(2)
                      : '0.00';

                    return (
                      <tr key={campaign.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-white font-medium">{campaign.campaign_name}</p>
                            <p className="text-sm text-gray-400">{new Date(campaign.start_date).toLocaleDateString()}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-300">{campaign.product_name}</p>
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
                        <td className="px-6 py-4 text-right text-white">{formatNumber(campaign.total_orders)}</td>
                        <td className="px-6 py-4 text-right text-white">{formatCurrency(campaign.revenue)}</td>
                        <td className="px-6 py-4 text-right text-red-400">{formatCurrency(campaign.cost)}</td>
                        <td className="px-6 py-4 text-right text-green-400 font-medium">{formatCurrency(campaign.profit)}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-medium ${
                            parseFloat(profitMargin) >= 50 ? 'text-green-400' : parseFloat(profitMargin) >= 30 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {profitMargin}%
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-white">{formatCurrency(campaign.avg_order_value)}</td>
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
