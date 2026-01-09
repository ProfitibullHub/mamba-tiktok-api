import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'client' | 'moderator' | 'accountant';
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  tiktok_handle: string;
  avatar_url?: string;
  status: 'active' | 'inactive' | 'suspended';
  is_agency_view?: boolean;
  created_at: string;
  updated_at: string;
}

export interface KPIMetrics {
  id: string;
  account_id: string;
  date: string;
  metric_type: 'ads' | 'posts' | 'engagement' | 'affiliates' | 'sales' | 'overview';
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  spend: number;
  engagement_rate: number;
  followers_gained: number;
  video_views: number;
  likes: number;
  comments: number;
  shares: number;
  affiliate_commissions: number;
  created_at: string;
}

export interface AdCampaign {
  id: string;
  account_id: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  start_date: string;
  end_date?: string;
  budget: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  created_at: string;
  updated_at: string;
}

export interface ContentPost {
  id: string;
  account_id: string;
  title: string;
  video_url?: string;
  thumbnail_url?: string;
  published_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate: number;
  created_at: string;
  updated_at: string;
}

export interface AffiliateProgram {
  id: string;
  account_id: string;
  program_name: string;
  product_name: string;
  affiliate_link?: string;
  commission_rate: number;
  status: 'active' | 'paused' | 'ended';
  clicks: number;
  conversions: number;
  revenue: number;
  commissions_earned: number;
  created_at: string;
  updated_at: string;
}

export interface SalesCampaign {
  id: string;
  account_id: string;
  campaign_name: string;
  product_name: string;
  status: 'active' | 'paused' | 'completed';
  start_date: string;
  end_date?: string;
  total_orders: number;
  revenue: number;
  cost: number;
  profit: number;
  avg_order_value: number;
  created_at: string;
  updated_at: string;
}
