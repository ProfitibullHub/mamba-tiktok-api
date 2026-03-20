-- ============================================================================
-- QUICK RESET - Single Command Version
-- ============================================================================
-- Copy and paste this entire block into Supabase SQL Editor and run it
-- ============================================================================

-- Delete all synced data and reset timestamps
BEGIN;

-- Delete all data
TRUNCATE shop_orders CASCADE;
TRUNCATE shop_products CASCADE;
TRUNCATE shop_settlements CASCADE;

-- Reset sync timestamps
UPDATE tiktok_shops
SET 
    orders_last_synced_at = NULL,
    products_last_synced_at = NULL,
    settlements_last_synced_at = NULL,
    performance_last_synced_at = NULL,
    updated_at = NOW();

COMMIT;

-- Verify reset
SELECT 
    (SELECT COUNT(*) FROM shop_orders) as orders_count,
    (SELECT COUNT(*) FROM shop_products) as products_count,
    (SELECT COUNT(*) FROM shop_settlements) as settlements_count,
    (SELECT COUNT(*) FROM tiktok_shops) as shops_count;
