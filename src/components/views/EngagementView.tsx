import { Heart, MessageCircle, Share2, Users, TrendingUp, Eye } from 'lucide-react';
import { useState } from 'react';
import { StatCard } from '../StatCard';
import { useKPIData } from '../../hooks/useKPIData';
import { Account } from '../../lib/supabase';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface EngagementViewProps {
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

export function EngagementView({ account }: EngagementViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const { data, loading, aggregateMetrics } = useKPIData(account, 'engagement', dateRange);

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

  const totalEngagement = (metrics?.likes || 0) + (metrics?.comments || 0) + (metrics?.shares || 0);
  const engagementRate = metrics?.video_views
    ? ((totalEngagement / metrics.video_views) * 100).toFixed(2)
    : '0.00';

  const avgLikesPerPost = data.length > 0 && metrics?.likes
    ? Math.round(metrics.likes / data.length)
    : 0;

  const avgCommentsPerPost = data.length > 0 && metrics?.comments
    ? Math.round(metrics.comments / data.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Engagement Analytics</h2>
          <p className="text-gray-400">Monitor audience interaction and community growth</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Engagement"
          value={formatNumber(totalEngagement)}
          change={16.8}
          icon={TrendingUp}
          iconColor="bg-gradient-to-r from-pink-500 to-red-500"
        />
        <StatCard
          title="Engagement Rate"
          value={`${engagementRate}%`}
          change={10.3}
          icon={Heart}
          iconColor="bg-gradient-to-r from-purple-500 to-pink-500"
        />
        <StatCard
          title="New Followers"
          value={formatNumber(metrics?.followers_gained || 0)}
          change={7.5}
          icon={Users}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Video Views"
          value={formatNumber(metrics?.video_views || 0)}
          change={12.9}
          icon={Eye}
          iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Interaction Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Total Likes"
            value={formatNumber(metrics?.likes || 0)}
            change={15.2}
            icon={Heart}
            iconColor="bg-gradient-to-r from-pink-500 to-red-500"
          />
          <StatCard
            title="Total Comments"
            value={formatNumber(metrics?.comments || 0)}
            change={8.6}
            icon={MessageCircle}
            iconColor="bg-gradient-to-r from-blue-500 to-indigo-500"
          />
          <StatCard
            title="Total Shares"
            value={formatNumber(metrics?.shares || 0)}
            change={22.4}
            icon={Share2}
            iconColor="bg-gradient-to-r from-teal-500 to-green-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Average Per Post</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Avg Likes"
            value={formatNumber(avgLikesPerPost)}
            change={5.8}
            icon={Heart}
            iconColor="bg-gradient-to-r from-pink-500 to-purple-500"
          />
          <StatCard
            title="Avg Comments"
            value={formatNumber(avgCommentsPerPost)}
            change={3.2}
            icon={MessageCircle}
            iconColor="bg-gradient-to-r from-indigo-500 to-purple-500"
          />
          <StatCard
            title="Avg Views"
            value={formatNumber(data.length > 0 && metrics?.video_views ? metrics.video_views / data.length : 0)}
            change={9.1}
            icon={Eye}
            iconColor="bg-gradient-to-r from-cyan-500 to-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
