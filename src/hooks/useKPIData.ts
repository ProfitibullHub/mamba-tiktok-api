import { useState, useEffect } from 'react';
import { supabase, KPIMetrics, Account } from '../lib/supabase';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export function useKPIData(account: Account | null, metricType?: string, dateRange?: DateRange) {
  const [data, setData] = useState<KPIMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setLoading(false);
      return;
    }

    fetchData();
  }, [account?.id, metricType, dateRange?.startDate, dateRange?.endDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('kpi_metrics')
        .select('*');

      if (!account?.is_agency_view) {
        query = query.eq('account_id', account?.id);
      }

      if (dateRange) {
        query = query
          .gte('date', dateRange.startDate)
          .lte('date', dateRange.endDate);
      }

      query = query
        .order('date', { ascending: false })
        .limit(account?.is_agency_view ? 300 : 30);

      if (metricType) {
        query = query.eq('metric_type', metricType);
      }

      const { data: kpiData, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setData(kpiData || []);
    } catch (err) {
      console.error('Error fetching KPI data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const aggregateMetrics = (metrics: KPIMetrics[]) => {
    if (metrics.length === 0) return null;

    return metrics.reduce(
      (acc, metric) => ({
        impressions: acc.impressions + Number(metric.impressions),
        clicks: acc.clicks + Number(metric.clicks),
        conversions: acc.conversions + metric.conversions,
        revenue: acc.revenue + Number(metric.revenue),
        spend: acc.spend + Number(metric.spend),
        followers_gained: acc.followers_gained + metric.followers_gained,
        video_views: acc.video_views + Number(metric.video_views),
        likes: acc.likes + metric.likes,
        comments: acc.comments + metric.comments,
        shares: acc.shares + metric.shares,
        affiliate_commissions: acc.affiliate_commissions + Number(metric.affiliate_commissions),
        engagement_rate: acc.engagement_rate + Number(metric.engagement_rate),
      }),
      {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        spend: 0,
        followers_gained: 0,
        video_views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        affiliate_commissions: 0,
        engagement_rate: 0,
      }
    );
  };

  return { data, loading, error, aggregateMetrics };
}
