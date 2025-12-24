import { Video, Eye, Heart, MessageCircle, Share2, TrendingUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { StatCard } from '../StatCard';
import { useKPIData } from '../../hooks/useKPIData';
import { Account, ContentPost, supabase } from '../../lib/supabase';
import { DateRangePicker, DateRange } from '../DateRangePicker';

interface PostsViewProps {
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

export function PostsView({ account }: PostsViewProps) {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const { data, loading, aggregateMetrics } = useKPIData(account, 'posts', dateRange);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, [account.id, account.is_agency_view, dateRange]);

  const fetchPosts = async () => {
    try {
      setPostsLoading(true);
      let query = supabase.from('content_posts').select('*');

      if (!account.is_agency_view) {
        query = query.eq('account_id', account.id);
      }

      query = query
        .gte('published_at', dateRange.startDate)
        .lte('published_at', dateRange.endDate)
        .order('published_at', { ascending: false });

      const { data: postsData, error } = await query;
      if (error) throw error;
      setPosts(postsData || []);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setPostsLoading(false);
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

  const avgViewsPerPost = data.length > 0 && metrics?.video_views
    ? (metrics.video_views / data.length)
    : 0;

  const totalEngagement = (metrics?.likes || 0) + (metrics?.comments || 0) + (metrics?.shares || 0);
  const engagementRate = metrics?.video_views
    ? ((totalEngagement / metrics.video_views) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Content Performance</h2>
          <p className="text-gray-400">Analyze your video content and reach</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Videos"
          value={data.length}
          change={20.5}
          icon={Video}
          iconColor="bg-gradient-to-r from-pink-500 to-purple-500"
          subtitle="Published content"
        />
        <StatCard
          title="Total Views"
          value={formatNumber(metrics?.video_views || 0)}
          change={15.3}
          icon={Eye}
          iconColor="bg-gradient-to-r from-blue-500 to-cyan-500"
        />
        <StatCard
          title="Avg Views/Post"
          value={formatNumber(avgViewsPerPost)}
          change={8.7}
          icon={TrendingUp}
          iconColor="bg-gradient-to-r from-green-500 to-emerald-500"
        />
        <StatCard
          title="Engagement Rate"
          value={`${engagementRate}%`}
          change={12.1}
          icon={Heart}
          iconColor="bg-gradient-to-r from-pink-500 to-red-500"
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Engagement Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Total Likes"
            value={formatNumber(metrics?.likes || 0)}
            change={14.2}
            icon={Heart}
            iconColor="bg-gradient-to-r from-pink-500 to-red-500"
          />
          <StatCard
            title="Total Comments"
            value={formatNumber(metrics?.comments || 0)}
            change={9.8}
            icon={MessageCircle}
            iconColor="bg-gradient-to-r from-blue-500 to-indigo-500"
          />
          <StatCard
            title="Total Shares"
            value={formatNumber(metrics?.shares || 0)}
            change={18.5}
            icon={Share2}
            iconColor="bg-gradient-to-r from-teal-500 to-green-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Individual Posts</h3>
        {postsLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-pink-500 border-t-transparent"></div>
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
            <p className="text-gray-400">No posts found</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Post</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Views</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Likes</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Comments</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Shares</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Engagement</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Eng. Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {posts.map((post) => {
                    const totalEngagement = post.likes + post.comments + post.shares;

                    return (
                      <tr key={post.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-white font-medium">{post.title}</p>
                            <p className="text-sm text-gray-400">
                              {new Date(post.published_at).toLocaleDateString()}
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-white">{formatNumber(post.views)}</td>
                        <td className="px-6 py-4 text-right">
                          <span className="flex items-center justify-end gap-1 text-pink-400">
                            <Heart className="w-4 h-4" />
                            {formatNumber(post.likes)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="flex items-center justify-end gap-1 text-blue-400">
                            <MessageCircle className="w-4 h-4" />
                            {formatNumber(post.comments)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="flex items-center justify-end gap-1 text-green-400">
                            <Share2 className="w-4 h-4" />
                            {formatNumber(post.shares)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-white font-medium">
                          {formatNumber(totalEngagement)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-medium ${
                            post.engagement_rate >= 8 ? 'text-green-400' : post.engagement_rate >= 6 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {post.engagement_rate.toFixed(2)}%
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
