import { Users, DollarSign, TrendingUp, Target, Percent } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { useKPIData } from '../../hooks/useKPIData';
import { Account, AffiliateProgram, supabase } from '../../lib/supabase';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface AffiliatesViewProps {
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

export function AffiliatesView({ account }: AffiliatesViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const { data, loading, aggregateMetrics } = useKPIData(account, 'affiliates', dateRange);
  const [programs, setPrograms] = useState<AffiliateProgram[]>([]);
  const [programsLoading, setProgramsLoading] = useState(true);

  useEffect(() => {
    fetchPrograms();
  }, [account.id, account.is_agency_view]);

  const fetchPrograms = async () => {
    try {
      setProgramsLoading(true);
      let query = supabase.from('affiliate_programs').select('*');

      if (!account.is_agency_view) {
        query = query.eq('account_id', account.id);
      }

      query = query.order('commissions_earned', { ascending: false });

      const { data: programsData, error } = await query;
      if (error) throw error;
      setPrograms(programsData || []);
    } catch (error) {
      console.error('Error fetching programs:', error);
    } finally {
      setProgramsLoading(false);
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

  const conversionRate = metrics?.clicks
    ? ((metrics.conversions / metrics.clicks) * 100).toFixed(2)
    : '0.00';

  const avgCommissionPerConversion = metrics?.conversions
    ? (metrics.affiliate_commissions / metrics.conversions).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Affiliate Marketing</h2>
          <p className="text-gray-400">Track affiliate performance and commissions</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Commissions"
          value={formatCurrency(metrics?.affiliate_commissions || 0)}
          change={24.5}
          icon={DollarSign}
          iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
        />
        <StatCard
          title="Affiliate Clicks"
          value={formatNumber(metrics?.clicks || 0)}
          change={18.3}
          icon={Target}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Conversions"
          value={formatNumber(metrics?.conversions || 0)}
          change={15.7}
          icon={TrendingUp}
          iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
        />
        <StatCard
          title="Conversion Rate"
          value={`${conversionRate}%`}
          change={8.2}
          icon={Percent}
          iconColor="bg-gradient-to-r from-orange-500 to-red-500"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Performance Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Avg Commission"
            value={`$${avgCommissionPerConversion}`}
            change={5.9}
            icon={DollarSign}
            iconColor="bg-gradient-to-r from-teal-500 to-green-500"
            subtitle="Per conversion"
          />
          <StatCard
            title="Total Revenue"
            value={formatCurrency(metrics?.revenue || 0)}
            change={20.1}
            icon={TrendingUp}
            iconColor="bg-gradient-to-r from-pink-500 to-red-500"
          />
          <StatCard
            title="Active Programs"
            value={data.length}
            icon={Users}
            iconColor="bg-gradient-to-r from-indigo-500 to-purple-500"
            subtitle="Running campaigns"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Individual Programs</h3>
        {programsLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-pink-500 border-t-transparent"></div>
          </div>
        ) : programs.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
            <p className="text-gray-400">No affiliate programs found</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Program</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Product</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Commission Rate</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Clicks</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Conversions</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Conv. Rate</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Revenue</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {programs.map((program) => {
                    const conversionRate = program.clicks > 0
                      ? ((program.conversions / program.clicks) * 100).toFixed(2)
                      : '0.00';

                    return (
                      <tr key={program.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-white font-medium">{program.program_name}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-300">{program.product_name}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            program.status === 'active'
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : program.status === 'paused'
                              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                              : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                          }`}>
                            {program.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-white">{program.commission_rate}%</td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(program.clicks)}</td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(program.conversions)}</td>
                        <td className="px-6 py-4 text-right text-white">{conversionRate}%</td>
                        <td className="px-6 py-4 text-right text-white">{formatCurrency(program.revenue)}</td>
                        <td className="px-6 py-4 text-right text-green-400 font-medium">
                          {formatCurrency(program.commissions_earned)}
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
