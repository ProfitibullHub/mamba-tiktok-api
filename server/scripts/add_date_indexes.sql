-- Add indexes on date columns for date-range query optimization
-- This will dramatically improve query performance for large datasets

-- Index on shop_orders.paid_time for date range queries (matches TikTok Seller Center)
-- Composite index with shop_id first for efficient filtering
CREATE INDEX IF NOT EXISTS idx_shop_orders_paid_time 
ON shop_orders(shop_id, paid_time DESC);

-- Index on shop_settlements.settlement_time
CREATE INDEX IF NOT EXISTS idx_shop_settlements_time 
ON shop_settlements(shop_id, settlement_time DESC);

-- Analyze tables to update statistics for query planner
ANALYZE shop_orders;
ANALYZE shop_settlements;

-- Verify indexes were created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('shop_orders', 'shop_settlements')
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
