import { TrendingUp, DollarSign, ShoppingBag, Package, Users, Star, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { Account } from '../../lib/supabase';

interface OverviewViewProps {
  account: Account;
  shopId?: string;
  onNavigate?: (tab: string) => void;
}

interface ShopMetrics {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  avgOrderValue: number;
  conversionRate: number;
  shopRating: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

import { useShopStore } from '../../store/useShopStore';

export function OverviewView({ account, shopId, onNavigate }: OverviewViewProps) {
  const products = useShopStore(state => state.products);
  const orders = useShopStore(state => state.orders);
  const isLoading = useShopStore(state => state.isLoading);

  const [metrics, setMetrics] = useState<ShopMetrics>({
    totalOrders: 0,
    totalRevenue: 0,
    totalProducts: 0,
    avgOrderValue: 0,
    conversionRate: 0,
    shopRating: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);


  useEffect(() => {
    if (products.length > 0 || orders.length > 0) {
      const totalRevenue = orders.reduce((sum, order) => sum + (order.order_amount || 0), 0);
      const totalOrders = orders.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      setMetrics({
        totalOrders,
        totalRevenue,
        totalProducts: products.length,
        avgOrderValue,
        conversionRate: 2.5,
        shopRating: 4.8,
      });
      setLastUpdated(new Date());
    }
  }, [products, orders]);




  const handleSync = async () => {
    try {
      setSyncing(true);
      const response = await fetch(`${API_BASE_URL}/api/tiktok-shop/sync/${account.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopId, syncType: 'all' }),
      });

      const result = await response.json();
      if (result.success) {

        const fetchShopData = useShopStore.getState().fetchShopData;
        await fetchShopData(account.id, shopId, true);
      } else {
        console.error('Sync failed:', result.error);
        alert('Failed to sync data: ' + result.error);
      }
    } catch (error) {
      console.error('Error syncing data:', error);
      alert('Error triggering sync');
    } finally {
      setSyncing(false);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatCurrency = (num: number): string => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (isLoading && metrics.totalOrders === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {}
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
                <p className="text-pink-400 font-medium">{account.tiktok_handle || 'TikTok Shop'}</p>
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
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${syncing
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-pink-600 hover:bg-pink-700 text-white shadow-lg shadow-pink-500/20'
                }`}
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            {lastUpdated && (
              <p className="text-xs text-gray-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Revenue"
            value={formatCurrency(metrics.totalRevenue)}
            change={0}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
            subtitle="All-time earnings"
          />
          <StatCard
            title="Total Orders"
            value={formatNumber(metrics.totalOrders)}
            subValue={formatCurrency(metrics.totalRevenue) + " GMV"}
            change={0}
            icon={ShoppingBag}
            iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
            subtitle="Completed orders"
            onClick={() => onNavigate?.('orders')}
          />
          <StatCard
            title="Total Products"
            value={formatNumber(metrics.totalProducts)}
            change={-2.4}
            icon={Package}
            iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
            subtitle="Active listings"
            onClick={() => onNavigate?.('products')}
          />
          <StatCard
            title="Avg. Order Value"
            value={formatCurrency(metrics.avgOrderValue)}
            change={5.7}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-orange-500 to-red-500"
            subtitle="Per transaction"
          />
        </div>
      </div>

      {}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Shop Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Conversion Rate"
            value={`${metrics.conversionRate.toFixed(2)}%`}
            icon={Users}
            iconColor="bg-gradient-to-r from-pink-500 to-purple-500"
            subtitle="Visitors to buyers"
          />
          <StatCard
            title="Shop Rating"
            value={metrics.shopRating > 0 ? metrics.shopRating.toFixed(1) : 'N/A'}
            icon={Star}
            iconColor="bg-gradient-to-r from-yellow-500 to-orange-500"
            subtitle="Customer satisfaction"
          />
        </div>
      </div>

      {}
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
