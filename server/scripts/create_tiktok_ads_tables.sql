-- TikTok Business API (Marketing API) Database Schema
-- Run this in Supabase SQL Editor to create tables for ad campaign tracking

-- ============================================
-- 1. TikTok Advertiser Accounts
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_advertisers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    advertiser_id TEXT NOT NULL UNIQUE,
    advertiser_name TEXT,
    app_id TEXT NOT NULL, -- Your TikTok Business API app_id
    access_token TEXT NOT NULL,
    access_token_expires_at TIMESTAMPTZ,
    
    -- Advertiser info
    company TEXT,
    currency TEXT DEFAULT 'USD',
    timezone TEXT DEFAULT 'UTC',
    balance DECIMAL(15,2) DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_tiktok_advertisers_account ON tiktok_advertisers(account_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_advertisers_advertiser ON tiktok_advertisers(advertiser_id);

-- ============================================
-- 2. Ad Campaigns
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL UNIQUE,
    campaign_name TEXT NOT NULL,
    
    -- Campaign settings
    objective_type TEXT, -- TRAFFIC, CONVERSIONS, APP_INSTALL, etc.
    status TEXT, -- ENABLE, DISABLE, DELETE
    budget DECIMAL(15,2),
    budget_mode TEXT, -- BUDGET_MODE_DAY, BUDGET_MODE_TOTAL
    
    -- Dates
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,
    raw_data JSONB -- Store full campaign object
);

CREATE INDEX IF NOT EXISTS idx_tiktok_campaigns_advertiser ON tiktok_ad_campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_campaigns_status ON tiktok_ad_campaigns(status);

-- ============================================
-- 3. Ad Groups
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_ad_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES tiktok_ad_campaigns(id) ON DELETE CASCADE,
    adgroup_id TEXT NOT NULL UNIQUE,
    adgroup_name TEXT NOT NULL,
    
    -- Ad Group settings
    status TEXT, -- ENABLE, DISABLE, DELETE
    budget DECIMAL(15,2),
    budget_mode TEXT,
    
    -- Bidding
    bid_type TEXT,
    bid_price DECIMAL(15,2),
    optimization_goal TEXT,
    
    -- Targeting
    location_ids TEXT[], -- Array of location codes
    age_groups TEXT[],
    gender TEXT,
    
    -- Schedule
    schedule_type TEXT,
    schedule_start_time TIMESTAMPTZ,
    schedule_end_time TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,
    raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_tiktok_adgroups_advertiser ON tiktok_ad_groups(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_adgroups_campaign ON tiktok_ad_groups(campaign_id);

-- ============================================
-- 4. Ads (Creatives)
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    adgroup_id UUID REFERENCES tiktok_ad_groups(id) ON DELETE CASCADE,
    ad_id TEXT NOT NULL UNIQUE,
    ad_name TEXT NOT NULL,
    
    -- Creative info
    ad_format TEXT,
    ad_text TEXT,
    call_to_action TEXT,
    landing_page_url TEXT,
    video_id TEXT,
    image_ids TEXT[],
    
    -- Status
    status TEXT, -- ENABLE, DISABLE, DELETE
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,
    raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_tiktok_ads_advertiser ON tiktok_ads(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_ads_adgroup ON tiktok_ads(adgroup_id);

-- ============================================
-- 5. Ad Performance Metrics (Daily Snapshots)
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_ad_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    
    -- Dimension (what level is this metric for?)
    dimension_type TEXT NOT NULL, -- CAMPAIGN, ADGROUP, AD
    dimension_id UUID NOT NULL, -- ID of the campaign/adgroup/ad
    
    -- Time period
    stat_date DATE NOT NULL,
    stat_datetime TIMESTAMPTZ NOT NULL,
    
    -- Performance Metrics
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    frequency DECIMAL(10,2) DEFAULT 0,
    
    -- Engagement
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    follows BIGINT DEFAULT 0,
    video_views BIGINT DEFAULT 0,
    video_watched_2s BIGINT DEFAULT 0,
    video_watched_6s BIGINT DEFAULT 0,
    video_views_p25 BIGINT DEFAULT 0,
    video_views_p50 BIGINT DEFAULT 0,
    video_views_p75 BIGINT DEFAULT 0,
    video_views_p100 BIGINT DEFAULT 0,
    
    -- Costs
    spend DECIMAL(15,2) DEFAULT 0,
    cpc DECIMAL(10,4) DEFAULT 0, -- Cost per click
    cpm DECIMAL(10,4) DEFAULT 0, -- Cost per 1000 impressions
    
    -- Conversions
    conversions BIGINT DEFAULT 0,
    conversion_rate DECIMAL(10,4) DEFAULT 0,
    cost_per_conversion DECIMAL(15,4) DEFAULT 0,
    conversion_value DECIMAL(15,2) DEFAULT 0,
    
    -- Click-through rates
    ctr DECIMAL(10,4) DEFAULT 0,
    
    -- Metadata
    currency TEXT DEFAULT 'USD',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(advertiser_id, dimension_type, dimension_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_metrics_advertiser ON tiktok_ad_metrics(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_metrics_dimension ON tiktok_ad_metrics(dimension_type, dimension_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_metrics_date ON tiktok_ad_metrics(stat_date DESC);

-- ============================================
-- 6. Ad Spend Summary (Aggregated by Date)
-- ============================================
CREATE TABLE IF NOT EXISTS tiktok_ad_spend_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES tiktok_advertisers(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    
    spend_date DATE NOT NULL,
    total_spend DECIMAL(15,2) DEFAULT 0,
    total_impressions BIGINT DEFAULT 0,
    total_clicks BIGINT DEFAULT 0,
    total_conversions BIGINT DEFAULT 0,
    conversion_value DECIMAL(15,2) DEFAULT 0,
    
    currency TEXT DEFAULT 'USD',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(advertiser_id, spend_date)
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_advertiser ON tiktok_ad_spend_daily(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_account ON tiktok_ad_spend_daily(account_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON tiktok_ad_spend_daily(spend_date DESC);

-- ============================================
-- 7. Enable Row Level Security (RLS)
-- ============================================
ALTER TABLE tiktok_advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_ad_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_ad_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_ad_spend_daily ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 8. RLS Policies (Users can only see their own data)
-- ============================================

-- Advertisers
CREATE POLICY "Users can view their own advertisers"
    ON tiktok_advertisers FOR SELECT
    USING (account_id = auth.uid());

CREATE POLICY "Users can insert their own advertisers"
    ON tiktok_advertisers FOR INSERT
    WITH CHECK (account_id = auth.uid());

CREATE POLICY "Users can update their own advertisers"
    ON tiktok_advertisers FOR UPDATE
    USING (account_id = auth.uid());

-- Campaigns
CREATE POLICY "Users can view campaigns for their advertisers"
    ON tiktok_ad_campaigns FOR SELECT
    USING (advertiser_id IN (SELECT id FROM tiktok_advertisers WHERE account_id = auth.uid()));

-- Ad Groups
CREATE POLICY "Users can view ad groups for their advertisers"
    ON tiktok_ad_groups FOR SELECT
    USING (advertiser_id IN (SELECT id FROM tiktok_advertisers WHERE account_id = auth.uid()));

-- Ads
CREATE POLICY "Users can view ads for their advertisers"
    ON tiktok_ads FOR SELECT
    USING (advertiser_id IN (SELECT id FROM tiktok_advertisers WHERE account_id = auth.uid()));

-- Metrics
CREATE POLICY "Users can view metrics for their advertisers"
    ON tiktok_ad_metrics FOR SELECT
    USING (advertiser_id IN (SELECT id FROM tiktok_advertisers WHERE account_id = auth.uid()));

-- Ad Spend
CREATE POLICY "Users can view their ad spend"
    ON tiktok_ad_spend_daily FOR SELECT
    USING (account_id = auth.uid());

-- ============================================
-- DONE! Run this script in Supabase SQL Editor
-- ============================================

COMMENT ON TABLE tiktok_advertisers IS 'Stores TikTok advertiser account credentials and info';
COMMENT ON TABLE tiktok_ad_campaigns IS 'TikTok ad campaigns';
COMMENT ON TABLE tiktok_ad_groups IS 'TikTok ad groups (ad sets)';
COMMENT ON TABLE tiktok_ads IS 'Individual TikTok ads/creatives';
COMMENT ON TABLE tiktok_ad_metrics IS 'Daily performance metrics for campaigns/adgroups/ads';
COMMENT ON TABLE tiktok_ad_spend_daily IS 'Aggregated daily ad spend for quick reporting';
