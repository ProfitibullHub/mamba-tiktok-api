-- Add sync metadata columns to tiktok_shops table for cache tracking
-- This enables the stale-while-revalidate caching strategy

-- Add sync tracking columns
ALTER TABLE tiktok_shops 
ADD COLUMN IF NOT EXISTS orders_last_synced_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS products_last_synced_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS settlements_last_synced_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS performance_last_synced_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for efficient cache freshness queries
CREATE INDEX IF NOT EXISTS idx_tiktok_shops_orders_sync ON tiktok_shops(orders_last_synced_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_shops_products_sync ON tiktok_shops(products_last_synced_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_shops_settlements_sync ON tiktok_shops(settlements_last_synced_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_shops_performance_sync ON tiktok_shops(performance_last_synced_at);

-- Add comment for documentation
COMMENT ON COLUMN tiktok_shops.orders_last_synced_at IS 'Timestamp of last successful orders sync from TikTok API';
COMMENT ON COLUMN tiktok_shops.products_last_synced_at IS 'Timestamp of last successful products sync from TikTok API';
COMMENT ON COLUMN tiktok_shops.settlements_last_synced_at IS 'Timestamp of last successful settlements sync from TikTok API';
COMMENT ON COLUMN tiktok_shops.performance_last_synced_at IS 'Timestamp of last successful performance sync from TikTok API';
