
import { TrendingUp, DollarSign, ShoppingBag, Package, Users, Star, RefreshCw, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { Account } from '../../lib/supabase';
import { RefreshPrompt } from '../RefreshPrompt';
import { useShopStore } from '../../store/useShopStore';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface OverviewViewProps {
  account: Account;
  shopId?: string;
  onNavigate?: (tab: string) => void;
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

export function OverviewView({ account, shopId, onNavigate }: OverviewViewProps) {
  const metrics = useShopStore(state => state.metrics);

  const error = useShopStore(state => state.error);
  const fetchShopData = useShopStore(state => state.fetchShopData);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);
  const dismissRefreshPrompt = useShopStore(state => state.dismissRefreshPrompt);

  const orders = useShopStore(state => state.orders);
  const finance = useShopStore(state => state.finance);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());

  // Calculated metrics to match ProfitLossView
  const [calculatedMetrics, setCalculatedMetrics] = useState({
    totalRevenue: 0,
    netProfit: 0,
    grossProfit: 0,
    netSales: 0
  });

  const [completedOrders, setCompletedOrders] = useState(0);


  // Update lastUpdated when metrics change
  useEffect(() => {
    if (metrics.totalOrders > 0 || metrics.totalProducts > 0) {
      setLastUpdated(new Date());
    }
  }, [metrics]);

  // Calculate metrics using P&L logic
  useEffect(() => {
    // Use exact same date range logic as ProfitLossView (UTC midnight)
    const start = new Date(dateRange.startDate).getTime() / 1000;
    const end = new Date(dateRange.endDate).getTime() / 1000 + 86400; // End of day

    // Filter for selected date range
    const filteredOrders = orders.filter(o => o.created_time >= start && o.created_time <= end);
    const filteredStatements = finance.statements.filter(s => s.statement_time >= start && s.statement_time <= end);

    // Calculate Metrics using Statements (User Request)
    // 1. Revenue Amount (Top Line)
    const totalRevenue = filteredStatements.reduce((sum, s) => sum + parseFloat(s.revenue_amount || '0'), 0);

    // 2. Net Sales Amount (Sales Value)
    const netSales = filteredStatements.reduce((sum, s) => sum + parseFloat(s.net_sales_amount || '0'), 0);

    // 3. Settlement Amount (Take-Home Pay / Net Profit)
    const netProfit = filteredStatements.reduce((sum, s) => sum + parseFloat(s.settlement_amount || '0'), 0);

    // Estimates for Gross Profit (since we don't have COGS in statements)
    const productCosts = totalRevenue * 0.3; // Estimated 30% COGS
    const grossProfit = totalRevenue - productCosts;

    // Calculate Completed Orders
    const completedOrdersCount = filteredOrders.filter(o => o.order_status === 'COMPLETED').length;

    setCalculatedMetrics({
      totalRevenue,
      netProfit,
      grossProfit,
      netSales
    });

    setCompletedOrders(completedOrdersCount);
  }, [orders, finance.statements, dateRange]);


  const handleSync = async () => {
    if (!shopId) {
      console.error('Sync failed: No shopId provided');
      return;
    }
    console.log('Starting sync for shop:', shopId);
    try {
      await syncData(account.id, shopId, 'all');
      console.log('Sync completed successfully');
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Sync failed with error:', err);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)} M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)} K`;
    return num.toLocaleString();
  };

  const formatCurrency = (num: number): string => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
  };

  const getDaysDifference = () => {
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const dateRangeSubtitle = `within ${getDaysDifference()} days`;

  return (
    <div className="space-y-6">
      {/* Refresh Prompt */}
      {cacheMetadata.showRefreshPrompt && (
        <RefreshPrompt
          onRefresh={() => syncData(account.id, shopId!, 'all')}
          onDismiss={dismissRefreshPrompt}
          isStale={cacheMetadata.isStale}
        />
      )}



      {error && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <p className="text-amber-200 text-sm">
              We're having trouble fetching some data. Some information might be outdated.
            </p>
          </div>
          <button
            onClick={() => fetchShopData(account.id, shopId, { forceRefresh: true })}
            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      )}
      {/* Account Header */}
      <div className="bg-gradient-to-r from-pink-500/10 to-red-500/10 border border-pink-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {account.avatar_url ? (
              <img src={account.avatar_url} alt={account.name} className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-pink-500 to-red-500 flex items-center justify-center text-white text-2xl font-bold">
                {account.name.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-white">{account.name}</h2>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white truncate">
                  {(account as any).tiktok_handle || account.tiktok_handle || 'TikTok Shop'}
                </p>
                {(account as any).owner_role && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-400 border border-pink-500/30">
                    {(account as any).owner_role.toUpperCase()}
                  </span>
                )}
                {metrics.shopRating > 0 && (
                  <div className="flex items-center gap-1 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs text-yellow-200">{metrics.shopRating.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
              <button
                onClick={handleSync}
                disabled={cacheMetadata.isSyncing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${cacheMetadata.isSyncing
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed items-center space-x-2 px-4 py-2'
                  : 'flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50'
                  } `}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${cacheMetadata.isSyncing ? 'animate-spin' : ''} `} />
                {cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
            {lastUpdated && (
              <p className="text-xs text-gray-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Revenue Metrics */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Revenue"
            value={formatCurrency(calculatedMetrics.totalRevenue)}
            change={0}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
            subtitle={`${dateRangeSubtitle} (Sales)`}
            onSync={() => syncData(account.id, shopId!, 'finance')}
            isSyncing={cacheMetadata.isSyncing}
          />
          {(() => {
            const totalOrdersCount = dateRange.startDate === '2020-01-01' ? metrics.totalOrders : orders.filter(o => {
              const start = new Date(dateRange.startDate).getTime() / 1000;
              const end = new Date(dateRange.endDate).getTime() / 1000 + 86400;
              return o.created_time >= start && o.created_time <= end;
            }).length;

            return (
              <StatCard
                title={`Total Orders, ${dateRangeSubtitle}`}
                value={totalOrdersCount.toLocaleString()}
                change={0} // Placeholder, ideally calculated
                icon={ShoppingBag}
                iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
                subtitle={`${completedOrders} Completed - ${dateRangeSubtitle}`}
                onClick={() => onNavigate?.('orders')}
                onSync={() => syncData(account.id, shopId!, 'orders')}
                isSyncing={cacheMetadata.isSyncing}
              />
            );
          })()}
          <StatCard
            title="Total Products"
            value={formatNumber(metrics.totalProducts)}
            change={-2.4}
            icon={Package}
            iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
            subtitle="Active listings"
            onClick={() => onNavigate?.('products')}
            onSync={() => syncData(account.id, shopId!, 'products')}
            isSyncing={cacheMetadata.isSyncing}
          />
          <StatCard
            title="Avg. Order Value"
            value={formatCurrency(metrics.avgOrderValue)}
            change={5.7}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-orange-500 to-red-500"
            subtitle="Per transaction"
          />
          <StatCard
            title="Net Profit"
            value={formatCurrency(calculatedMetrics.netProfit)}
            change={0} // Placeholder
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
            subtitle={`Calculated ${dateRangeSubtitle}`}
            onSync={() => syncData(account.id, shopId!, 'finance')}
            isSyncing={cacheMetadata.isSyncing}
          />
        </div>
      </div>

      {/* Shop Performance */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Shop Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Conversion Rate"
            value={`${metrics.conversionRate.toFixed(2)}% `}
            icon={Users}
            iconColor="bg-gradient-to-r from-pink-500 to-purple-500"
            subtitle="Visitors to buyers"
          />

        </div>
      </div>

      {/* Quick Actions / Info */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Stats</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Orders Today</p>
            <p className="text-xl font-bold text-white mt-1">-</p>
          </div>
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Revenue Today</p>
            <p className="text-xl font-bold text-white mt-1">-</p>
          </div>
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Pending</p>
            <p className="text-xl font-bold text-white mt-1">-</p>
          </div>
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Low Stock</p>
            <p className="text-xl font-bold text-white mt-1">-</p>
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-4 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          Live data from TikTok Shop
        </p>
      </div>
    </div>
  );
}
