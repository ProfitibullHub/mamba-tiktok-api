import { DollarSign, TrendingUp, TrendingDown, Wallet, PieChart, Calculator } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { useShopStore } from '../../store/useShopStore';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { RefreshCw } from 'lucide-react';
import { Account } from '../../lib/supabase';

interface ProfitLossViewProps {
  account: Account;
  shopId?: string;
}

interface ProfitLossMetrics {
  total_revenue: number;
  deductions: number;
  net_sales: number;
  unsettled_revenue: number;
  ad_revenue: number;
  sales_revenue: number; // Keeping for backward compatibility or specific breakdown if needed
  affiliate_revenue: number;
  total_costs: number;
  ad_spend: number;
  product_costs: number;
  operational_costs: number;
  gross_profit: number;
  net_profit: number;
  profit_margin: number;
  roi: number;
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

export function ProfitLossView({ account, shopId }: ProfitLossViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const orders = useShopStore(state => state.orders);
  const finance = useShopStore(state => state.finance);
  const isLoading = useShopStore(state => state.isLoading);
  const syncData = useShopStore(state => state.syncData);
  const cacheMetadata = useShopStore(state => state.cacheMetadata);

  const [plMetrics, setPlMetrics] = useState<ProfitLossMetrics | null>(null);
  const [calculating, setCalculating] = useState(false);

  const handleSync = async () => {
    if (!shopId) return;
    await syncData(account.id, shopId, 'finance');
  };

  useEffect(() => {
    if (!isLoading) {
      calculateProfitLoss();
    }
  }, [orders, finance.statements, dateRange, isLoading]);

  const calculateProfitLoss = async () => {
    try {
      setCalculating(true);

      // Filter orders by date range (UTC midnight)
      const start = new Date(dateRange.startDate).getTime() / 1000;
      const end = new Date(dateRange.endDate).getTime() / 1000 + 86400; // End of day

      const filteredStatements = finance.statements.filter(s => s.statement_time >= start && s.statement_time <= end);

      // Calculate Metrics using Statements (User Request)
      // 1. Revenue Amount (Top Line)
      const totalRevenue = filteredStatements.reduce((sum, s) => sum + parseFloat(s.revenue_amount || '0'), 0);

      // 2. Net Sales Amount (Sales Value)
      const netSales = filteredStatements.reduce((sum, s) => sum + parseFloat(s.net_sales_amount || '0'), 0);

      // 3. Settlement Amount (Take-Home Pay / Net Profit)
      const netProfit = filteredStatements.reduce((sum, s) => sum + parseFloat(s.settlement_amount || '0'), 0);

      // Deductions (Difference between Revenue and Net Sales, usually 0 if they match)
      const totalDeductions = totalRevenue - netSales;

      const unsettledRevenue = 0; // Not calculating this from statements only

      // Estimates (since we don't have this data from API yet)
      const adSpend = 0; // Would need Ads API
      const productCosts = totalRevenue * 0.3; // Estimated 30% COGS
      const operationalCosts = totalRevenue * 0.1; // Estimated 10% Ops

      const totalCosts = (totalRevenue - netProfit) + productCosts + operationalCosts; // Fees + COGS + Ops (Approximation)
      const grossProfit = totalRevenue - productCosts;

      const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const roi = totalCosts > 0 ? ((netProfit / totalCosts) * 100) : 0;

      setPlMetrics({
        total_revenue: totalRevenue,
        deductions: totalDeductions,
        net_sales: netSales,
        unsettled_revenue: unsettledRevenue,
        ad_revenue: 0,
        sales_revenue: netSales, // Using Net Sales as the main sales figure
        affiliate_revenue: 0,
        total_costs: totalCosts,
        ad_spend: adSpend,
        product_costs: productCosts,
        operational_costs: operationalCosts,
        gross_profit: grossProfit,
        net_profit: netProfit,
        profit_margin: profitMargin,
        roi: roi
      });
    } catch (error) {
      console.error('Error calculating P&L:', error);
    } finally {
      setCalculating(false);
    }
  };

  if (isLoading || calculating) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  const formatCurrency = (num: number): string => {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (num: number): string => {
    return `${num.toFixed(2)}%`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Profit & Loss Statement</h2>
          <p className="text-gray-400">Financial performance and profitability analysis</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={cacheMetadata.isSyncing || isLoading}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={20} className={cacheMetadata.isSyncing ? "animate-spin" : ""} />
            <span>{cacheMetadata.isSyncing ? 'Syncing...' : 'Sync Finance'}</span>
          </button>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Net Profit"
          value={formatCurrency(plMetrics?.net_profit || 0)}
          change={(plMetrics?.net_profit || 0) > 0 ? 12.5 : -8.2}
          icon={plMetrics && plMetrics.net_profit > 0 ? TrendingUp : TrendingDown}
          iconColor={plMetrics && plMetrics.net_profit > 0
            ? "bg-gradient-to-r from-green-500 to-emerald-500"
            : "bg-gradient-to-r from-red-500 to-pink-500"}
        />
        <StatCard
          title="Profit Margin"
          value={formatPercent(plMetrics?.profit_margin || 0)}
          change={3.2}
          icon={PieChart}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Return on Investment"
          value={formatPercent(plMetrics?.roi || 0)}
          change={8.7}
          icon={Calculator}
          iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
        />
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Revenue Breakdown</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Ad Revenue</p>
                <p className="text-sm text-gray-400">From TikTok ads</p>
              </div>
            </div>
            <p className="text-xl font-bold text-green-400">{formatCurrency(plMetrics?.ad_revenue || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Deductions</p>
                <p className="text-sm text-gray-400">Discounts & Refunds</p>
              </div>
            </div>
            <p className="text-xl font-bold text-red-400">-{formatCurrency(plMetrics?.deductions || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Net Sales</p>
                <p className="text-sm text-gray-400">Revenue after deductions</p>
              </div>
            </div>
            <p className="text-xl font-bold text-blue-400">{formatCurrency(plMetrics?.net_sales || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Unsettled Revenue</p>
                <p className="text-sm text-gray-400">Estimated (not yet paid)</p>
              </div>
            </div>
            <p className="text-xl font-bold text-cyan-400">{formatCurrency(plMetrics?.unsettled_revenue || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Affiliate Commissions</p>
                <p className="text-sm text-gray-400">From affiliate programs</p>
              </div>
            </div>
            <p className="text-xl font-bold text-purple-400">{formatCurrency(plMetrics?.affiliate_revenue || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-4 bg-green-500/10 rounded-lg px-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <p className="text-lg font-bold text-white">Total Revenue</p>
            </div>
            <p className="text-2xl font-bold text-green-400">{formatCurrency(plMetrics?.total_revenue || 0)}</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Cost Breakdown</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Ad Spend</p>
                <p className="text-sm text-gray-400">TikTok advertising costs</p>
              </div>
            </div>
            <p className="text-xl font-bold text-red-400">{formatCurrency(plMetrics?.ad_spend || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Product Costs</p>
                <p className="text-sm text-gray-400">COGS & fulfillment (est. 30%)</p>
              </div>
            </div>
            <p className="text-xl font-bold text-orange-400">{formatCurrency(plMetrics?.product_costs || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-medium">Operational Costs</p>
                <p className="text-sm text-gray-400">Overhead & expenses (est. 15%)</p>
              </div>
            </div>
            <p className="text-xl font-bold text-yellow-400">{formatCurrency(plMetrics?.operational_costs || 0)}</p>
          </div>

          <div className="flex items-center justify-between py-4 bg-red-500/10 rounded-lg px-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-white" />
              </div>
              <p className="text-lg font-bold text-white">Total Costs</p>
            </div>
            <p className="text-2xl font-bold text-red-400">{formatCurrency(plMetrics?.total_costs || 0)}</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Profitability Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
            <div className="flex items-center gap-3 mb-3">
              <Wallet className="w-6 h-6 text-blue-400" />
              <p className="text-gray-400 font-medium">Gross Profit</p>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{formatCurrency(plMetrics?.gross_profit || 0)}</p>
            <p className="text-sm text-gray-400">Revenue minus product costs</p>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-5 border border-gray-700">
            <div className="flex items-center gap-3 mb-3">
              {plMetrics && plMetrics.net_profit > 0 ? (
                <TrendingUp className="w-6 h-6 text-green-400" />
              ) : (
                <TrendingDown className="w-6 h-6 text-red-400" />
              )}
              <p className="text-gray-400 font-medium">Settlement Amount (Net Profit)</p>
            </div>
            <p className={`text-3xl font-bold mb-1 ${plMetrics && plMetrics.net_profit > 0 ? 'text-green-400' : 'text-red-400'
              }`}>
              {formatCurrency(plMetrics?.net_profit || 0)}
            </p>
            <p className="text-sm text-gray-400">Actual payout to bank</p>
          </div>
        </div>
      </div>
    </div>
  );
}
