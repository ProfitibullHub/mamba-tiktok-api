-- ============================================================================
-- RESET SYNC DATA - Wipe All Synced Data for Fresh Sync
-- ============================================================================
-- This script will:
-- 1. Delete all synced data (orders, products, settlements, etc.)
-- 2. Reset sync timestamps on tiktok_shops
-- 3. Preserve shop connections and authentication
--
-- ⚠️  WARNING: This will DELETE all synced data!
-- ⚠️  Your shop connections will remain, but all data will need to be re-synced
-- ============================================================================

-- Start a transaction for safety
BEGIN;

-- ============================================================================
-- STEP 1: Delete all synced data
-- ============================================================================

-- Delete Orders and related data
DELETE FROM shop_orders;
-- Note: This will cascade delete related order items if you have cascade rules

-- Delete Products
DELETE FROM shop_products;

-- Delete Settlements (Finance Statements)
DELETE FROM shop_settlements;

-- Delete Performance/Metrics data (if you have these tables)
-- DELETE FROM shop_metrics;
-- DELETE FROM shop_performance;

-- ============================================================================
-- STEP 2: Reset sync timestamps on tiktok_shops
-- ============================================================================

UPDATE tiktok_shops
SET 
    orders_last_synced_at = NULL,
    products_last_synced_at = NULL,
    settlements_last_synced_at = NULL,
    performance_last_synced_at = NULL,
    updated_at = NOW();

-- ============================================================================
-- STEP 3: Verify the reset
-- ============================================================================

-- Check that all data is deleted
SELECT 
    'shop_orders' as table_name, 
    COUNT(*) as record_count 
FROM shop_orders
UNION ALL
SELECT 
    'shop_products' as table_name, 
    COUNT(*) as record_count 
FROM shop_products
UNION ALL
SELECT 
    'shop_settlements' as table_name, 
    COUNT(*) as record_count 
FROM shop_settlements;

-- Check that shops still exist with NULL sync timestamps
SELECT 
    id,
    shop_name,
    orders_last_synced_at,
    products_last_synced_at,
    settlements_last_synced_at
FROM tiktok_shops;

-- ============================================================================
-- COMMIT or ROLLBACK
-- ============================================================================

-- If everything looks good, COMMIT the transaction:
COMMIT;

-- If you want to undo (run this instead of COMMIT):
-- ROLLBACK;
