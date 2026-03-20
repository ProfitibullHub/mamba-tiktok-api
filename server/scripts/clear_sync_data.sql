-- ============================================================
-- CLEAR SYNC DATA SCRIPT
-- This clears orders, products, and settlements data to allow a fresh sync
-- NOTE: This preserves your shop connections and account data
-- ============================================================

-- ⚠️ WARNING: This will delete ALL synced data. 
-- Make sure you want to do this before running!

-- Option 1: Clear ALL data for ALL shops
-- ----------------------------------------

-- Clear all orders
TRUNCATE TABLE shop_orders CASCADE;

-- Clear all products
TRUNCATE TABLE shop_products CASCADE;

-- Clear all settlements
TRUNCATE TABLE shop_settlements CASCADE;

-- Clear product cost history (if exists)
TRUNCATE TABLE product_cost_history CASCADE;

-- Clear shop performance data (if exists)
TRUNCATE TABLE shop_performance CASCADE;

-- Reset sync timestamps on shops so next sync is treated as "first sync"
UPDATE tiktok_shops 
SET 
    orders_last_synced_at = NULL,
    products_last_synced_at = NULL,
    settlements_last_synced_at = NULL,
    updated_at = NOW();

-- ============================================================
-- Option 2: Clear data for a SPECIFIC shop only
-- Uncomment and replace 'YOUR_SHOP_ID' with actual shop_id
-- ============================================================

/*
-- Clear orders for specific shop
DELETE FROM shop_orders WHERE shop_id IN (
    SELECT id FROM tiktok_shops WHERE shop_id = 'YOUR_SHOP_ID'
);

-- Clear products for specific shop
DELETE FROM shop_products WHERE shop_id IN (
    SELECT id FROM tiktok_shops WHERE shop_id = 'YOUR_SHOP_ID'
);

-- Clear settlements for specific shop
DELETE FROM shop_settlements WHERE shop_id = 'YOUR_SHOP_ID';

-- Clear performance for specific shop
DELETE FROM shop_performance WHERE shop_id = 'YOUR_SHOP_ID';

-- Reset sync timestamps for specific shop
UPDATE tiktok_shops 
SET 
    orders_last_synced_at = NULL,
    products_last_synced_at = NULL,
    settlements_last_synced_at = NULL,
    updated_at = NOW()
WHERE shop_id = 'YOUR_SHOP_ID';
*/

-- ============================================================
-- Verify cleanup
-- ============================================================

SELECT 'shop_orders' as table_name, COUNT(*) as row_count FROM shop_orders
UNION ALL
SELECT 'shop_products', COUNT(*) FROM shop_products
UNION ALL
SELECT 'shop_settlements', COUNT(*) FROM shop_settlements
UNION ALL
SELECT 'shop_performance', COUNT(*) FROM shop_performance;

-- Show shops ready for fresh sync
SELECT 
    shop_name,
    shop_id,
    orders_last_synced_at,
    products_last_synced_at,
    settlements_last_synced_at
FROM tiktok_shops;
